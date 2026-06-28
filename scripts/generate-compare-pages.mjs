// ─────────────────────────────────────────────────────────────────────────
// Static comparison-page generator. Reads scripts/content/comparisons.mjs and
// writes hand-styled, fully crawlable HTML into public/compare/. Vite copies
// public/ → dist/ untouched, so this runs INDEPENDENTLY of the app build:
//   npm run build:content
// The output is committed to the repo (it's a static asset), so `vite build`
// never needs to run this. Re-run it whenever content changes.
//
// Why static HTML and not a React route: the app is a client-rendered SPA, so
// React routes are near-invisible to AI retrievers / crawlers that don't run
// JS. These pages exist FOR search + AI discovery, so they ship as real HTML.
// ─────────────────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SITE, PAGES, PILLAR, INKTRACKER_EDGE } from "./content/comparisons.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "public", "compare");

// ── tiny HTML helpers ──────────────────────────────────────────────────────
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Cell rendering: a "✓ ..." string gets a green check; a bare "—" gets muted.
function cell(value) {
  const v = String(value ?? "");
  if (v.startsWith("✓")) return `<span class="yes">✓</span>${esc(v.slice(1))}`;
  if (v === "—") return `<span class="no">—</span>`;
  return esc(v);
}

const CSS = `:root{--ink:#0e0e0e;--muted:#6b6b6b;--hair:#e5e5e5;--forest:#2c5840;--forest-dark:#1a3a28}
*{box-sizing:border-box}
body{margin:0;color:var(--ink);background:#fff;font-family:"Inter",-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--forest)}
.wrap{max-width:880px;margin:0 auto;padding:0 20px}
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
h3{font-size:1.05rem;margin:1.4em 0 .3em}
.lede{font-size:1.12rem;color:#262626}
.reviewed{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-top:6px}
table{width:100%;border-collapse:collapse;margin:1.2em 0;font-size:15px}
th,td{text-align:left;padding:12px 14px;border-bottom:1px solid var(--hair);vertical-align:top}
th{font-family:"Anton","Oswald",sans-serif;text-transform:uppercase;letter-spacing:.03em;font-weight:400;font-size:13px;color:var(--muted)}
td:first-child{font-weight:600}
.it-col{color:var(--forest-dark)}
.yes{color:var(--forest);font-weight:800;margin-right:4px}
.no{color:#b0b0b0}
ul.edge{list-style:none;padding:0;margin:1em 0}
ul.edge li{padding:8px 0 8px 28px;position:relative;border-bottom:1px solid var(--hair)}
ul.edge li:before{content:"✓";position:absolute;left:0;color:var(--forest);font-weight:800}
.panel{border:1px solid var(--hair);border-radius:12px;padding:20px 22px;margin:1.2em 0;background:#fafafa}
.faq dt{font-weight:700;margin-top:1em}
.faq dd{margin:.2em 0 0;color:#333}
.cta-block{text-align:center;border:2px solid var(--ink);border-radius:14px;padding:32px 24px;margin:2.4em 0}
.cta-block .price{font-family:"Anton",sans-serif;font-size:2.4rem}
.cards{display:grid;gap:14px;margin:1.2em 0}
.card{border:1px solid var(--hair);border-radius:12px;padding:18px 20px}
.card h3{margin:0 0 .3em}
.card .best{font-size:13px;color:var(--muted);margin-top:.5em}
.disclaimer{font-size:12px;color:var(--muted);border-top:1px solid var(--hair);margin-top:3em;padding:18px 0}
footer.site{border-top:2px solid var(--ink);margin-top:2em;padding:24px 0;font-size:13px;color:var(--muted)}
footer.site a{color:var(--muted);margin-right:16px}
@media(min-width:640px){.cards{grid-template-columns:1fr 1fr}}`;

const siteHeader = `<header class="site"><div class="wrap">
  <a class="brand" href="${SITE.baseUrl}/">Ink<span>Tracker</span></a>
  <a class="cta" href="${SITE.baseUrl}/#pricing">Start free trial</a>
</div></header>`;

function siteFooter(currentSlug) {
  const links = [
    ...PAGES.map((p) => ({ slug: p.slug, label: `vs ${p.competitor}` })),
    { slug: PILLAR.slug, label: "Printavo alternatives" },
  ]
    .filter((l) => l.slug !== currentSlug)
    .map((l) => `<a href="/compare/${l.slug}">${esc(l.label)}</a>`)
    .join("");
  return `<footer class="site"><div class="wrap">
    <div style="margin-bottom:10px">${links}</div>
    <a href="${SITE.baseUrl}/">InkTracker home</a><a href="/compare">All comparisons</a>
  </div></footer>`;
}

const DISCLAIMER = `<p class="disclaimer">Comparison based on publicly available information, last reviewed ${SITE.reviewed}. Competitor names and trademarks belong to their respective owners; details and pricing change — always confirm current specifics on the vendor's own website. InkTracker details reflect the live product.</p>`;

function ldJson(obj) {
  return `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`;
}

function pageHead({ title, metaDescription, canonical, jsonld }) {
  const blocks = jsonld.map(ldJson).join("\n    ");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(metaDescription)}" />
  <link rel="canonical" href="${esc(canonical)}" />
  <link rel="icon" type="image/png" href="/icon-192.png" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(metaDescription)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${SITE.logo}" />
  <meta name="twitter:card" content="summary" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;700;800&display=swap" />
  <style>${CSS}</style>
    ${blocks}
</head>`;
}

function breadcrumbLd(name, url) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "InkTracker", item: `${SITE.baseUrl}/` },
      { "@type": "ListItem", position: 2, name: "Comparisons", item: `${SITE.baseUrl}/compare` },
      { "@type": "ListItem", position: 3, name, item: url },
    ],
  };
}

function faqLd(faqs) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

function ctaBlock() {
  return `<div class="cta-block">
    <div class="price">${SITE.price}</div>
    <p>One plan, everything included. ${esc(SITE.trial)}.</p>
    <a class="cta" href="${SITE.baseUrl}/#pricing">Start your free trial</a>
  </div>`;
}

// ── comparison page ─────────────────────────────────────────────────────────
function renderComparison(p) {
  const canonical = `${SITE.baseUrl}/compare/${p.slug}`;
  const rows = p.table
    .map(
      (r) =>
        `<tr><td>${esc(r.feature)}</td><td class="it-col">${cell(r.it)}</td><td>${cell(r.comp)}</td></tr>`,
    )
    .join("\n");
  const intro = p.intro.map((t) => `<p class="lede">${esc(t)}</p>`).join("\n");
  const edge = INKTRACKER_EDGE.map((e) => `<li>${esc(e)}</li>`).join("\n");
  const faqs = p.faqs
    .map((f) => `<dt>${esc(f.q)}</dt><dd>${esc(f.a)}</dd>`)
    .join("\n");

  const body = `<body>
${siteHeader}
<main class="wrap">
  <nav class="crumbs"><a href="${SITE.baseUrl}/">Home</a> › <a href="/compare">Comparisons</a> › ${esc(p.competitor)}</nav>
  <h1>${esc(p.h1)}</h1>
  <p class="reviewed">Reviewed ${esc(SITE.reviewed)}</p>
  ${intro}

  <h2>At a glance</h2>
  <table>
    <thead><tr><th>Feature</th><th>InkTracker</th><th>${esc(p.competitor)}</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>

  <h2>What ${esc(p.competitor)} is good at</h2>
  <p>${esc(p.competitorGood)}</p>

  <h2>Where InkTracker is different</h2>
  <ul class="edge">
${edge}
  </ul>

  ${ctaBlock()}

  <h2>FAQ</h2>
  <dl class="faq">
${faqs}
  </dl>

  ${DISCLAIMER}
</main>
${siteFooter(p.slug)}
</body>
</html>`;

  return (
    pageHead({
      title: p.title,
      metaDescription: p.metaDescription,
      canonical,
      jsonld: [breadcrumbLd(p.h1, canonical), faqLd(p.faqs)],
    }) +
    "\n" +
    body
  );
}

// ── pillar / alternatives page ──────────────────────────────────────────────
function renderPillar() {
  const canonical = `${SITE.baseUrl}/compare/${PILLAR.slug}`;
  const intro = PILLAR.intro.map((t) => `<p class="lede">${esc(t)}</p>`).join("\n");
  const cards = PILLAR.options
    .map(
      (o) => `<div class="card">
      <h3><a href="${esc(o.url)}">${esc(o.name)}</a></h3>
      <p>${esc(o.pitch)}</p>
      <p class="best"><strong>Best for:</strong> ${esc(o.bestFor)}</p>
    </div>`,
    )
    .join("\n");

  const body = `<body>
${siteHeader}
<main class="wrap">
  <nav class="crumbs"><a href="${SITE.baseUrl}/">Home</a> › <a href="/compare">Comparisons</a> › Printavo alternatives</nav>
  <h1>${esc(PILLAR.h1)}</h1>
  <p class="reviewed">Reviewed ${esc(SITE.reviewed)}</p>
  ${intro}
  <div class="cards">
${cards}
  </div>
  ${ctaBlock()}
  ${DISCLAIMER}
</main>
${siteFooter(PILLAR.slug)}
</body>
</html>`;

  return (
    pageHead({
      title: PILLAR.title,
      metaDescription: PILLAR.metaDescription,
      canonical,
      jsonld: [breadcrumbLd(PILLAR.h1, canonical)],
    }) +
    "\n" +
    body
  );
}

// ── /compare index ──────────────────────────────────────────────────────────
function renderIndex() {
  const canonical = `${SITE.baseUrl}/compare`;
  const cards = [
    ...PAGES.map(
      (p) => `<div class="card"><h3><a href="/compare/${p.slug}">InkTracker vs ${esc(p.competitor)}</a></h3><p>${esc(p.intro[0])}</p></div>`,
    ),
    `<div class="card"><h3><a href="/compare/${PILLAR.slug}">Printavo alternatives</a></h3><p>${esc(PILLAR.intro[0])}</p></div>`,
  ].join("\n");

  const body = `<body>
${siteHeader}
<main class="wrap">
  <nav class="crumbs"><a href="${SITE.baseUrl}/">Home</a> › Comparisons</nav>
  <h1>How InkTracker compares</h1>
  <p class="lede">Honest, up-to-date comparisons against the leading screen-printing shop management platforms.</p>
  <div class="cards">
${cards}
  </div>
  ${ctaBlock()}
  ${DISCLAIMER}
</main>
${siteFooter("")}
</body>
</html>`;

  return (
    pageHead({
      title: "Compare InkTracker to Screen Printing Software Leaders (2026)",
      metaDescription:
        "See how InkTracker compares to Printavo, YoPrint, InkSoft, and DecoNetwork on pricing, QuickBooks sync, live garment pricing, and production tools.",
      canonical,
      jsonld: [breadcrumbLd("Comparisons", canonical)],
    }) +
    "\n" +
    body
  );
}

// ── sitemap sync ────────────────────────────────────────────────────────────
// Rewrites the <!-- compare-pages --> managed block in public/sitemap.xml so
// the new URLs are always discoverable. Idempotent.
function syncSitemap() {
  const path = join(ROOT, "public", "sitemap.xml");
  const urls = [
    `${SITE.baseUrl}/compare`,
    ...PAGES.map((p) => `${SITE.baseUrl}/compare/${p.slug}`),
    `${SITE.baseUrl}/compare/${PILLAR.slug}`,
  ];
  const block = urls
    .map((u) => `  <url>\n    <loc>${u}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`)
    .join("\n");
  const managed = `  <!-- compare-pages:start -->\n${block}\n  <!-- compare-pages:end -->`;

  let xml = readFileSync(path, "utf8");
  if (xml.includes("<!-- compare-pages:start -->")) {
    xml = xml.replace(
      /  <!-- compare-pages:start -->[\s\S]*?  <!-- compare-pages:end -->/,
      managed,
    );
  } else {
    xml = xml.replace("</urlset>", `${managed}\n</urlset>`);
  }
  writeFileSync(path, xml);
  return urls.length;
}

// ── run ─────────────────────────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });

let count = 0;
writeFileSync(join(OUT_DIR, "index.html"), renderIndex());
count++;
for (const p of PAGES) {
  writeFileSync(join(OUT_DIR, `${p.slug}.html`), renderComparison(p));
  count++;
}
writeFileSync(join(OUT_DIR, `${PILLAR.slug}.html`), renderPillar());
count++;

const sitemapCount = syncSitemap();
console.log(`✓ Generated ${count} comparison pages → public/compare/`);
console.log(`✓ Synced ${sitemapCount} URLs into public/sitemap.xml`);
