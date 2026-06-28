// Quality gate for the static comparison pages (public/compare/*.html) and
// their content source. Keeps the generated output honest + crawlable:
// re-run `npm run build:content` if these fail after a content edit.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SITE, PAGES, PILLAR, INKTRACKER_EDGE } from "../content/comparisons.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const compareDir = join(ROOT, "public", "compare");
const read = (slug) => readFileSync(join(compareDir, `${slug}.html`), "utf8");

const jsonLdBlocks = (html) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) =>
    JSON.parse(m[1]),
  );

const allSlugs = [...PAGES.map((p) => p.slug), PILLAR.slug, "index"];

describe("comparison pages — content integrity", () => {
  it("has unique slugs", () => {
    const slugs = [...PAGES.map((p) => p.slug), PILLAR.slug];
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every InkTracker comparison cell is verifiable (✓ / text), never a bare negative claim about us", () => {
    for (const p of PAGES) {
      for (const row of p.table) {
        expect(row.it, `${p.slug} / ${row.feature}`).toBeTruthy();
        expect(row.it).not.toBe("—"); // we never sell ourselves short with an em-dash
      }
    }
  });
});

describe.each(allSlugs)("generated page: %s.html", (slug) => {
  it("exists on disk", () => {
    expect(existsSync(join(compareDir, `${slug}.html`))).toBe(true);
  });

  it("has a title, single h1, canonical, and parseable JSON-LD", () => {
    const html = read(slug);
    const title = (html.match(/<title>(.*?)<\/title>/) || [])[1];
    expect(title, "title").toBeTruthy();
    expect(title.length, "title length").toBeLessThanOrEqual(75);
    expect((html.match(/<h1>/g) || []).length, "exactly one h1").toBe(1);
    expect(/rel="canonical"/.test(html), "canonical").toBe(true);
    expect(() => jsonLdBlocks(html)).not.toThrow();
    expect(jsonLdBlocks(html).length, "at least one JSON-LD block").toBeGreaterThan(0);
  });

  it("internal /compare links point to pages that exist", () => {
    const html = read(slug);
    const links = [...html.matchAll(/href="\/compare\/([a-z0-9-]+)"/g)].map((m) => m[1]);
    for (const target of links) {
      expect(existsSync(join(compareDir, `${target}.html`)), `dead link → ${target}`).toBe(true);
    }
  });
});

describe("comparison pages — SEO wiring", () => {
  it("each comparison page canonical matches its public URL", () => {
    for (const p of PAGES) {
      const html = read(p.slug);
      expect(html).toContain(`href="${SITE.baseUrl}/compare/${p.slug}"`);
    }
  });

  it("FAQ pages carry FAQPage JSON-LD with one entry per FAQ", () => {
    for (const p of PAGES) {
      const faqLd = jsonLdBlocks(read(p.slug)).find((b) => b["@type"] === "FAQPage");
      expect(faqLd, `${p.slug} FAQPage`).toBeTruthy();
      expect(faqLd.mainEntity.length).toBe(p.faqs.length);
    }
  });

  it("every page URL is present in the sitemap", () => {
    const sitemap = readFileSync(join(ROOT, "public", "sitemap.xml"), "utf8");
    expect(sitemap).toContain(`${SITE.baseUrl}/compare`);
    for (const p of PAGES) expect(sitemap).toContain(`${SITE.baseUrl}/compare/${p.slug}`);
    expect(sitemap).toContain(`${SITE.baseUrl}/compare/${PILLAR.slug}`);
  });

  it("pages surface InkTracker's verifiable differentiators", () => {
    const printavo = read("inktracker-vs-printavo");
    // QuickBooks + live supplier pricing are the load-bearing, true claims.
    expect(printavo).toMatch(/QuickBooks/);
    expect(printavo).toMatch(/S&amp;S|AS Colour/);
    expect(INKTRACKER_EDGE.length).toBeGreaterThan(0);
  });
});
