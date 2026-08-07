// Quality gate for blog content (scripts/content/blog-posts.mjs) and its
// generated output (public/blog/). Iterates POSTS, so every future post is
// covered automatically. Re-run `npm run build:content` if these fail after
// a content edit.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { POSTS } from "../content/blog-posts.mjs";
import { SITE, GUIDE } from "../content/comparisons.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");

// The trial is CARDLESS again (2026-08-06, migration 20260926 — the card
// wall converted 0 of 2 organic signups). The false claim is now the
// REVERSE of PR #560's sweep: content implying a card is needed to START
// the trial. ("Add a payment method" copy about converting/continuing
// after the trial is still fine — the regex targets start-the-trial claims.)
const CARD_REQUIRED_CLAIM = /(?:add|enter|requires?) a (?:credit )?card to (?:start|begin|try)|payment method to start|(?<!no )card (?:is )?required/i;

describe("blog — no stale 'card required to start trial' claims", () => {
  it("no post content claims the trial needs a card", () => {
    for (const post of POSTS) {
      expect(JSON.stringify(post), `post "${post.slug}"`).not.toMatch(CARD_REQUIRED_CLAIM);
    }
  });

  it("no generated blog page claims the trial needs a card", () => {
    const pages = [
      ["public", "blog", "index.html"],
      ["public", "for-printers", "index.html"],
      ...POSTS.map((p) => ["public", "blog", p.slug, "index.html"]),
    ];
    for (const p of pages) {
      expect(read(...p), p.join("/")).not.toMatch(CARD_REQUIRED_CLAIM);
    }
  });

  it("generator templates and comparison content are clean too", () => {
    expect(read("scripts", "generate-blog.mjs"), "generate-blog.mjs").not.toMatch(CARD_REQUIRED_CLAIM);
    expect(read("scripts", "generate-compare-pages.mjs"), "generate-compare-pages.mjs").not.toMatch(
      CARD_REQUIRED_CLAIM,
    );
    expect(JSON.stringify({ SITE, GUIDE }), "comparisons.mjs content").not.toMatch(CARD_REQUIRED_CLAIM);
    expect(read("index.html"), "index.html (app shell JSON-LD)").not.toMatch(CARD_REQUIRED_CLAIM);
  });
});

describe("blog — generated output in sync with content", () => {
  it("every post is built to disk and listed in the sitemap", () => {
    const sitemap = read("public", "sitemap.xml");
    for (const post of POSTS) {
      expect(
        existsSync(join(ROOT, "public", "blog", post.slug, "index.html")),
        `public/blog/${post.slug}/index.html — run npm run build:content`,
      ).toBe(true);
      expect(sitemap, `sitemap entry for ${post.slug}`).toContain(
        `${SITE.baseUrl}/blog/${post.slug}`,
      );
    }
  });
});

describe("blog index — ordering and category filter", () => {
  const index = () => read("public", "blog", "index.html");

  it("lists posts newest first (same-day ties: later POSTS entry first)", () => {
    const expected = [...POSTS]
      .sort((a, b) => b.date.localeCompare(a.date) || POSTS.indexOf(b) - POSTS.indexOf(a))
      .map((p) => p.slug);
    const listed = [...index().matchAll(/<h2><a href="[^"]*\/blog\/([^"]+)">/g)].map((m) => m[1]);
    expect(listed).toEqual(expected);
  });

  it("renders one filter chip per category plus All, and tags every card", () => {
    const html = index();
    const chips = [...html.matchAll(/data-filter="([^"]+)"/g)].map((m) => m[1]);
    expect(chips[0]).toBe("*");
    expect(new Set(chips.slice(1))).toEqual(new Set(POSTS.map((p) => p.category)));
    for (const post of POSTS) {
      expect(html, `card for ${post.slug} carries data-category`).toContain(
        `<li data-category="${post.category}">`,
      );
    }
  });

  it("keeps every card in the static HTML (filter is client-side show/hide only)", () => {
    const html = index();
    for (const post of POSTS) {
      expect(html, `${post.slug} must stay crawlable on the index`).toContain(
        `/blog/${post.slug}`,
      );
    }
  });
});
