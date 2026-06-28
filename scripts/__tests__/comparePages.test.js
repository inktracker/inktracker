// Quality gate for the static buyer's-guide page (public/compare/index.html)
// and its content source. Keeps the output honest + crawlable: re-run
// `npm run build:content` if these fail after a content edit.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SITE, GUIDE } from "../content/comparisons.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const guidePath = join(ROOT, "public", "compare", "index.html");
const html = () => readFileSync(guidePath, "utf8");

const jsonLdBlocks = (h) =>
  [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) =>
    JSON.parse(m[1]),
  );

describe("buyer's guide — content integrity", () => {
  it("is framed neutrally — no head-to-head 'vs' or 'alternatives to X' wording", () => {
    const h = html().toLowerCase();
    expect(h).not.toMatch(/inktracker vs/);
    expect(h).not.toMatch(/\balternatives to\b/);
  });

  it("lists InkTracker as one option among competitors, in alphabetical order", () => {
    const names = GUIDE.landscape.map((o) => o.name);
    expect(names).toContain("InkTracker");
    expect(names.length).toBeGreaterThanOrEqual(3);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it("every landscape entry has a positive blurb + 'good for' (no negative claims)", () => {
    for (const o of GUIDE.landscape) {
      expect(o.blurb, `${o.name} blurb`).toBeTruthy();
      expect(o.bestFor, `${o.name} bestFor`).toBeTruthy();
    }
  });
});

describe("buyer's guide — page structure & SEO", () => {
  it("exists on disk", () => {
    expect(existsSync(guidePath)).toBe(true);
  });

  it("has a title, single h1, canonical, and parseable JSON-LD", () => {
    const h = html();
    const title = (h.match(/<title>(.*?)<\/title>/) || [])[1];
    expect(title, "title").toBeTruthy();
    expect(title.length, "title length").toBeLessThanOrEqual(75);
    expect((h.match(/<h1>/g) || []).length, "exactly one h1").toBe(1);
    expect(/rel="canonical"/.test(h), "canonical").toBe(true);
    expect(h).toContain(`href="${GUIDE.url}"`);
  });

  it("carries FAQPage + BreadcrumbList JSON-LD; FAQ entries match content", () => {
    const blocks = jsonLdBlocks(html());
    const faqLd = blocks.find((b) => b["@type"] === "FAQPage");
    const crumb = blocks.find((b) => b["@type"] === "BreadcrumbList");
    expect(faqLd, "FAQPage").toBeTruthy();
    expect(crumb, "BreadcrumbList").toBeTruthy();
    expect(faqLd.mainEntity.length).toBe(GUIDE.faqs.length);
  });

  it("surfaces InkTracker's verifiable differentiators", () => {
    const h = html();
    expect(h).toMatch(/QuickBooks/);
    expect(h).toMatch(/S&amp;S|AS Colour/);
  });

  it("/compare is present in the sitemap", () => {
    const sitemap = readFileSync(join(ROOT, "public", "sitemap.xml"), "utf8");
    expect(sitemap).toContain(`<loc>${GUIDE.url}</loc>`);
  });
});
