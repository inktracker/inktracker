// ─────────────────────────────────────────────────────────────────────────
// Static feature-page generator. Reads scripts/content/features.mjs and
// writes crawlable HTML → public/features/<slug>/index.html plus a hub at
// public/features/index.html. Same architecture as generate-compare-pages:
// content-as-data, committed output, runs via `npm run build:content`,
// independent of `vite build` (Vite copies public/ → dist/).
//
// These pages exist so the product's differentiators have LINKABLE, quotable
// homes for search, AI answer engines, and outbound — the app itself is a
// client-rendered SPA that crawlers can't read.
// ─────────────────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SITE, FEATURES } from "./content/features.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "public", "features");

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Brand CSS — kept in lockstep with generate-compare-pages.mjs (Anton/Inter,
// ink + forest, solid .cta — never rounded outline pills).
const CSS = `:root{--ink:#0e0e0e;--muted:#6b6b6b;--hair:#e5e5e5;--forest:#2c5840;--forest-dark:#1a3a28}
*{box-sizing:border-box}
body{margin:0;color:var(--ink);background:#fff;font-family:"Inter",-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--forest)}
.wrap{max-width:820px;margin:0 auto;padding:0 20px}
header.site{position:sticky;top:0;z-index:10;background:rgba(255,255,255,.95);backdrop-filter:blur(8px);border-bottom:2px solid var(--ink)}
header.site .wrap{display:flex;align-items:center;justify-content:space-between;height:72px;gap:16px}
.brand{font-family:"Anton","Oswald","Arial Narrow",sans-serif;font-size:26px;letter-spacing:.02em;text-transform:uppercase;color:var(--ink);text-decoration:none}
.brand span{color:var(--forest)}
.cta{display:inline-block;background:var(--forest);color:#fff;text-decoration:none;font-family:"Anton","Oswald","Arial Narrow",sans-serif;font-size:12px;font-weight:400;letter-spacing:.08em;text-transform:uppercase;padding:14px 28px;border-radius:0;white-space:nowrap}
.cta:hover{background:var(--forest-dark)}
.nav{display:flex;align-items:center;gap:18px}
.nav a:not(.cta){font-family:"Anton","Oswald","Arial Narrow",sans-serif;font-size:12px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:var(--ink);text-decoration:none}
.nav a:not(.cta):hover{color:var(--forest)}
nav.crumbs{font-size:13px;color:var(--muted);padding:18px 0 0}
nav.crumbs a{color:var(--muted)}
h1{font-family:"Anton","Oswald","Arial Narrow",sans-serif;text-transform:uppercase;letter-spacing:.01em;line-height:1.02;font-size:clamp(2.2rem,6vw,3.6rem);margin:.4em 0 .2em}
h2{font-family:"Anton","Oswald","Arial Narrow",sans-serif;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(1.4rem,3.5vw,2rem);margin:1.8em 0 .5em}
.lede{font-size:1.12rem;color:#262626}
ul.points{list-style:none;padding:0;margin:1em 0}
ul.points li{padding:12px 0 12px 30px;position:relative;border-bottom:1px solid var(--hair)}
ul.points li:before{content:"\\2713";position:absolute;left:0;top:12px;color:var(--forest);font-weight:800}
.cta-block{text-align:center;border:2px solid var(--ink);border-radius:14px;padding:32px 24px;margin:2.4em 0}
.cta-block .price{font-family:"Anton",sans-serif;font-size:2.4rem}
.faq dt{font-weight:700;margin-top:1em}
.faq dd{margin:.2em 0 0;color:#333}
.cards{display:grid;gap:14px;margin:1.6em 0}
.card{border:1px solid var(--hair);border-radius:12px;padding:18px 20px}
.card h2{margin:0 0 .3em;font-size:1.3rem}
.card h2 a{color:var(--ink);text-decoration:none}
.card h2 a:hover{color:var(--forest)}
footer.site{border-top:2px solid var(--ink);margin-top:2em;padding:24px 0;font-size:13px;color:var(--muted)}
footer.site a{color:var(--muted);margin-right:16px}
@media(min-width:640px){.cards{grid-template-columns:1fr}}
@media(max-width:600px){header.site .wrap{height:60px}.brand{font-size:19px}.nav{gap:10px}.nav a:not(.cta){font-size:11px;letter-spacing:.12em}.cta{font-size:11px;letter-spacing:.06em;padding:10px 12px}}
@media(max-width:344px){.nav a:not(.cta){display:none}}`;

const siteHeader = `<header class="site"><div class="wrap">
  <a class="brand" href="${SITE.baseUrl}/">Ink<span>Tracker</span></a>
  <nav class="nav">
    <a href="${SITE.baseUrl}/resources">Resources</a>
    <a class="cta" href="${SITE.baseUrl}/#pricing">Start free trial</a>
  </nav>
</div></header>`;

const siteFooter = `<footer class="site"><div class="wrap">
  <a href="${SITE.baseUrl}/">InkTracker home</a><a href="${SITE.baseUrl}/features">Features</a><a href="${SITE.baseUrl}/tools">Free Tools</a><a href="${SITE.baseUrl}/#pricing">Pricing</a><a href="${SITE.baseUrl}/support">Support</a>
  <p>InkTracker is built and used in daily production at <a href="https://biotamfg.com">Biota Mfg</a>, a working screen-print shop in Reno.</p>
</div></footer>`;

const ldJson = (obj) => `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`;

function ctaBlock() {
  return `<div class="cta-block">
    <div class="price">${SITE.price}</div>
    <p>InkTracker: one plan, everything included. ${esc(SITE.trial)}.</p>
    <p>Built and battle-tested in daily production at <a href="https://biotamfg.com">Biota Mfg</a>, a working screen-print shop in Reno.</p>
    <a class="cta" href="${SITE.baseUrl}/#pricing">Start your free trial</a>
  </div>`;
}

function head({ title, description, canonical, ogType, ld }) {
  return `<meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${esc(canonical)}" />
  <link rel="icon" type="image/png" href="/icon-192.png" />
  <meta property="og:type" content="${ogType}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${SITE.logo}" />
  <meta name="twitter:card" content="summary" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;700;800&display=swap" />
  <style>${CSS}</style>
  ${ld.map(ldJson).join("\n  ")}`;
}

function renderFeature(f) {
  const canonical = `${SITE.baseUrl}/features/${f.slug}`;
  const sections = f.sections
    .map((s) => {
      const paras = s.paras.map((p) => `<p>${esc(p)}</p>`).join("\n");
      const bullets = s.bullets
        ? `<ul class="points">${s.bullets.map((b) => `<li>${esc(b)}</li>`).join("\n")}</ul>`
        : "";
      return `<h2>${esc(s.h2)}</h2>\n${paras}\n${bullets}`;
    })
    .join("\n");
  const faqs = f.faqs.map((q) => `<dt>${esc(q.q)}</dt><dd>${esc(q.a)}</dd>`).join("\n");

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "InkTracker", item: `${SITE.baseUrl}/` },
      { "@type": "ListItem", position: 2, name: "Features", item: `${SITE.baseUrl}/features` },
      { "@type": "ListItem", position: 3, name: f.h1, item: canonical },
    ],
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: f.faqs.map((q) => ({
      "@type": "Question",
      name: q.q,
      acceptedAnswer: { "@type": "Answer", text: q.a },
    })),
  };

  return `<!doctype html>
<html lang="en">
<head>
  ${head({ title: f.title, description: f.metaDescription, canonical, ogType: "website", ld: [breadcrumb, faqLd] })}
</head>
<body>
${siteHeader}
<main class="wrap">
  <nav class="crumbs"><a href="${SITE.baseUrl}/">Home</a> › <a href="${SITE.baseUrl}/features">Features</a> › ${esc(f.h1)}</nav>
  <h1>${esc(f.h1)}</h1>
  <p class="lede">${esc(f.lede)}</p>
${sections}
  ${ctaBlock()}
  <h2>Common questions</h2>
  <dl class="faq">
${faqs}
  </dl>
</main>
${siteFooter}
</body>
</html>`;
}

function renderHub() {
  const canonical = `${SITE.baseUrl}/features`;
  const cards = FEATURES.map(
    (f) => `<div class="card">
    <h2><a href="${SITE.baseUrl}/features/${f.slug}">${esc(f.h1)}</a></h2>
    <p>${esc(f.metaDescription)}</p>
  </div>`,
  ).join("\n");
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "InkTracker", item: `${SITE.baseUrl}/` },
      { "@type": "ListItem", position: 2, name: "Features", item: canonical },
    ],
  };
  return `<!doctype html>
<html lang="en">
<head>
  ${head({
    title: "Features — InkTracker",
    description: "What makes InkTracker different: live supplier pricing in every quote, margin you can see before sending, and shop-to-shop partnerships.",
    canonical,
    ogType: "website",
    ld: [breadcrumb],
  })}
</head>
<body>
${siteHeader}
<main class="wrap">
  <nav class="crumbs"><a href="${SITE.baseUrl}/">Home</a> › Features</nav>
  <h1>What makes InkTracker different</h1>
  <p class="lede">Every shop tool quotes and invoices. These are the parts that only InkTracker does — the reasons a shop switches.</p>
  <div class="cards">
${cards}
  </div>
  ${ctaBlock()}
</main>
${siteFooter}
</body>
</html>`;
}

// ── sitemap sync (managed block, mirrors the compare pattern) ───────────────
function syncSitemap() {
  const path = join(ROOT, "public", "sitemap.xml");
  const urls = [
    `${SITE.baseUrl}/features`,
    ...FEATURES.map((f) => `${SITE.baseUrl}/features/${f.slug}`),
  ];
  const body = urls
    .map((u) => `  <url>\n    <loc>${u}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>`)
    .join("\n");
  const block = `  <!-- feature-pages:start -->\n${body}\n  <!-- feature-pages:end -->`;
  let xml = readFileSync(path, "utf8");
  if (xml.includes("<!-- feature-pages:start -->")) {
    xml = xml.replace(/  <!-- feature-pages:start -->[\s\S]*?  <!-- feature-pages:end -->/, block);
  } else {
    xml = xml.replace("</urlset>", `${block}\n</urlset>`);
  }
  writeFileSync(path, xml);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "index.html"), renderHub());
for (const f of FEATURES) {
  const dir = join(OUT_DIR, f.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), renderFeature(f));
}
syncSitemap();
console.log(`✓ Generated /features hub + ${FEATURES.length} feature page(s)`);
console.log("✓ Synced /features into public/sitemap.xml");
