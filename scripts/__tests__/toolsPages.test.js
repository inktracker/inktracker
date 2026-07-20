// Guards for the free /tools hub + Screen Printing Price Calculator.
// Asserts the generated static output (real crawlable content, SEO, CTAs,
// sitemap, nav) AND that the calculator shares ONE math source with the blog.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chartModel, chartCell, QTY_TIERS } from "../content/calc.mjs";

const ROOT = join(process.cwd());
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");
const HUB = read("public", "tools", "index.html");
const CALC = read("public", "tools", "screen-printing-price-calculator", "index.html");
const BASE = "https://www.inktracker.app";

describe("shared chart math (calc.mjs) — the one source", () => {
  it("computes cost-per-print and base from overhead", () => {
    const M = chartModel({ costs: 14000, shirts: 4000, margin: 45, vol: 10, color: 10 });
    expect(M.cpp).toBeCloseTo(3.5, 6);
    expect(M.base).toBeCloseTo(6.3636, 3); // 3.5 / 0.55
    expect(chartCell(M, 0, 0)).toBeCloseTo(M.base, 6); // 1 color, 25 qty = base
  });

  it("both generators import the SHARED calc module (no forked math)", () => {
    const blogSrc = read("scripts", "generate-blog.mjs");
    const toolsSrc = read("scripts", "generate-tools.mjs");
    expect(blogSrc).toMatch(/from "\.\/content\/calc\.mjs"/);
    expect(toolsSrc).toMatch(/from "\.\/content\/calc\.mjs"/);
    // The blog widget must no longer hand-roll the model inline.
    expect(blogSrc).toContain("chartModel(D)");
    expect(blogSrc).not.toContain("var tm=[1];for(var i=1;i<4;i++)tm[i]=tm[i-1]");
  });
});

describe("tools hub (/tools)", () => {
  it("is real HTML with the calculator card + link", () => {
    expect(HUB).toContain("<h1>Free tools for print shops</h1>");
    expect(HUB).toContain(`${BASE}/tools/screen-printing-price-calculator`);
    expect(HUB).toContain("Screen Printing Price Calculator");
  });
  it("card grid is array-driven (a <ul class=tool-grid> of <li> cards)", () => {
    expect(HUB).toMatch(/<ul class="tool-grid">[\s\S]*<li>[\s\S]*<\/ul>/);
  });
  it("SEO: title, non-www canonical, BreadcrumbList", () => {
    expect(HUB).toContain("<title>Free Tools for Print Shops</title>");
    expect(HUB).toContain(`<link rel="canonical" href="${BASE}/tools" />`);
    expect(HUB).toContain('"@type": "BreadcrumbList"');
  });
  it("soft CTA carries ?ref=tools", () => {
    expect(HUB).toContain(`${BASE}/?ref=tools`);
  });
});

describe("calculator page (/tools/screen-printing-price-calculator)", () => {
  it("static-first: both parts render real content without JS", () => {
    expect(CALC).toContain('id="calc-chart"');   // Part A chart
    expect(CALC).toContain('id="calc-full"');     // Part B controls
    expect(CALC).toContain('id="breakdown"');     // Part B breakdown
    // static grid has clickable cells + a static order total
    expect(CALC).toMatch(/<td[^>]*data-ci="0"[^>]*data-ti="0"/);
    expect(CALC).toMatch(/data-amt="total">\$[0-9,]+\.\d\d/);
  });

  it("static breakdown numbers equal a fresh recomputation (no drift)", () => {
    const M = chartModel({ costs: 14000, shirts: 4000, margin: 45, vol: 10, color: 10 });
    // defaults: 3 colors, qty 72 -> tier 50 (index 1), garment $6, no 2nd loc, setup on
    const ti = QTY_TIERS.reduce((idx, t, i) => (72 >= t ? i : idx), 0);
    expect(QTY_TIERS[ti]).toBe(50);
    const frontRate = chartCell(M, 2, ti);
    const front = frontRate * 72;
    const garment = 6 * 1.40 * 72; // markup 1.40 for a $6 blank
    const setup = 3 * 25;
    const total = front + garment + setup;
    const money = (n) => "$" + (Math.round(n * 100) / 100).toFixed(2);
    expect(CALC).toContain(`data-amt="front">${money(front)}`);
    expect(CALC).toContain(`data-amt="garment">${money(garment)}`);
    expect(CALC).toContain(`data-amt="setup">${money(setup)}`);
    expect(CALC).toContain(`data-amt="total">${money(total)}`);
    expect(CALC).toContain(`data-amt="pershirt">${money(total / 72)}`);
  });

  it("target margin slider goes to 100%, and the model floors the divisor (no Infinity)", () => {
    expect(CALC).toMatch(/data-in="margin"[^>]*max="100"/);
    const M = chartModel({ costs: 14000, shirts: 4000, margin: 100, vol: 0, color: 0 });
    expect(Number.isFinite(M.base)).toBe(true);
    expect(M.base).toBeCloseTo(350, 2); // 3.5 / 0.01 floor
  });

  it("selected cell changes color only — not font-weight (no column reflow / number shift)", () => {
    // the .sel rule must not set font-weight (that widened the cell and shifted the row)
    expect(CALC).toMatch(/\.calc-table td\.sel\{[^}]*\}/);
    const selRule = CALC.match(/\.calc-table td\.sel\{([^}]*)\}/)[1];
    expect(selRule).not.toContain("font-weight");
  });

  it("has the five Part A sliders and Part B controls", () => {
    for (const k of ["costs", "shirts", "margin", "vol", "color"]) {
      expect(CALC).toContain(`data-in="${k}"`);
    }
    expect(CALC).toContain('data-in="qty"');
    expect(CALC).toContain('data-in="garment"');
    expect(CALC).toContain('data-in="twoLoc"');
    expect(CALC).toContain('data-in="setup"');
  });

  it("SEO: title qualifier, non-www canonical, WebApplication+Offer(0)+BreadcrumbList", () => {
    expect(CALC).toMatch(/<title>Free Screen Printing Price Calculator[^<]*<\/title>/);
    expect(CALC).toContain(`<link rel="canonical" href="${BASE}/tools/screen-printing-price-calculator" />`);
    expect(CALC).toContain('"@type": "WebApplication"');
    expect(CALC).toContain('"applicationCategory": "BusinessApplication"');
    expect(CALC).toContain('"price": "0"');
    expect(CALC).toContain('"@type": "BreadcrumbList"');
  });

  it("soft CTA carries ?ref=calculator and links to the pricing posts + hub", () => {
    expect(CALC).toContain(`${BASE}/?ref=calculator`);
    expect(CALC).toContain(`${BASE}/blog/build-a-screen-printing-price-chart`);
    expect(CALC).toContain(`${BASE}/tools`);
    expect(CALC).toContain(`${BASE}/for-printers`);
  });

  it("makes no false 'no card' trial claim (trial requires a card)", () => {
    expect(CALC).not.toMatch(/no (?:credit )?card/i);
    expect(HUB).not.toMatch(/no (?:credit )?card/i);
  });
});

describe("resources hub (/resources)", () => {
  const RES = read("public", "resources", "index.html");
  it("groups Tools + Blog (+ guide, product) as cards", () => {
    expect(RES).toContain("<title>Resources for Print Shops</title>");
    expect(RES).toContain(`href="${BASE}/tools"`);
    expect(RES).toContain(`href="${BASE}/blog"`);
    expect(RES).toContain(`href="${BASE}/compare"`);
    expect(RES).toContain(`href="${BASE}/for-printers"`);
  });
  it("SEO: non-www canonical + BreadcrumbList", () => {
    expect(RES).toContain(`<link rel="canonical" href="${BASE}/resources" />`);
    expect(RES).toContain('"@type": "BreadcrumbList"');
  });
  it("the Start-trial button keeps white text (not overridden by .nav a)", () => {
    // .nav's link-color rule must exclude .cta so the button stays white
    const css = RES.match(/<style>([\s\S]*?)<\/style>/)[1];
    expect(css).toContain(".nav a:not(.cta)");
    expect(css).not.toMatch(/\.nav a\{[^}]*color/); // the bare, over-specific rule is gone
  });
});

describe("static header matches the app theme (nav + button)", () => {
  // The live app renders nav links + the Start-trial button in Anton, uppercase,
  // letter-spaced, with a square (non-rounded) button. Every static page must
  // match so the header reads consistently when you cross from the SPA.
  for (const page of ["resources", "tools", "blog", "compare", "for-printers"]) {
    const parts = page === "resources" || page === "tools" ? [page, "index.html"] : page === "blog" || page === "compare" ? [page, "index.html"] : [page, "index.html"];
    it(`/${page} nav links are Anton + uppercase + tracked`, () => {
      const css = read("public", ...parts).match(/<style>([\s\S]*?)<\/style>/)[1];
      const navRule = css.match(/\.nav a:not\(\.cta\)\{([^}]*)\}/)[1];
      expect(navRule).toContain("Anton");
      expect(navRule).toContain("text-transform:uppercase");
      expect(navRule).toContain("letter-spacing:.22em");
    });
    it(`/${page} Start-trial button is Anton + uppercase + square`, () => {
      const css = read("public", ...parts).match(/<style>([\s\S]*?)<\/style>/)[1];
      const ctaRule = css.match(/\.cta\{([^}]*)\}/)[1];
      expect(ctaRule).toContain("Anton");
      expect(ctaRule).toContain("text-transform:uppercase");
      expect(ctaRule).toContain("border-radius:0");
    });
  }
});

describe("sitemap + nav", () => {
  it("tools + resources URLs are in the sitemap", () => {
    const sm = read("public", "sitemap.xml");
    expect(sm).toContain(`<loc>${BASE}/resources</loc>`);
    expect(sm).toContain(`<loc>${BASE}/tools</loc>`);
    expect(sm).toContain(`<loc>${BASE}/tools/screen-printing-price-calculator</loc>`);
  });
  it("the site nav has a single Resources link → /resources (no crowding)", () => {
    const app = read("src", "App.jsx");
    expect(app).toMatch(/href="\/resources"[\s\S]*?Resources/);
    // the earlier separate Free-Tools nav link is gone
    expect(app).not.toMatch(/href="\/tools"[\s\S]{0,80}Free Tools/);
  });
  it("static page headers use one Resources link (Tools/Blog grouped under it)", () => {
    for (const f of ["tools/index.html", "blog/index.html", "compare/index.html"]) {
      const html = read("public", ...f.split("/"));
      const nav = html.match(/<nav class="nav">([\s\S]*?)<\/nav>/)[1];
      expect(nav).toContain(`href="${BASE}/resources"`);
    }
  });
  it("vercel.json rewrites /resources, /tools and /tools/*", () => {
    const vj = read("vercel.json");
    expect(vj).toContain('"source": "/resources"');
    expect(vj).toContain('"source": "/tools"');
    expect(vj).toContain('"source": "/tools/(.*)"');
  });
});
