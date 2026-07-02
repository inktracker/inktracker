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

// The trial REQUIRES a card (since 2026-07-02). Any "no card" phrasing in
// marketing content is a false claim — see PR #560 for the original sweep.
const NO_CARD_CLAIM = /no (?:credit )?card|without a (?:credit )?card|card[- ]?free/i;

describe("blog — no false 'no card' trial claims", () => {
  it("no post content claims the trial is card-free", () => {
    for (const post of POSTS) {
      expect(JSON.stringify(post), `post "${post.slug}"`).not.toMatch(NO_CARD_CLAIM);
    }
  });

  it("no generated blog page claims the trial is card-free", () => {
    const pages = [
      ["public", "blog", "index.html"],
      ["public", "for-printers", "index.html"],
      ...POSTS.map((p) => ["public", "blog", p.slug, "index.html"]),
    ];
    for (const p of pages) {
      expect(read(...p), p.join("/")).not.toMatch(NO_CARD_CLAIM);
    }
  });

  it("generator templates and comparison content are clean too", () => {
    expect(read("scripts", "generate-blog.mjs"), "generate-blog.mjs").not.toMatch(NO_CARD_CLAIM);
    expect(read("scripts", "generate-compare-pages.mjs"), "generate-compare-pages.mjs").not.toMatch(
      NO_CARD_CLAIM,
    );
    expect(JSON.stringify({ SITE, GUIDE }), "comparisons.mjs content").not.toMatch(NO_CARD_CLAIM);
    expect(read("index.html"), "index.html (app shell JSON-LD)").not.toMatch(NO_CARD_CLAIM);
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
