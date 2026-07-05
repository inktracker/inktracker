// ─────────────────────────────────────────────────────────────────────────
// Static buyer's-guide generator. Reads scripts/content/comparisons.mjs and
// writes one hand-styled, fully crawlable HTML page → public/compare/index.html
// (served at /compare). Vite copies public/ → dist/ untouched, so this runs
// INDEPENDENTLY of the app build:
//   npm run build:content
// The output is committed (it's a static asset), so `vite build` never needs
// to run this. Re-run it whenever content changes.
//
// Why static HTML and not a React route: the app is a client-rendered SPA, so
// React routes are near-invisible to AI retrievers / crawlers that don't run
// JS. This page exists FOR search + AI discovery, so it ships as real HTML.
//
// Framing is a NEUTRAL buyer's guide (no "vs <company>" pages) — see the
// content module header.
// ─────────────────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SITE, GUIDE } from "./content/comparisons.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "public", "compare");

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const CSS = `:root{--ink:#0e0e0e;--muted:#6b6b6b;--hair:#e5e5e5;--forest:#2c5840;--forest-dark:#1a3a28}
*{box-sizing:border-box}
body{margin:0;color:var(--ink);background:#fff;font-family:"Inter",-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--forest)}
.wrap{max-width:820px;margin:0 auto;padding:0 20px}
header.site{position:sticky;top:0;z-index:10;background:rgba(255,255,255,.95);backdrop-filter:blur(8px);border-bottom:2px solid var(--ink)}
header.site .wrap{display:flex;align-items:center;justify-content:space-between;height:72px}
.brand{font-family:"Anton","Oswald","Arial Narrow",sans-serif;font-size:26px;letter-spacing:.02em;text-transform:uppercase;color:var(--ink);text-decoration:none}
.brand span{color:var(--forest)}
.cta{display:inline-block;background:var(--forest);color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px;font-size:15px}
.cta:hover{background:var(--forest-dark)}
nav.crumbs{font-size:13px;color:var(--muted);padding:18px 0 0}
nav.crumbs a{color:var(--muted)}
h1{font-family:"Anton","Oswald","Arial Narrow",sans-serif;text-transform:uppercase;letter-spacing:.01em;line-height:1.02;font-size:clamp(2.2rem,6vw,3.6rem);margin:.4em 0 .2em}
h2{font-family:"Anton","Oswald","Arial Narrow",sans-serif;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(1.4rem,3.5vw,2rem);margin:1.8em 0 .5em}
h3{font-size:1.05rem;margin:0 0 .25em}
.lede{font-size:1.12rem;color:#262626}
.reviewed{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-top:6px}
ul.criteria{list-style:none;padding:0;margin:1em 0}
ul.criteria li{padding:14px 0 14px 30px;position:relative;border-bottom:1px solid var(--hair)}
ul.criteria li:before{content:"\\2713";position:absolute;left:0;top:14px;color:var(--forest);font-weight:800}
ul.criteria b{display:block;margin-bottom:2px}
ul.criteria span{color:#444;font-size:15px}
.cards{display:grid;gap:14px;margin:1.2em 0}
.card{border:1px solid var(--hair);border-radius:12px;padding:18px 20px}
.card.us{border-color:var(--forest);background:#f6faf7}
.card h3 a{color:var(--ink);text-decoration:none}
.card h3 a:hover{color:var(--forest)}
.card .best{font-size:13px;color:var(--muted);margin-top:.6em}
.cta-block{text-align:center;border:2px solid var(--ink);border-radius:14px;padding:32px 24px;margin:2.4em 0}
.cta-block .price{font-family:"Anton",sans-serif;font-size:2.4rem}
.faq dt{font-weight:700;margin-top:1em}
.faq dd{margin:.2em 0 0;color:#333}
.disclaimer{font-size:12px;color:var(--muted);border-top:1px solid var(--hair);margin-top:3em;padding:18px 0}
footer.site{border-top:2px solid var(--ink);margin-top:2em;padding:24px 0;font-size:13px;color:var(--muted)}
footer.site a{color:var(--muted);margin-right:16px}
@media(min-width:640px){.cards{grid-template-columns:1fr 1fr}}`;

const siteHeader = `<header class="site"><div class="wrap">
  <a class="brand" href="${SITE.baseUrl}/">Ink<span>Tracker</span></a>
  <a class="cta" href="${SITE.baseUrl}/#pricing">Start free trial</a>
</div></header>`;

const siteFooter = `<footer class="site"><div class="wrap">
  <a href="${SITE.baseUrl}/">InkTracker home</a><a href="${SITE.baseUrl}/tools">Free Tools</a><a href="${SITE.baseUrl}/#pricing">Pricing</a><a href="${SITE.baseUrl}/support">Support</a>
  <p>InkTracker is built and used in daily production at <a href="https://biotamfg.com">Biota Mfg</a>, a working screen-print shop in Reno.</p>
</div></footer>`;

const DISCLAIMER = `<p class="disclaimer">This guide reflects publicly available information, last reviewed ${SITE.reviewed}. Product names and trademarks belong to their respective owners; details and pricing change — always confirm current specifics on each vendor's own website. InkTracker details reflect the live product.</p>`;

const ldJson = (obj) => `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`;

function ctaBlock() {
  // The Biota line is the "real shop runs on this" proof signal — soft
  // trust, one sentence, never keyword-stuffed (SEO plan item 5).
  return `<div class="cta-block">
    <div class="price">${SITE.price}</div>
    <p>InkTracker: one plan, everything included. ${esc(SITE.trial)}.</p>
    <p>Built and battle-tested in daily production at <a href="https://biotamfg.com">Biota Mfg</a>, a working screen-print shop in Reno.</p>
    <a class="cta" href="${SITE.baseUrl}/#pricing">Start your free trial</a>
  </div>`;
}

function render() {
  const canonical = GUIDE.url;
  const intro = GUIDE.intro.map((t) => `<p class="lede">${esc(t)}</p>`).join("\n");
  const criteria = GUIDE.criteria
    .map((c) => `<li><b>${esc(c.name)}</b><span>${esc(c.why)}</span></li>`)
    .join("\n");
  const cards = GUIDE.landscape
    .map(
      (o) => `<div class="card${o.name === SITE.name ? " us" : ""}">
      <h3><a href="${esc(o.url)}">${esc(o.name)}</a></h3>
      <p>${esc(o.blurb)}</p>
      <p class="best"><strong>Good for:</strong> ${esc(o.bestFor)}</p>
    </div>`,
    )
    .join("\n");
  const faqs = GUIDE.faqs.map((f) => `<dt>${esc(f.q)}</dt><dd>${esc(f.a)}</dd>`).join("\n");

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "InkTracker", item: `${SITE.baseUrl}/` },
      { "@type": "ListItem", position: 2, name: "Software guide", item: canonical },
    ],
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: GUIDE.faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(GUIDE.title)}</title>
  <meta name="description" content="${esc(GUIDE.metaDescription)}" />
  <link rel="canonical" href="${esc(canonical)}" />
  <link rel="icon" type="image/png" href="/icon-192.png" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${esc(GUIDE.title)}" />
  <meta property="og:description" content="${esc(GUIDE.metaDescription)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${SITE.logo}" />
  <meta name="twitter:card" content="summary" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;700;800&display=swap" />
  <style>${CSS}</style>
  ${ldJson(breadcrumb)}
  ${ldJson(faqLd)}
</head>
<body>
${siteHeader}
<main class="wrap">
  <nav class="crumbs"><a href="${SITE.baseUrl}/">Home</a> › Software guide</nav>
  <h1>${esc(GUIDE.h1)}</h1>
  <p class="reviewed">Reviewed ${esc(SITE.reviewed)}</p>
  ${intro}

  <h2>What to look for</h2>
  <ul class="criteria">
${criteria}
  </ul>

  <h2>The leading options</h2>
  <p>A fair look at well-known screen-printing platforms, in alphabetical order. Each is good at different things.</p>
  <div class="cards">
${cards}
  </div>

  ${ctaBlock()}

  <h2>FAQ</h2>
  <dl class="faq">
${faqs}
  </dl>

  ${DISCLAIMER}
</main>
${siteFooter}
</body>
</html>`;
}

// ── sitemap sync (managed block) ────────────────────────────────────────────
function syncSitemap() {
  const path = join(ROOT, "public", "sitemap.xml");
  const block = `  <!-- compare-pages:start -->\n  <url>\n    <loc>${GUIDE.url}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>\n  <!-- compare-pages:end -->`;
  let xml = readFileSync(path, "utf8");
  if (xml.includes("<!-- compare-pages:start -->")) {
    xml = xml.replace(/  <!-- compare-pages:start -->[\s\S]*?  <!-- compare-pages:end -->/, block);
  } else {
    xml = xml.replace("</urlset>", `${block}\n</urlset>`);
  }
  writeFileSync(path, xml);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "index.html"), render());
syncSitemap();
console.log("✓ Generated buyer's guide → public/compare/index.html");
console.log("✓ Synced /compare into public/sitemap.xml");
