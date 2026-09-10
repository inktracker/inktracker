import { describe, it, expect } from "vitest";
import {
  analyzePost,
  extractPosts,
  filterNewLeads,
  buildDigestSubject,
  buildDigestText,
  buildDigestHtml,
  buildBlockedText,
  DECORATION_SUBS,
} from "../redditScan.js";

const post = (over = {}) => ({
  id: "t3_1",
  subreddit: "screenprinting",
  title: "",
  selftext: "",
  author: "someone",
  permalink: "https://www.reddit.com/r/x/comments/1/",
  num_comments: 3,
  created_utc: 1_700_000_000,
  ...over,
});

describe("analyzePost — lead classification", () => {
  it("flags a direct Printavo mention anywhere as a lead", () => {
    const a = analyzePost(post({ subreddit: "smallbusiness", title: "Thinking of leaving Printavo" }));
    expect(a.isLead).toBe(true);
    expect(a.why).toContain("mentions Printavo");
    expect(a.angle).toMatch(/Printavo switchers/i);
  });

  it("flags a decoration-sub post asking for software", () => {
    const a = analyzePost(post({ subreddit: "screenprinting", title: "What software do you use to track orders?" }));
    expect(a.isLead).toBe(true);
  });

  it("requires the decoration domain in a broad sub (kills r/smallbusiness noise)", () => {
    // Software intent but no decoration domain, in a non-decoration sub → not a lead.
    const a = analyzePost(post({ subreddit: "smallbusiness", title: "Best CRM software for a bakery?" }));
    expect(a.isLead).toBe(false);
  });

  it("accepts a broad-sub post that names the decoration domain AND a tool ask", () => {
    const a = analyzePost(post({
      subreddit: "Etsy",
      title: "How do you all manage screen printing orders — any good software?",
    }));
    expect(a.isLead).toBe(true);
  });

  it("does not flag an off-topic decoration post with no tool/intent signal", () => {
    const a = analyzePost(post({ subreddit: "screenprinting", title: "Check out my new 6-color print!" }));
    expect(a.isLead).toBe(false);
  });

  it("scores Printavo + intent higher than a bare on-topic ask", () => {
    const strong = analyzePost(post({ title: "Printavo alternative? Looking for something cheaper" }));
    const weak = analyzePost(post({ title: "what software do you use" }));
    expect(strong.score).toBeGreaterThan(weak.score);
  });

  it("treats the decoration subs as domain-native", () => {
    expect(DECORATION_SUBS.has("screenprinting")).toBe(true);
    expect(DECORATION_SUBS.has("smallbusiness")).toBe(false);
  });
});

describe("extractPosts — Reddit listing normalization", () => {
  it("pulls t3 posts and builds absolute permalinks", () => {
    const listing = {
      data: {
        children: [
          { kind: "t3", data: { name: "t3_a", subreddit: "screenprinting", title: "Hi", permalink: "/r/screenprinting/comments/a/", num_comments: 2, created_utc: 1700 } },
          { kind: "t3", data: { name: "t3_b", subreddit: "Etsy", title: "Yo", selftext: "body", permalink: "/r/Etsy/comments/b/" } },
        ],
      },
    };
    const posts = extractPosts(listing);
    expect(posts).toHaveLength(2);
    expect(posts[0].id).toBe("t3_a");
    expect(posts[0].permalink).toBe("https://www.reddit.com/r/screenprinting/comments/a/");
  });

  it("returns [] on a malformed / empty listing", () => {
    expect(extractPosts(null)).toEqual([]);
    expect(extractPosts({})).toEqual([]);
    expect(extractPosts({ data: { children: "nope" } })).toEqual([]);
  });
});

describe("filterNewLeads — dedupe + rank + cap", () => {
  it("drops already-seen posts and non-leads, keeps and ranks the rest", () => {
    const posts = [
      post({ id: "t3_seen", title: "Printavo alternative anyone?" }),
      post({ id: "t3_new1", title: "Looking for screen printing shop software" }),
      post({ id: "t3_noise", subreddit: "Etsy", title: "My cat" }),
      post({ id: "t3_strong", title: "Ditching Printavo — best alternative for a print shop?" }),
    ];
    const { leads, total } = filterNewLeads(posts, new Set(["t3_seen"]));
    const ids = leads.map((l) => l.id);
    expect(ids).toContain("t3_new1");
    expect(ids).toContain("t3_strong");
    expect(ids).not.toContain("t3_seen"); // already surfaced
    expect(ids).not.toContain("t3_noise"); // not a lead
    // Printavo+intent should outrank the plain software ask.
    expect(ids[0]).toBe("t3_strong");
    expect(total).toBe(2);
  });

  it("dedupes the same post id appearing from multiple searches", () => {
    const dup = post({ id: "t3_dup", title: "Printavo help" });
    const { leads } = filterNewLeads([dup, { ...dup }], new Set());
    expect(leads).toHaveLength(1);
  });

  it("caps the returned list but reports the true total", () => {
    const many = Array.from({ length: 30 }, (_, i) => post({ id: `t3_${i}`, title: "Printavo alternative" }));
    const { leads, total } = filterNewLeads(many, new Set(), { limit: 20 });
    expect(leads).toHaveLength(20);
    expect(total).toBe(30);
  });
});

describe("digest builders", () => {
  const leads = [
    { id: "t3_a", subreddit: "screenprinting", title: "Printavo alternative?", selftext: "we pay too much", permalink: "https://reddit.com/a", num_comments: 5, _score: 9, _why: ["mentions Printavo", "asking/comparing"], _angle: "Direct Printavo mention — pitch InkTracker." },
  ];

  it("subject counts leads and names the top subreddit", () => {
    expect(buildDigestSubject(leads, 1)).toMatch(/1 Reddit lead to check/);
    expect(buildDigestSubject(leads, 1)).toMatch(/r\/screenprinting/);
  });

  it("text digest includes the link, the why, and the angle", () => {
    const t = buildDigestText(leads, 1);
    expect(t).toContain("https://reddit.com/a");
    expect(t).toContain("mentions Printavo");
    expect(t).toContain("Direct Printavo mention");
  });

  it("html digest escapes and links", () => {
    const withHtml = [{ ...leads[0], title: "A <b>bad</b> & title" }];
    const h = buildDigestHtml(withHtml, 1);
    expect(h).toContain("&lt;b&gt;");
    expect(h).toContain("&amp;");
    expect(h).toContain('href="https://reddit.com/a"');
  });

  it("blocked alert explains the OAuth remedy", () => {
    expect(buildBlockedText("0/10 ok")).toMatch(/REDDIT_CLIENT_ID/);
  });
});
