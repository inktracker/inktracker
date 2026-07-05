// ─────────────────────────────────────────────────────────────────────────
// Free /tools hub + tool pages — static, crawlable HTML, same pipeline as
// /compare and /blog. Run via `npm run build:content`; output committed;
// served via vercel.json rewrites.
//
//   public/tools/index.html                                  (hub, card grid)
//   public/tools/screen-printing-price-calculator/index.html (first tool)
//
// The calculator REUSES the shared chart math (scripts/content/calc.mjs) —
// the same chartModel/chartCell the blog price-chart widget uses — so the
// free tool and the blog can never disagree. Adding a future tool is one
// entry in the TOOLS array plus a render function.
// ─────────────────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SITE } from "./content/comparisons.mjs";
import { esc, sliderRow, chartModel, chartCell, CALC_CSS, QTY_TIERS } from "./content/calc.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, "..", "public");

const m2 = (n) => "$" + (Math.round(n * 100) / 100).toFixed(2);
const m0 = (n) => "$" + Math.round(n).toLocaleString("en-US");
const ct = (n) => Math.round(n).toLocaleString("en-US");
const ldJson = (o) => `<script type="application/ld+json">\n${JSON.stringify(o, null, 2)}\n</script>`;

// Trial links carry per-surface ref params so signups from the hub vs the
// calculator are distinguishable.
const TRIAL_HUB = `${SITE.baseUrl}/?ref=tools`;
const TRIAL_CALC = `${SITE.baseUrl}/?ref=calculator`;

// ── Shared page chrome (brand CSS incl. the shared CALC_CSS block) ───────────
const CSS = `:root{--ink:#0e0e0e;--muted:#6b6b6b;--hair:#e5e5e5;--forest:#2c5840;--forest-dark:#1a3a28}
*{box-sizing:border-box}
body{margin:0;color:var(--ink);background:#fff;font-family:"Inter",-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--forest)}
.wrap{max-width:820px;margin:0 auto;padding:0 20px}
header.site{position:sticky;top:0;z-index:10;background:rgba(255,255,255,.95);backdrop-filter:blur(8px);border-bottom:2px solid var(--ink)}
header.site .wrap{display:flex;align-items:center;justify-content:space-between;height:72px;gap:16px}
.brand{font-family:"Anton","Oswald","Arial Narrow",sans-serif;font-size:26px;letter-spacing:.02em;text-transform:uppercase;color:var(--ink);text-decoration:none}
.brand span{color:var(--forest)}
.nav{display:flex;align-items:center;gap:18px}
.nav a{font-size:13px;font-weight:600;color:var(--ink);text-decoration:none}
.nav a:hover{color:var(--forest)}
.cta{display:inline-block;background:var(--forest);color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px;font-size:15px}
.cta:hover{background:var(--forest-dark)}
nav.crumbs{font-size:13px;color:var(--muted);padding:18px 0 0}
nav.crumbs a{color:var(--muted)}
h1{font-family:"Anton","Oswald","Arial Narrow",sans-serif;text-transform:uppercase;letter-spacing:.01em;line-height:1.02;font-size:clamp(2.2rem,6vw,3.4rem);margin:.4em 0 .2em}
h2{font-family:"Anton","Oswald","Arial Narrow",sans-serif;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(1.3rem,3.2vw,1.8rem);margin:1.6em 0 .5em}
.lede{font-size:1.12rem;color:#262626}
p{margin:1em 0}
footer.site{border-top:2px solid var(--ink);margin-top:3em;padding:24px 0;font-size:13px;color:var(--muted)}
footer.site a{color:var(--muted);margin-right:16px}
/* tool card grid */
.tool-grid{list-style:none;padding:0;margin:1.8em 0;display:grid;gap:16px}
@media(min-width:640px){.tool-grid{grid-template-columns:1fr 1fr}}
.tool-grid li{border:1px solid var(--hair);border-radius:12px;padding:22px;transition:border-color .15s}
.tool-grid li:hover{border-color:var(--forest)}
.tool-grid h3{margin:0 0 .3em;font-size:1.15rem}
.tool-grid h3 a{color:var(--ink);text-decoration:none}
.tool-grid h3 a:hover{color:var(--forest)}
.tool-grid p{margin:.2em 0;color:#333;font-size:.95rem}
.tool-tag{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#fff;background:var(--forest);border-radius:6px;padding:3px 8px;margin-bottom:10px}
.soft-cta{background:var(--ink);color:#fff;border-radius:14px;padding:28px 26px;margin:2.6em 0;text-align:center}
.soft-cta h3{font-family:"Anton",sans-serif;color:#fff;text-transform:uppercase;font-size:1.5rem;margin:0 0 .45em}
.soft-cta p{color:#d8d8d8;margin:0 auto 1.2em;max-width:580px}
${CALC_CSS}
/* calculator page extras */
.calc-table td[data-ci]{cursor:pointer}
/* Selection changes ONLY color/background — never font-weight — so the
   selected cell's number doesn't get wider and reflow the column (the
   "numbers shift when you click through the grid" bug). */
.calc-table td.sel{background:var(--forest)!important;color:#fff}
.stepper{display:inline-flex;align-items:center;border:1px solid var(--hair);border-radius:8px;overflow:hidden;background:#fff}
.stepper button{width:30px;height:32px;border:0;background:#f1f1f1;font-weight:700;cursor:pointer;color:#333}
.stepper button:hover{background:#e6e6e6}
.stepper .n{min-width:34px;text-align:center;font-weight:700}
.toggle{display:flex;align-items:center;gap:10px;padding:8px 0}
.toggle input{width:18px;height:18px;accent-color:var(--forest)}
.toggle span{font-size:14px}
.bd{border:1px solid var(--hair);border-radius:14px;overflow:hidden;margin:14px 0}
.bd-row{display:flex;justify-content:space-between;gap:12px;padding:11px 16px;border-bottom:1px solid var(--hair);font-size:14px}
.bd-row:last-child{border-bottom:0}
.bd-row .lbl b{display:block}
.bd-row .lbl span{font-size:12px;color:var(--muted)}
.bd-row .amt{font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap}
.bd-row.total{background:#f6faf7;font-size:16px}
.bd-row.total .amt{color:var(--forest);font-size:18px}
.bd-row.pershirt{background:#fafafa;color:var(--muted)}
.bd-row[hidden]{display:none}`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;700;800&display=swap" />`;

const siteHeader = `<header class="site"><div class="wrap">
  <a class="brand" href="${SITE.baseUrl}/">Ink<span>Tracker</span></a>
  <nav class="nav">
    <a href="${SITE.baseUrl}/tools">Free Tools</a>
    <a href="${SITE.baseUrl}/blog">Blog</a>
    <a class="cta" href="${SITE.baseUrl}/#pricing">Start trial</a>
  </nav>
</div></header>`;

const siteFooter = `<footer class="site"><div class="wrap">
  <a href="${SITE.baseUrl}/">InkTracker home</a><a href="${SITE.baseUrl}/tools">Free Tools</a><a href="${SITE.baseUrl}/blog">Blog</a><a href="${SITE.baseUrl}/compare">Software guide</a><a href="${SITE.baseUrl}/support">Support</a>
  <p>InkTracker is built and used in daily production at <a href="https://biotamfg.com">Biota Mfg</a>, a working screen-print shop in Reno.</p>
</div></footer>`;

// ── TOOLS registry (add a tool = one entry + a render fn) ────────────────────
const TOOLS = Object.freeze([
  {
    slug: "screen-printing-price-calculator",
    tag: "Pricing",
    title: "Screen Printing Price Calculator",
    hubDesc: "Build a print-price chart from your shop's overhead, then stack garment, setup, and extra locations to see the full job price. Free, no signup.",
    render: renderCalculator,
    metaTitle: "Free Screen Printing Price Calculator — Chart + Full Job Price",
    metaDesc: "Free screen printing price calculator: build a per-print chart from your monthly overhead, then add garment markup, setup fees, and extra print locations to price a whole job. Built by a working print shop.",
  },
  // Future: embroidery pricing calculator, setup-fee calculator, etc.
]);

// ── The calculator tool (Part A chart + Part B full-price breakdown) ─────────
function renderCalculator(tool) {
  const canonical = `${SITE.baseUrl}/tools/${tool.slug}`;

  // Static-first defaults so the page is useful with JS off / slow.
  const A = { costs: 14000, shirts: 4000, margin: 45, vol: 10, color: 10 };
  const B = { colors: 3, qty: 72, garment: 6, twoLoc: false, setup: true };
  const M = chartModel(A);

  // Part A — chart controls + stat cards + clickable grid.
  const aControls =
    sliderRow("costs", "Total monthly costs", "rent, power, supplies, your pay", 'min="1000" max="50000" step="500" value="14000"', m0(A.costs)) +
    sliderRow("shirts", "Prints per month", "how many you print in a month", 'min="50" max="30000" step="50" value="4000"', ct(A.shirts)) +
    sliderRow("margin", "Target margin", "the profit slice you keep", 'min="10" max="100" step="1" value="45"', A.margin + "%") +
    sliderRow("vol", "Volume discount", "knocked off at each size break", 'min="0" max="30" step="1" value="10"', A.vol + "%") +
    sliderRow("color", "Added color", "each extra color adds", 'min="0" max="30" step="1" value="10"', A.color + "%");
  const aStats = `<div class="calc-out" style="grid-template-columns:repeat(2,1fr)">
    <div class="calc-stat"><div class="k">Cost per print</div><div class="v" data-out="cpp">${m2(M.cpp)}</div></div>
    <div class="calc-stat"><div class="k">Base print price</div><div class="v" data-out="base">${m2(M.base)}</div></div>
  </div>`;
  const selTi = tierIdx(B.qty);
  let rows = "";
  for (let ci = 0; ci < 8; ci++) {
    const col = ci + 1;
    rows += `<tr><td class="rl">${col}${col === 1 ? " color" : " colors"}</td>`;
    for (let qi = 0; qi < 4; qi++) {
      const sel = ci === B.colors - 1 && qi === selTi ? " sel" : "";
      rows += `<td class="${sel.trim()}" data-ci="${ci}" data-ti="${qi}">${m2(chartCell(M, ci, qi))}</td>`;
    }
    rows += "</tr>";
  }
  const aHead = '<thead><tr><th>Colors \\ Qty</th><th>25</th><th>50</th><th>100</th><th>200</th></tr></thead>';
  const aTable = `<table class="calc-table">${aHead}<tbody data-grid>${rows}</tbody></table>`;
  const aCaption = `<p class="calc-note">Per print, before garment. Click a cell to price that combination below.</p>`;
  const partA = `<div class="calc" id="calc-chart">${aControls}${aStats}${aTable}${aCaption}</div>`;

  // Part B — controls + stacked breakdown (static default).
  const bd0 = fullPrice(B, M);
  const bControls = `<div class="calc" id="calc-full">
    <div class="calc-row">
      <div class="calc-label"><b>Colors</b><span>ink colors on the front print</span></div>
      <div class="stepper"><button type="button" data-step="-1">−</button><span class="n" data-out="colors">${B.colors}</span><button type="button" data-step="1">+</button></div>
    </div>
    ${sliderRow("qty", "Quantity", "shirts in the run", 'min="12" max="500" step="1" value="72"', ct(B.qty))}
    ${sliderRow("garment", "Garment (blank) cost", "what you pay per shirt", 'min="0" max="40" step="0.5" value="6"', m2(B.garment))}
    <div class="toggle"><input type="checkbox" data-in="twoLoc" /><span>Second print location <span style="color:var(--muted)">(additional locations share setup — priced at half)</span></span></div>
    <div class="toggle"><input type="checkbox" data-in="setup" checked /><span>Setup fee ($25 / screen)</span></div>
  </div>`;
  const partB = `${bControls}
  <div class="bd" id="breakdown">
    <div class="bd-row"><div class="lbl"><b>Print — front</b><span data-note="front">${B.colors} color${B.colors === 1 ? "" : "s"} · ${m2(bd0.frontRate)}/print × ${ct(B.qty)} (priced at the ${bd0.tier} tier)</span></div><div class="amt" data-amt="front">${m2(bd0.frontTotal)}</div></div>
    <div class="bd-row" data-row="second"${B.twoLoc ? "" : " hidden"}><div class="lbl"><b>Print — 2nd location</b><span data-note="second">${m2(bd0.second)}/print × ${ct(B.qty)}</span></div><div class="amt" data-amt="second">${m2(bd0.secondTotal)}</div></div>
    <div class="bd-row"><div class="lbl"><b>Garment</b><span data-note="garment">${m2(B.garment)} × ${bd0.markup.toFixed(2)} markup × ${ct(B.qty)}</span></div><div class="amt" data-amt="garment">${m2(bd0.garmentTotal)}</div></div>
    <div class="bd-row" data-row="setup"${B.setup ? "" : " hidden"}><div class="lbl"><b>Setup &amp; screen fees</b><span data-note="setup">${bd0.screens} screen${bd0.screens === 1 ? "" : "s"} × $25</span></div><div class="amt" data-amt="setup">${m2(bd0.setup)}</div></div>
    <div class="bd-row total"><div class="lbl"><b>Order total</b></div><div class="amt" data-amt="total">${m2(bd0.total)}</div></div>
    <div class="bd-row pershirt"><div class="lbl">Per shirt</div><div class="amt" data-amt="pershirt">${m2(bd0.perShirt)}</div></div>
  </div>`;

  // Client script: inject the SHARED chart math + this page's fullPrice()
  // verbatim, so browser numbers equal the static render and the blog widget.
  const qtyTiersJs = JSON.stringify(QTY_TIERS);
  const script = `<script>(function(){
var root=document.getElementById("calc-chart"),full=document.getElementById("calc-full"),bd=document.getElementById("breakdown");
if(!root||!full||!bd)return;
${chartModel.toString()}
${chartCell.toString()}
${tierIdx.toString()}
${fullPrice.toString()}
function m2(n){return "$"+(Math.round(n*100)/100).toFixed(2);}
function m0(n){return "$"+Math.round(n).toLocaleString("en-US");}
function ct(n){return Math.round(n).toLocaleString("en-US");}
var A={costs:14000,shirts:4000,margin:45,vol:10,color:10};
var B={colors:3,qty:72,garment:6,twoLoc:false,setup:true};
function buildChart(){var M=chartModel(A);var st=tierIdx(B.qty);var rows="";
for(var ci=0;ci<8;ci++){var col=ci+1;rows+="<tr><td class=\\"rl\\">"+col+(col===1?" color":" colors")+"</td>";
for(var qi=0;qi<4;qi++){var sel=(ci===B.colors-1&&qi===st)?" sel":"";rows+="<td class=\\""+sel.replace(/^ /,"")+"\\" data-ci=\\""+ci+"\\" data-ti=\\""+qi+"\\">"+m2(chartCell(M,ci,qi))+"</td>";}
rows+="</tr>";}
root.querySelector("[data-grid]").innerHTML=rows;
root.querySelector('[data-out="cpp"]').textContent=m2(M.cpp);
root.querySelector('[data-out="base"]').textContent=m2(M.base);
root.querySelectorAll("td[data-ci]").forEach(function(td){td.addEventListener("click",function(){
B.colors=parseInt(td.getAttribute("data-ci"),10)+1;
var TQ=${qtyTiersJs};B.qty=TQ[parseInt(td.getAttribute("data-ti"),10)];
full.querySelector('[data-out="colors"]').textContent=B.colors;
var qs=full.querySelector('[data-in="qty"]');qs.value=B.qty;full.querySelector('[data-val="qty"]').textContent=ct(B.qty);
buildBreakdown();});});}
function buildBreakdown(){var M=chartModel(A);var r=fullPrice(B,M);
bd.querySelector('[data-amt="front"]').textContent=m2(r.frontTotal);
bd.querySelector('[data-note="front"]').textContent=B.colors+" color"+(B.colors===1?"":"s")+" · "+m2(r.frontRate)+"/print × "+ct(B.qty)+" (priced at the "+r.tier+" tier)";
bd.querySelector('[data-row="second"]').hidden=!B.twoLoc;
bd.querySelector('[data-amt="second"]').textContent=m2(r.secondTotal);
bd.querySelector('[data-note="second"]').textContent=m2(r.second)+"/print × "+ct(B.qty);
bd.querySelector('[data-amt="garment"]').textContent=m2(r.garmentTotal);
bd.querySelector('[data-note="garment"]').textContent=m2(B.garment)+" × "+r.markup.toFixed(2)+" markup × "+ct(B.qty);
bd.querySelector('[data-row="setup"]').hidden=!B.setup;
bd.querySelector('[data-amt="setup"]').textContent=m2(r.setup);
bd.querySelector('[data-note="setup"]').textContent=r.screens+" screen"+(r.screens===1?"":"s")+" × $25";
bd.querySelector('[data-amt="total"]').textContent=m2(r.total);
bd.querySelector('[data-amt="pershirt"]').textContent=m2(r.perShirt);
buildChart();}
function wireA(k,t){var sl=root.querySelector('[data-in="'+k+'"]');var ov=root.querySelector('[data-val="'+k+'"]');
function u(){A[k]=parseFloat(sl.value);ov.textContent=t==="m0"?m0(A[k]):t==="ct"?ct(A[k]):t==="pct"?(Math.round(A[k])+"%"):A[k];buildBreakdown();}
sl.addEventListener("input",u);u();}
wireA("costs","m0");wireA("shirts","ct");wireA("margin","pct");wireA("vol","pct");wireA("color","pct");
var qs=full.querySelector('[data-in="qty"]'),qv=full.querySelector('[data-val="qty"]');
qs.addEventListener("input",function(){B.qty=parseInt(qs.value,10);qv.textContent=ct(B.qty);buildBreakdown();});
var gs=full.querySelector('[data-in="garment"]'),gv=full.querySelector('[data-val="garment"]');
gs.addEventListener("input",function(){B.garment=parseFloat(gs.value);gv.textContent=m2(B.garment);buildBreakdown();});
full.querySelectorAll("[data-step]").forEach(function(btn){btn.addEventListener("click",function(){
B.colors=Math.min(8,Math.max(1,B.colors+parseInt(btn.getAttribute("data-step"),10)));
full.querySelector('[data-out="colors"]').textContent=B.colors;buildBreakdown();});});
full.querySelector('[data-in="twoLoc"]').addEventListener("change",function(e){B.twoLoc=e.target.checked;buildBreakdown();});
full.querySelector('[data-in="setup"]').addEventListener("change",function(e){B.setup=e.target.checked;buildBreakdown();});
buildBreakdown();
})();</script>`;

  const webApp = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Screen Printing Price Calculator",
    url: canonical,
    description: tool.metaDesc,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    inLanguage: "en-US",
    isPartOf: { "@type": "WebSite", name: SITE.name, url: SITE.baseUrl },
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@type": "Organization", name: SITE.name, url: SITE.baseUrl, logo: { "@type": "ImageObject", url: SITE.logo } },
  };
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "InkTracker", item: `${SITE.baseUrl}/` },
      { "@type": "ListItem", position: 2, name: "Free Tools", item: `${SITE.baseUrl}/tools` },
      { "@type": "ListItem", position: 3, name: tool.title, item: canonical },
    ],
  };

  const body = `${siteHeader}
<main class="wrap">
  <nav class="crumbs"><a href="${SITE.baseUrl}/">Home</a> › <a href="${SITE.baseUrl}/tools">Free Tools</a> › Screen Printing Price Calculator</nav>
  <h1>Free Screen Printing Price Calculator</h1>
  <p class="lede">Build a price-per-print chart from what your shop actually costs to run — then stack garment, setup, and extra locations to price the whole job. No signup.</p>

  <h2>1. Build your print chart</h2>
  <p>Two numbers set the whole chart: what your shop costs to run in a month, and how many prints you push in that month. Divide one by the other and that's your <b>cost per print</b>. Your base price is that cost divided by <code>(1 − your margin)</code> — because margin isn't markup: keeping 45% means dividing by 0.55, not multiplying by 1.45. Bigger runs cost less per shirt (setup spreads out); each added color adds a shrinking slice.</p>
  ${partA}

  <h2>2. The full price</h2>
  <p>The chart is the print. Three things stack on top: <b>garment markup</b>, <b>setup fees per screen</b>, and <b>additional print locations</b>. Click a chart cell above to load it here, or set the run yourself.</p>
  ${partB}
  <p class="calc-note">Garment markup slides down as blanks get pricier (40% on a cheap tee, ~15% on a $30 hoodie) so you don't price yourself out on expensive garments. Setup is one-time per screen; the print and garment scale with quantity.</p>

  <div class="soft-cta">
    <h3>Stop rebuilding this by hand</h3>
    <p>This is the free version of the pricing engine we built into InkTracker — it holds your chart, garment markup, and setup fees and stacks them on every quote automatically. Start a 14-day free trial.</p>
    <a class="cta" href="${TRIAL_CALC}">Start your free trial</a>
  </div>

  <p>Want the full method, in a printer's own words? Read <a href="${SITE.baseUrl}/blog/build-a-screen-printing-price-chart">how I build a screen printing price chart</a> and <a href="${SITE.baseUrl}/blog/how-to-price-a-screen-printing-job">how to price a single job</a>. More free tools on the <a href="${SITE.baseUrl}/tools">tools hub</a>, and see <a href="${SITE.baseUrl}/for-printers">what InkTracker does for print shops</a>.</p>
</main>
${siteFooter}
${script}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(tool.metaTitle)}</title>
  <meta name="description" content="${esc(tool.metaDesc)}" />
  <link rel="canonical" href="${esc(canonical)}" />
  <link rel="icon" type="image/png" href="/icon-192.png" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${esc(tool.metaTitle)}" />
  <meta property="og:description" content="${esc(tool.metaDesc)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${SITE.logo}" />
  <meta name="twitter:card" content="summary" />
  ${FONTS}
  <style>${CSS}</style>
  ${ldJson(webApp)}
  ${ldJson(breadcrumb)}
</head>
<body>
${body}
</body>
</html>`;
}

// Pure: highest quantity-tier index (0–3) whose breakpoint ≤ qty. ES5-safe
// (injected into the client verbatim).
function tierIdx(qty) {
  var t = [25, 50, 100, 200];
  var idx = 0;
  for (var i = 0; i < 4; i++) { if (qty >= t[i]) idx = i; }
  return idx;
}

// Pure full-job price. B = { colors, qty, garment, twoLoc, setup }, M = chartModel().
// ES5-safe (build-time static render + injected client). Garment markup uses
// the sliding brackets from the price-chart post; setup is one-time per screen.
function fullPrice(B, M) {
  var ti = tierIdx(B.qty);
  var frontRate = chartCell(M, B.colors - 1, ti);
  var second = B.twoLoc ? 0.5 * frontRate : 0;
  var g = B.garment;
  var markup = g > 25 ? 1.15 : g > 15 ? 1.22 : g > 8 ? 1.30 : 1.40;
  var screens = B.colors * (B.twoLoc ? 2 : 1);
  var setup = B.setup ? screens * 25 : 0;
  var frontTotal = frontRate * B.qty;
  var secondTotal = second * B.qty;
  var garmentTotal = g * markup * B.qty;
  var total = frontTotal + secondTotal + garmentTotal + setup;
  return {
    ti: ti, tier: [25, 50, 100, 200][ti],
    frontRate: frontRate, frontTotal: frontTotal,
    second: second, secondTotal: secondTotal,
    markup: markup, garmentTotal: garmentTotal,
    screens: screens, setup: setup,
    total: total, perShirt: total / B.qty,
  };
}

// ── The hub (card grid) ──────────────────────────────────────────────────────
function renderHub() {
  const canonical = `${SITE.baseUrl}/tools`;
  const cards = TOOLS.map((t) => `      <li>
        <span class="tool-tag">${esc(t.tag)}</span>
        <h3><a href="${SITE.baseUrl}/tools/${t.slug}">${esc(t.title)}</a></h3>
        <p>${esc(t.hubDesc)}</p>
      </li>`).join("\n");
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "InkTracker", item: `${SITE.baseUrl}/` },
      { "@type": "ListItem", position: 2, name: "Free Tools", item: canonical },
    ],
  };
  const title = "Free Tools for Print Shops";
  const desc = "Free tools for screen printers — a price calculator and more, built by a working print shop. No signup.";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="canonical" href="${esc(canonical)}" />
  <link rel="icon" type="image/png" href="/icon-192.png" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${SITE.logo}" />
  <meta name="twitter:card" content="summary" />
  ${FONTS}
  <style>${CSS}</style>
  ${ldJson(breadcrumb)}
</head>
<body>
${siteHeader}
<main class="wrap">
  <nav class="crumbs"><a href="${SITE.baseUrl}/">Home</a> › Free Tools</nav>
  <h1>Free tools for print shops</h1>
  <p class="lede">Small, genuinely useful tools built by a printer — no signup, no email wall. More get added over time.</p>
  <ul class="tool-grid">
${cards}
  </ul>
  <div class="soft-cta">
    <h3>Run your whole shop, not just the math</h3>
    <p>These free tools come out of InkTracker — quoting, production, and invoicing built for screen print and embroidery shops. Start a 14-day free trial.</p>
    <a class="cta" href="${TRIAL_HUB}">Start your free trial</a>
  </div>
  <p>New to pricing? Start with <a href="${SITE.baseUrl}/blog/how-to-price-a-screen-printing-job">how to price a screen printing job</a> or the <a href="${SITE.baseUrl}/blog">full blog</a>.</p>
</main>
${siteFooter}
</body>
</html>`;
}

// ── sitemap sync (managed block, mirrors the blog/compare pattern) ───────────
function syncSitemap() {
  const path = join(PUBLIC, "sitemap.xml");
  const urls = [`${SITE.baseUrl}/tools`, ...TOOLS.map((t) => `${SITE.baseUrl}/tools/${t.slug}`)];
  const entries = urls
    .map((u) => `  <url>\n    <loc>${u}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>`)
    .join("\n");
  const block = `  <!-- tools-pages:start -->\n${entries}\n  <!-- tools-pages:end -->`;
  let xml = readFileSync(path, "utf8");
  if (xml.includes("<!-- tools-pages:start -->")) {
    xml = xml.replace(/  <!-- tools-pages:start -->[\s\S]*?  <!-- tools-pages:end -->/, block);
  } else {
    xml = xml.replace("</urlset>", `${block}\n</urlset>`);
  }
  writeFileSync(path, xml);
}

// ── write ────────────────────────────────────────────────────────────────────
mkdirSync(join(PUBLIC, "tools"), { recursive: true });
writeFileSync(join(PUBLIC, "tools", "index.html"), renderHub());
for (const t of TOOLS) {
  const dir = join(PUBLIC, "tools", t.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), t.render(t));
}
syncSitemap();

console.log(`✓ Generated /tools hub + ${TOOLS.length} tool page(s) → public/tools/`);
console.log("✓ Synced /tools into public/sitemap.xml");
