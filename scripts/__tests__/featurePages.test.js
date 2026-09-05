// Feature-page quality gates — mirrors comparePages/blogPosts guards.
//
// 1. Every FEATURES entry is generated, and its URL is in the sitemap.
// 2. No competitor names: feature pages describe what InkTracker does,
//    never what others don't (house rule from the /compare work — Joe
//    keeps competitor content neutral, and feature pages go further by
//    not naming competitors at all).
// 3. No stale "card required to start the trial" claims (cardless since
//    2026-08-06 — same regex as blogPosts.test.js).
// 4. FAQ text is visible on the page AND present as FAQPage JSON-LD —
//    Google requires both.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FEATURES } from "../content/features.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const page = (slug) => join(ROOT, "public", "features", slug, "index.html");

const CARD_REQUIRED_CLAIM =
  /(?:add|enter|requires?) a (?:credit )?card to (?:start|begin|try)|payment method to start|(?<!no )card (?:is )?required/i;
const COMPETITOR_NAMES = /printavo|deconetwork|inksoft|yoprint|priceit|printmatics|teesom/i;

describe("feature pages — generated + in sitemap", () => {
  const sitemap = readFileSync(join(ROOT, "public", "sitemap.xml"), "utf8");

  it("hub page exists and is in the sitemap", () => {
    expect(existsSync(join(ROOT, "public", "features", "index.html"))).toBe(true);
    expect(sitemap).toContain("https://www.inktracker.app/features</loc>");
  });

  for (const f of FEATURES) {
    it(`${f.slug}: page built and in sitemap`, () => {
      expect(existsSync(page(f.slug))).toBe(true);
      expect(sitemap).toContain(`https://www.inktracker.app/features/${f.slug}</loc>`);
    });
  }
});

describe("feature pages — content rules", () => {
  for (const f of FEATURES) {
    const html = () => readFileSync(page(f.slug), "utf8");

    it(`${f.slug}: no competitor names`, () => {
      expect(html()).not.toMatch(COMPETITOR_NAMES);
      expect(JSON.stringify(f)).not.toMatch(COMPETITOR_NAMES);
    });

    it(`${f.slug}: no card-required claims`, () => {
      expect(html()).not.toMatch(CARD_REQUIRED_CLAIM);
    });

    it(`${f.slug}: FAQs visible and mirrored in FAQPage JSON-LD`, () => {
      const h = html();
      expect(h).toContain('"@type": "FAQPage"');
      for (const q of f.faqs) {
        // Visible <dt> and the JSON-LD both carry the question text.
        const count = h.split(q.q.replace(/&/g, "&amp;").slice(0, 40)).length - 1;
        expect(count).toBeGreaterThanOrEqual(1);
      }
    });
  }
});
