// Guards for the static landing snapshot baked into index.html #root
// (scripts/generate-landing-static.mjs). Two invariants:
//   1. PARITY — the snapshot renders the same copy module the React landing
//      consumes, so crawlers see what visitors see (no shadow-page drift).
//   2. PLUMBING — the block lives INSIDE #root (so React replaces it) and
//      the SPA bootstrap is untouched.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { HERO, VALUE_PROPS, PRICING, PRICING_INCLUDES, FAQ_ITEMS } from "../../src/lib/landing/landingCopy.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const indexHtml = () => readFileSync(join(ROOT, "index.html"), "utf8");
const appJsx = () => readFileSync(join(ROOT, "src", "App.jsx"), "utf8");

// Mirror the generator's escaping so containment checks compare like to like.
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

describe("static landing snapshot — plumbing", () => {
  it("sits inside #root so React replaces it on boot", () => {
    expect(indexHtml()).toMatch(/<div id="root"><!-- landing-static:start -->/);
    expect(indexHtml()).toContain("<!-- landing-static:end --></div>");
  });

  it("leaves the SPA bootstrap intact", () => {
    const html = indexHtml();
    expect(html).toContain('<script type="module" src="/src/main.jsx"></script>');
    expect(html.match(/id="root"/g)).toHaveLength(1);
  });

  it("keeps the JSON-LD block (snapshot must not clobber the head)", () => {
    expect(indexHtml()).toContain('"@type": "SoftwareApplication"');
  });
});

describe("static landing snapshot — copy parity with landingCopy.js", () => {
  it("renders the hero as the page h1", () => {
    expect(indexHtml()).toContain(`<h1>${esc(HERO.h1)}</h1>`);
    expect(indexHtml()).toContain(esc(HERO.sub));
  });

  it("renders every value prop, pricing line, and included feature", () => {
    const html = indexHtml();
    for (const p of VALUE_PROPS) {
      expect(html, `value prop "${p.title}"`).toContain(esc(p.title));
      expect(html, `value prop body "${p.title}"`).toContain(esc(p.body));
    }
    expect(html).toContain(esc(PRICING.annualLine));
    for (const f of PRICING_INCLUDES) {
      expect(html, `included feature "${f}"`).toContain(`<li>${esc(f)}</li>`);
    }
  });

  it("renders every FAQ question and answer", () => {
    const html = indexHtml();
    for (const f of FAQ_ITEMS) {
      expect(html, `FAQ "${f.q}"`).toContain(esc(f.q));
      expect(html, `FAQ answer for "${f.q}"`).toContain(esc(f.a));
    }
  });

  it("App.jsx consumes the same module (anti-drift: no inlined copies)", () => {
    const src = appJsx();
    expect(src).toContain('from "@/lib/landing/landingCopy"');
    // The old inline arrays must not resurface — one canary string per array.
    expect(src.match(/Can I import data from Printavo/g)).toBeNull();
    expect(src.match(/Live garment costs from S&S/g)).toBeNull();
    expect(src.match(/"Embeddable quote wizard"/g)).toBeNull();
  });
});
