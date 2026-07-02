// ─────────────────────────────────────────────────────────────────────────
// Static blog generator. Mirrors scripts/generate-compare-pages.mjs — same
// brand CSS, header, footer, esc(). Reads scripts/content/blog-posts.mjs and
// writes fully crawlable HTML:
//   public/blog/index.html            (post list)
//   public/blog/<slug>/index.html     (one page per post)
//   public/for-printers/index.html    (the wizard-loop destination page)
// Runs independently of `vite build` (see build:content). Output is committed.
// ─────────────────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SITE, POSTS } from "./content/blog-posts.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PUBLIC = join(ROOT, "public");

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Brand CSS — identical tokens to /compare (forest green, Inter, Anton) + a few
// blog/calculator additions. Keep the shared block byte-for-byte with compare.
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
footer.site{border-top:2px solid var(--ink);margin-top:2em;padding:24px 0;font-size:13px;color:var(--muted)}
footer.site a{color:var(--muted);margin-right:16px}
.disclaimer{font-size:12px;color:var(--muted);border-top:1px solid var(--hair);margin-top:3em;padding:18px 0}
/* blog */
.cat-tag{display:inline-block;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--forest);background:#f0f5f1;border:1px solid #d6e4da;border-radius:999px;padding:3px 10px}
.post-meta{font-size:13px;color:var(--muted);margin-top:10px}
.post-list{list-style:none;padding:0;margin:1.6em 0;display:grid;gap:16px}
.post-list li{border:1px solid var(--hair);border-radius:12px;padding:20px 22px;transition:border-color .15s}
.post-list li:hover{border-color:var(--forest)}
.post-list h2{font-size:1.35rem;margin:.5em 0 .3em}
.post-list h2 a{color:var(--ink);text-decoration:none}
.post-list h2 a:hover{color:var(--forest)}
.post-list p{margin:.3em 0;color:#333}
.post-body p{margin:1.05em 0}
.post-body code{background:#f2f2f2;padding:1px 5px;border-radius:4px;font-size:.92em}
ul.body-list{margin:1em 0;padding-left:1.25em}
ul.body-list li{margin:.55em 0}
.callout{border-left:3px solid var(--forest);background:#f6faf7;border-radius:0 10px 10px 0;padding:14px 18px;margin:1.5em 0}
.callout h4{margin:0 0 4px;font-size:1rem}
.callout p{margin:0;color:#333}
.faq dt{font-weight:700;margin-top:1em}
.faq dd{margin:.2em 0 0;color:#333}
.blog-cta{background:var(--ink);color:#fff;border-radius:14px;padding:30px 26px;margin:2.6em 0;text-align:center}
.blog-cta h3{font-family:"Anton",sans-serif;color:#fff;text-transform:uppercase;font-size:1.6rem;margin:0 0 .45em}
.blog-cta p{color:#d8d8d8;margin:0 auto 1.3em;max-width:580px}
.blog-cta .related{margin-top:1.1em;font-size:13px;color:#bdbdbd}
.blog-cta .related a{color:#eaeaea}
/* calculator */
.calc{border:1px solid var(--hair);border-radius:14px;padding:20px;margin:1.6em 0;background:#fafafa}
.calc-row{display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid var(--hair);flex-wrap:wrap}
.calc-row:last-of-type{border-bottom:0}
.calc-label{flex:1 1 210px;min-width:190px}
.calc-label b{display:block;font-size:14px}
.calc-label span{font-size:12px;color:var(--muted)}
.calc-slider{flex:2 1 170px;accent-color:var(--forest);height:22px}
.calc-val{min-width:64px;text-align:right;font-weight:700;color:var(--forest);font-variant-numeric:tabular-nums}
.calc-out{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0 6px}
.calc-stat{border:1px solid var(--hair);border-radius:10px;padding:12px;text-align:center;background:#fff}
.calc-stat .k{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.calc-stat .v{font-family:"Anton",sans-serif;font-size:1.55rem;color:var(--forest)}
.calc-note{font-size:13px;color:#444;margin-top:8px;line-height:1.55}
.calc-digit{font-size:13px;color:var(--forest);font-weight:600;margin-top:8px}
.calc-table{width:100%;border-collapse:collapse;margin:14px 0 4px;font-variant-numeric:tabular-nums;font-size:14px}
.calc-table th{background:var(--forest);color:#fff;padding:8px 10px;text-align:right;font-weight:700}
.calc-table th:first-child{text-align:left}
.calc-table td{padding:7px 10px;text-align:right;border-bottom:1px solid var(--hair)}
.calc-table td.rl{text-align:left;font-weight:700}
.calc-table tbody tr:nth-child(even){background:#f6faf7}
.proof{list-style:none;padding:0;margin:1.4em 0;display:grid;gap:12px}
.proof li{padding:14px 18px 14px 42px;position:relative;border:1px solid var(--hair);border-radius:10px}
.proof li:before{content:"\\2713";position:absolute;left:16px;top:14px;color:var(--forest);font-weight:800}
@media(min-width:640px){}`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;700;800&display=swap" />`;

const siteHeader = `<header class="site"><div class="wrap">
  <a class="brand" href="${SITE.baseUrl}/">Ink<span>Tracker</span></a>
  <a class="cta" href="${SITE.baseUrl}/#pricing">Start free trial</a>
</div></header>`;

const siteFooter = `<footer class="site"><div class="wrap">
  <a href="${SITE.baseUrl}/">InkTracker home</a><a href="${SITE.baseUrl}/blog">Blog</a><a href="${SITE.baseUrl}/compare">Software guide</a><a href="${SITE.baseUrl}/support">Support</a>
</div></footer>`;

const ldJson = (obj) => `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`;

const fmtDate = (iso) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

// Posts store plain YYYY-MM-DD; schema.org datetimes need a timezone or the
// Rich Results Test flags them. Stamp a fixed morning-Pacific publish time.
const isoDate = (d) => `${d}T08:00:00-07:00`;

// ── Standard end-of-post CTA (§5) ────────────────────────────────────────────
const SIGNUP_URL = `${SITE.baseUrl}/?ref=blog&utm_source=blog&utm_medium=content`;
// §5 standard CTA — fixed related links to /compare and /for-printers. Cross-post
// links live in each post's body, not here.
function ctaBlock(post) {
  const heading = post?.ctaHeading || "Stop pricing in a spreadsheet.";
  const body = post?.ctaBody ||
    "InkTracker runs this math on every quote automatically — blanks, colors, quantity breaks, and setup — so every job is priced right before it hits the press.";
  return `<div class="blog-cta">
    <h3>${esc(heading)}</h3>
    <p>${esc(body)}</p>
    <a class="cta" href="${SIGNUP_URL}">Start your 14-day free trial — no card</a>
    <div class="related">Related: <a href="/compare">the honest software buyer's guide</a> · <a href="/for-printers">InkTracker for printers</a></div>
  </div>`;
}

// ── Calculator blocks (vanilla JS; no deps; forest brand; every number rounds).
// Header rows are STATIC HTML (the corner "\\" and column tiers don't change) so
// the inline JS only rebuilds data rows — keeps the JS free of backslash/`${}`
// escaping inside this template literal. Each control is its own row with a
// live value readout on the right.
function sliderRow(key, label, hint, attrs, initial = "–") {
  return `<div class="calc-row">
    <div class="calc-label"><b>${esc(label)}</b><span>${esc(hint)}</span></div>
    <input type="range" class="calc-slider" data-in="${key}" ${attrs} />
    <output class="calc-val" data-val="${key}">${esc(initial)}</output>
  </div>`;
}

function jobCalc() {
  const controls =
    sliderRow("blank", "Blank cost", "what you pay per shirt", 'min="1.5" max="12" step="0.25" value="4"') +
    sliderRow("colors", "Ink colors", "one screen per color", 'min="1" max="8" step="1" value="3"') +
    sliderRow("qty", "Quantity", "shirts in the run", 'min="12" max="500" step="1" value="72"') +
    sliderRow("markup", "Markup", "your multiplier on cost", 'min="1.3" max="2.6" step="0.05" value="1.75"');
  const out = `<div class="calc-out">
    <div class="calc-stat"><div class="k">Price / shirt</div><div class="v" data-out="price">–</div></div>
    <div class="calc-stat"><div class="k">Order total</div><div class="v" data-out="total">–</div></div>
    <div class="calc-stat"><div class="k">Profit</div><div class="v" data-out="profit">–</div></div>
  </div>
  <p class="calc-note" data-out="note">–</p>`;
  const script =
    '<script>(function(){var root=document.getElementById("calc-job");if(!root)return;' +
    'function m2(n){return "$"+(Math.round(n*100)/100).toFixed(2);}' +
    'function m0(n){return "$"+Math.round(n).toLocaleString("en-US");}' +
    'function ct(n){return Math.round(n).toLocaleString("en-US");}' +
    'function cr(q){return q<24?0.95:q<72?0.62:q<144?0.46:q<288?0.36:0.30;}' +
    'var S={blank:4,colors:3,qty:72,markup:1.75};' +
    'function o(id){return root.querySelector("[data-out=\\""+id+"\\"]");}' +
    'function recompute(){var screenFee=S.colors*20;var printPer=cr(S.qty)*S.colors;' +
    'var costPer=S.blank+printPer+screenFee/S.qty;var pricePer=costPer*S.markup;' +
    'var total=pricePer*S.qty;var profit=(pricePer-costPer)*S.qty;var margin=Math.round((1-costPer/pricePer)*100);' +
    'o("price").textContent=m2(pricePer);o("total").textContent=m0(total);o("profit").textContent=m0(profit);' +
    'o("note").textContent="Cost to you "+m2(costPer)+"/shirt \\u00b7 "+margin+"% margin \\u00b7 "+m0(screenFee)+" in screens spread across "+ct(S.qty)+" shirts.";}' +
    'function wire(k,t){var sl=root.querySelector("[data-in=\\""+k+"\\"]");var ov=root.querySelector("[data-val=\\""+k+"\\"]");' +
    'function u(){S[k]=parseFloat(sl.value);ov.textContent=t==="m2"?m2(S[k]):t==="ct"?ct(S[k]):t==="x"?(S[k].toFixed(2)+"\\u00d7"):S[k];recompute();}' +
    'sl.addEventListener("input",u);u();}' +
    'wire("blank","m2");wire("colors","ct");wire("qty","ct");wire("markup","x");})();</script>';
  return `<div class="calc" id="calc-job">${controls}${out}</div>${script}`;
}

function chartCalc() {
  // ── Static-first defaults (computed at build time so the grid + stats render
  // without JS). base ≈ $6.36, 8-color/200 ≈ $8.15 with these defaults.
  const D = { costs: 14000, shirts: 4000, margin: 45, vol: 10, color: 10 };
  const m2n = (n) => "$" + (Math.round(n * 100) / 100).toFixed(2);
  const m0n = (n) => "$" + Math.round(n).toLocaleString("en-US");
  const ctn = (n) => Math.round(n).toLocaleString("en-US");
  const cpp = D.costs / D.shirts;
  const base = cpp / (1 - D.margin / 100);
  const vd = D.vol / 100, ac = D.color / 100;
  const tm = [1]; for (let i = 1; i < 4; i++) tm[i] = tm[i - 1] * (1 - vd * Math.pow(0.8, i - 1));
  const cm = [1]; for (let c = 1; c < 8; c++) cm[c] = cm[c - 1] * (1 + ac * Math.pow(0.9, c - 1));
  let defRows = "";
  for (let ci = 0; ci < 8; ci++) {
    const col = ci + 1;
    defRows += `<tr><td class="rl">${col}${col === 1 ? " color" : " colors"}</td>`;
    for (let qi = 0; qi < 4; qi++) defRows += `<td>${m2n(base * cm[ci] * tm[qi])}</td>`;
    defRows += "</tr>";
  }

  const controls =
    sliderRow("costs", "Total monthly costs", "rent, power, supplies, your pay", 'min="1000" max="50000" step="500" value="14000"', m0n(D.costs)) +
    sliderRow("shirts", "Shirts per month", "how many you print in a month", 'min="50" max="30000" step="50" value="4000"', ctn(D.shirts)) +
    sliderRow("margin", "Target margin", "the profit slice you keep", 'min="10" max="75" step="1" value="45"', D.margin + "%") +
    sliderRow("vol", "Volume discount", "knocked off at each size break", 'min="0" max="30" step="1" value="10"', D.vol + "%") +
    sliderRow("color", "Added color", "each extra color adds", 'min="0" max="30" step="1" value="10"', D.color + "%");

  const stats = `<div class="calc-out" style="grid-template-columns:repeat(2,1fr)">
    <div class="calc-stat"><div class="k">Cost per print</div><div class="v" data-out="cpp">${m2n(cpp)}</div></div>
    <div class="calc-stat"><div class="k">Base print price</div><div class="v" data-out="base">${m2n(base)}</div></div>
  </div>`;
  const head = '<thead><tr><th>Colors \\ Qty</th><th>25</th><th>50</th><th>100</th><th>200</th></tr></thead>';
  const table = `<table class="calc-table">${head}<tbody data-grid>${defRows}</tbody></table>`;
  const caption = `<p class="calc-note">Price per print. Garment and markup are added separately.</p>`;

  const script =
    '<script>(function(){var root=document.getElementById("calc-chart");if(!root)return;' +
    'function m2(n){return "$"+(Math.round(n*100)/100).toFixed(2);}' +
    'function m0(n){return "$"+Math.round(n).toLocaleString("en-US");}' +
    'function ct(n){return Math.round(n).toLocaleString("en-US");}' +
    'var S={costs:14000,shirts:4000,margin:45,vol:10,color:10};' +
    'function model(){var cpp=S.costs/S.shirts;var base=cpp/(1-S.margin/100);var vd=S.vol/100,ac=S.color/100;' +
    'var tm=[1];for(var i=1;i<4;i++)tm[i]=tm[i-1]*(1-vd*Math.pow(0.8,i-1));' +
    'var cm=[1];for(var c=1;c<8;c++)cm[c]=cm[c-1]*(1+ac*Math.pow(0.9,c-1));' +
    'return {cpp:cpp,base:base,tm:tm,cm:cm};}' +
    'function build(){var M=model();var rows="";' +
    'for(var ci=0;ci<8;ci++){var col=ci+1;rows+="<tr><td class=\\"rl\\">"+col+(col===1?" color":" colors")+"</td>";' +
    'for(var qi=0;qi<4;qi++){rows+="<td>"+m2(M.base*M.cm[ci]*M.tm[qi])+"</td>";}rows+="</tr>";}' +
    'root.querySelector("[data-grid]").innerHTML=rows;' +
    'root.querySelector("[data-out=\\"cpp\\"]").textContent=m2(M.cpp);' +
    'root.querySelector("[data-out=\\"base\\"]").textContent=m2(M.base);}' +
    'function wire(k,t){var sl=root.querySelector("[data-in=\\""+k+"\\"]");var ov=root.querySelector("[data-val=\\""+k+"\\"]");' +
    'function u(){S[k]=parseFloat(sl.value);ov.textContent=t==="m0"?m0(S[k]):t==="ct"?ct(S[k]):t==="pct"?(Math.round(S[k])+"%"):S[k];build();}' +
    'sl.addEventListener("input",u);u();}' +
    'wire("costs","m0");wire("shirts","ct");wire("margin","pct");wire("vol","pct");wire("color","pct");})();</script>';
  return `<div class="calc" id="calc-chart">${controls}${stats}${table}${caption}</div>${script}`;
}

function embroideryCalc() {
  const controls =
    sliderRow("overhead", "Monthly overhead", "rent, power, insurance, software, your pay", 'min="1500" max="16000" step="250" value="6000"') +
    sliderRow("pieces", "Pieces per month", "how many stitched pieces you run", 'min="500" max="8000" step="100" value="2500"') +
    sliderRow("base", "Base run cost (under 5K)", "your cost per piece at the smallest stitch tier", 'min="1.5" max="6" step="0.1" value="3"') +
    sliderRow("tier", "Cost per stitch tier", "each higher stitch band adds this", 'min="0.5" max="2.5" step="0.1" value="1.2"') +
    sliderRow("margin", "Target margin", "the profit slice you keep", 'min="15" max="60" step="1" value="45"');
  // Static header: corner + quantity tiers [12,24,48,72,144] (embroidery qtyTiers).
  const head = '<thead><tr><th>Stitches \\ Qty</th><th>12</th><th>24</th><th>48</th><th>72</th><th>144</th></tr></thead>';
  const table = `<table class="calc-table">${head}<tbody data-grid></tbody></table>`;
  const script =
    '<script>(function(){var root=document.getElementById("calc-embroidery");if(!root)return;' +
    'var TIERS_S=["Under 5K","5K\\u201310K","10K\\u201315K","15K+"],TIERS_Q=[12,24,48,72,144],QF={12:1.0,24:0.86,48:0.72,72:0.62,144:0.52};' +
    'function m2(n){return "$"+(Math.round(n*100)/100).toFixed(2);}' +
    'function m0(n){return "$"+Math.round(n).toLocaleString("en-US");}' +
    'function ct(n){return Math.round(n).toLocaleString("en-US");}' +
    'var S={overhead:6000,pieces:2500,base:3,tier:1.2,margin:45};' +
    'function build(){var oph=S.overhead/S.pieces;var mf=S.margin/100;var rows="";' +
    'for(var i=0;i<TIERS_S.length;i++){var tierBase=S.base+i*S.tier;rows+="<tr><td class=\\"rl\\">"+TIERS_S[i]+"</td>";' +
    'for(var t=0;t<TIERS_Q.length;t++){var q=TIERS_Q[t];var cost=oph+tierBase*QF[q];var price=cost/(1-mf);rows+="<td>"+m2(price)+"</td>";}rows+="</tr>";}' +
    'root.querySelector("[data-grid]").innerHTML=rows;' +
    'var meq=Math.round(mf/(1-mf)*100);' +
    'root.querySelector("[data-note]").textContent="Overhead adds "+m2(oph)+" to every piece ("+m0(S.overhead)+" \\u00f7 "+ct(S.pieces)+" pieces). Each cell = cost \\u00f7 "+(1-mf).toFixed(2)+". Your "+S.margin+"% margin is a "+meq+"% markup \\u2014 not the same thing.";}' +
    'function wire(k,t){var sl=root.querySelector("[data-in=\\""+k+"\\"]");var ov=root.querySelector("[data-val=\\""+k+"\\"]");' +
    'function u(){S[k]=parseFloat(sl.value);ov.textContent=t==="m0"?m0(S[k]):t==="m2"?m2(S[k]):t==="ct"?ct(S[k]):t==="pct"?(Math.round(S[k])+"%"):S[k];build();}' +
    'sl.addEventListener("input",u);u();}' +
    'wire("overhead","m0");wire("pieces","ct");wire("base","m2");wire("tier","m2");wire("margin","pct");})();</script>';
  const digit = '<p class="calc-digit">+ one-time digitizing \\u2248 $50 per new design \\u2014 charge it once, reuse the file forever.</p>';
  return `<div class="calc" id="calc-embroidery">${controls}${table}<p class="calc-note" data-note>–</p>${digit}</div>${script}`;
}

const CALCS = { job: jobCalc, chart: chartCalc, embroidery: embroideryCalc };

// ── Block renderer ───────────────────────────────────────────────────────────
function renderBlock(b) {
  switch (b.type) {
    case "p":
      return `<p>${b.html}</p>`;
    case "h2":
      return `<h2>${esc(b.text)}</h2>`;
    case "ul":
      return `<ul class="body-list">${b.items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
    case "callout":
      return `<div class="callout"><h4>${esc(b.title)}</h4><p>${b.html}</p></div>`;
    case "calculator":
      return (CALCS[b.kind] || (() => ""))();
    default:
      return "";
  }
}

// ── Post page ────────────────────────────────────────────────────────────────
function renderPost(post) {
  const canonical = `${SITE.baseUrl}/blog/${post.slug}`;
  const bodyHtml = post.body.map(renderBlock).join("\n");
  // Optional FAQ: the visible <dl> and the FAQPage JSON-LD must carry the same
  // text — Google ignores schema-only FAQs. Same markup/pattern as /compare.
  const faqHtml = post.faqs
    ? `<h2>Common questions</h2>\n<dl class="faq">\n${post.faqs
        .map((f) => `<dt>${esc(f.q)}</dt><dd>${esc(f.a)}</dd>`)
        .join("\n")}\n</dl>`
    : "";
  const faqLd = post.faqs
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: post.faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      }
    : null;
  // wordCount for the BlogPosting schema: visible body text only (tags and
  // entities stripped), matching what a reader actually sees on the page.
  const bodyText = post.body
    .flatMap((b) => [b.html, b.text, b.title, ...(b.items || [])])
    .filter(Boolean)
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ");
  const article = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${canonical}#post`,
    headline: post.title,
    description: post.description,
    image: post.ogImage || SITE.logo,
    url: canonical,
    inLanguage: "en-US",
    isPartOf: { "@type": "Blog", "@id": `${SITE.baseUrl}/blog#blog` },
    articleSection: post.category,
    wordCount: bodyText.split(/\s+/).filter(Boolean).length,
    timeRequired: `PT${post.readMin}M`,
    datePublished: isoDate(post.date),
    dateModified: isoDate(post.updated || post.date),
    author: { "@type": "Person", name: post.author, jobTitle: post.authorRole, url: SITE.baseUrl },
    publisher: {
      "@type": "Organization",
      name: SITE.name,
      url: SITE.baseUrl,
      logo: { "@type": "ImageObject", url: SITE.logo },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
  };
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "InkTracker", item: `${SITE.baseUrl}/` },
      { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE.baseUrl}/blog` },
      { "@type": "ListItem", position: 3, name: post.title, item: canonical },
    ],
  };
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(post.title)} — InkTracker</title>
  <meta name="description" content="${esc(post.description)}" />
  <link rel="canonical" href="${esc(canonical)}" />
  <link rel="icon" type="image/png" href="/icon-192.png" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${esc(post.title)}" />
  <meta property="og:description" content="${esc(post.description)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${esc(post.ogImage || SITE.logo)}" />
  <meta property="article:published_time" content="${esc(isoDate(post.date))}" />
  <meta property="article:modified_time" content="${esc(isoDate(post.updated || post.date))}" />
  <meta property="article:author" content="${esc(post.author)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(post.title)}" />
  <meta name="twitter:description" content="${esc(post.description)}" />
  <meta name="twitter:image" content="${esc(post.ogImage || SITE.logo)}" />
  ${FONTS}
  <style>${CSS}</style>
  ${ldJson(article)}
  ${ldJson(breadcrumb)}${faqLd ? `\n  ${ldJson(faqLd)}` : ""}
</head>
<body>
${siteHeader}
<main class="wrap">
  <nav class="crumbs"><a href="${SITE.baseUrl}/">Home</a> › <a href="${SITE.baseUrl}/blog">Blog</a> › ${esc(post.category)}</nav>
  <span class="cat-tag">${esc(post.category)}</span>
  <h1>${esc(post.title)}</h1>
  <p class="post-meta">By ${esc(post.author)}, ${esc(post.authorRole)} · ${esc(fmtDate(post.date))} · ${esc(String(post.readMin))} min read</p>
  <article class="post-body">
${bodyHtml}${faqHtml ? `\n${faqHtml}` : ""}
  </article>
  ${post.cta ? ctaBlock(post) : ""}
</main>
${siteFooter}
</body>
</html>`;
}

// ── Index page ───────────────────────────────────────────────────────────────
function renderIndex(posts) {
  const canonical = `${SITE.baseUrl}/blog`;
  const cards = posts
    .map(
      (p) => `<li>
      <span class="cat-tag">${esc(p.category)}</span>
      <h2><a href="${SITE.baseUrl}/blog/${p.slug}">${esc(p.title)}</a></h2>
      <p>${esc(p.description)}</p>
      <p class="post-meta">By ${esc(p.author)} · ${esc(fmtDate(p.date))} · ${esc(String(p.readMin))} min read</p>
    </li>`,
    )
    .join("\n");
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "InkTracker", item: `${SITE.baseUrl}/` },
      { "@type": "ListItem", position: 2, name: "Blog", item: canonical },
    ],
  };
  const blogLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": `${canonical}#blog`,
    name: "InkTracker Blog",
    url: canonical,
    inLanguage: "en-US",
    publisher: {
      "@type": "Organization",
      name: SITE.name,
      url: SITE.baseUrl,
      logo: { "@type": "ImageObject", url: SITE.logo },
    },
    blogPost: posts.map((p) => ({
      "@type": "BlogPosting",
      "@id": `${SITE.baseUrl}/blog/${p.slug}#post`,
      headline: p.title,
      url: `${SITE.baseUrl}/blog/${p.slug}`,
      datePublished: isoDate(p.date),
      dateModified: isoDate(p.updated || p.date),
      author: { "@type": "Person", name: p.author, url: SITE.baseUrl },
    })),
  };
  const title = "InkTracker Blog — pricing & running a print shop";
  const desc = "Plain-English guides on pricing screen printing and embroidery, running the money side of a print shop, and getting jobs out the door — from a working printer.";
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
  ${ldJson(blogLd)}
</head>
<body>
${siteHeader}
<main class="wrap">
  <nav class="crumbs"><a href="${SITE.baseUrl}/">Home</a> › Blog</nav>
  <h1>The InkTracker Blog</h1>
  <p class="lede">How to price your work, run the money side, and get jobs out the door — written by a working print shop, not a marketing team.</p>
  <ul class="post-list">
${cards}
  </ul>
  ${DISCLAIMER_NEWSLETTER}
</main>
${siteFooter}
</body>
</html>`;
}

// newsletter capture: phase 2
const DISCLAIMER_NEWSLETTER = `<!-- newsletter capture: phase 2 -->`;

// ── /for-printers landing (§6) ───────────────────────────────────────────────
function renderForPrinters() {
  const canonical = `${SITE.baseUrl}/for-printers`;
  const title = "That quote was made in InkTracker — print shop software";
  const desc = "The shop that sent you that quote runs quoting, production, and invoicing in one place — software built by a printer, for printers. Start a 14-day free trial, no card.";
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
</head>
<body>
${siteHeader}
<main class="wrap">
  <nav class="crumbs"><a href="${SITE.baseUrl}/">Home</a> › For printers</nav>
  <h1>That quote was made in InkTracker.</h1>
  <p class="lede">The shop that sent it runs quotes, production, and invoicing in one place — software built by a printer, for printers. If you're still living in spreadsheets and sticky notes, come see why they switched.</p>
  <ul class="proof">
    <li><b>Quote in minutes, not a spreadsheet.</b> Live blank pricing, color and quantity breaks, and setup fees — priced right before it hits the press.</li>
    <li><b>A production board your whole shop can see.</b> From art approval to shipping, everyone works off the same pipeline.</li>
    <li><b>Invoices + QuickBooks, no double entry.</b> A two-way sync keeps invoices, payments, and customers matched.</li>
  </ul>
  <div class="blog-cta">
    <h3>See why they switched.</h3>
    <p>Made by a working print shop. We use it every day.</p>
    <a class="cta" href="${SITE.baseUrl}/?ref=quote">Start your 14-day free trial — no card</a>
    <div class="related">Or read <a href="${SITE.baseUrl}/compare">the honest software buyer's guide</a>.</div>
  </div>
</main>
${siteFooter}
</body>
</html>`;
}

// ── sitemap sync (managed block, mirrors the compare pattern) ─────────────────
function syncSitemap(posts) {
  const path = join(PUBLIC, "sitemap.xml");
  const urls = [
    `${SITE.baseUrl}/blog`,
    ...posts.map((p) => `${SITE.baseUrl}/blog/${p.slug}`),
    `${SITE.baseUrl}/for-printers`,
  ];
  const entries = urls
    .map(
      (u) =>
        `  <url>\n    <loc>${u}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>`,
    )
    .join("\n");
  const block = `  <!-- blog-pages:start -->\n${entries}\n  <!-- blog-pages:end -->`;
  let xml = readFileSync(path, "utf8");
  if (xml.includes("<!-- blog-pages:start -->")) {
    xml = xml.replace(/  <!-- blog-pages:start -->[\s\S]*?  <!-- blog-pages:end -->/, block);
  } else {
    xml = xml.replace("</urlset>", `${block}\n</urlset>`);
  }
  writeFileSync(path, xml);
}

// ── write ────────────────────────────────────────────────────────────────────
mkdirSync(join(PUBLIC, "blog"), { recursive: true });
writeFileSync(join(PUBLIC, "blog", "index.html"), renderIndex(POSTS));
for (const post of POSTS) {
  const dir = join(PUBLIC, "blog", post.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), renderPost(post));
}
mkdirSync(join(PUBLIC, "for-printers"), { recursive: true });
writeFileSync(join(PUBLIC, "for-printers", "index.html"), renderForPrinters());
syncSitemap(POSTS);

console.log(`✓ Generated blog index + ${POSTS.length} posts → public/blog/`);
console.log("✓ Generated /for-printers landing → public/for-printers/index.html");
console.log("✓ Synced /blog + /for-printers into public/sitemap.xml");
