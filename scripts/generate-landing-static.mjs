// ─────────────────────────────────────────────────────────────────────────
// Static landing snapshot — bakes the landing page's real copy into
// index.html as crawlable HTML inside <div id="root">, between managed
// markers. React's createRoot().render() replaces #root's children the
// moment the bundle boots, so:
//   • crawlers / AI retrievers that don't run JS see the actual page content
//     (previously: empty div — the homepage was invisible to raw fetches)
//   • visitors on slow connections see real content instead of a blank page
//   • logged-in users see it for a blink before the app mounts
//
// NOT a shadow page: every string comes from src/lib/landing/landingCopy.js,
// the same module the React landing renders from — content parity is
// structural, and the parity test in scripts/__tests__/landingStatic.test.js
// enforces that App.jsx imports the module rather than inlining copy.
//
// Run via `npm run build:content` (output committed, same as /compare + blog).
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { HERO, VALUE_PROPS, PRICING, PRICING_INCLUDES, FAQ_ITEMS } from "../src/lib/landing/landingCopy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX = join(__dirname, "..", "index.html");

const START = "<!-- landing-static:start -->";
const END = "<!-- landing-static:end -->";

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Anchor hrefs (#tour etc.) only resolve once the SPA renders those
// sections — for the static block, point value-prop links at real
// crawlable pages instead.
const STATIC_LINKS = { "#tour": "/compare", "#how-pricing": "/blog/how-to-price-a-screen-printing-job", "#wildways": "https://biotamfg.com/pages/wildways" };

function render() {
  const props = VALUE_PROPS.map(
    (p) => `      <section>
        <h3>${esc(p.title)}</h3>
        <p>${esc(p.body)} <a href="${esc(STATIC_LINKS[p.href] || p.href)}">${esc(p.cta)}</a></p>
      </section>`,
  ).join("\n");
  const includes = PRICING_INCLUDES.map((f) => `        <li>${esc(f)}</li>`).join("\n");
  const faqs = FAQ_ITEMS.map(
    (f) => `        <dt>${esc(f.q)}</dt>
        <dd>${esc(f.a)}</dd>`,
  ).join("\n");

  // Minimal inline styling: readable during the pre-JS blink, invisible to
  // the app (React discards this subtree on mount). System fonts only —
  // no webfont requests for a block that lives milliseconds for most users.
  // data-landing-static lets the head hide it on app routes (/QuoteRequest
  // embedded in shop sites must never flash landing marketing).
  return `${START}
    <div data-landing-static style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:720px;margin:0 auto;padding:48px 20px;line-height:1.6;color:#0e0e0e">
      <header>
        <p style="text-transform:uppercase;letter-spacing:.2em;font-size:12px;color:#6b6b6b">InkTracker — print-shop management software</p>
        <h1>${esc(HERO.h1)}</h1>
        <p>${esc(HERO.sub)}</p>
        <p><a href="/#pricing">${esc(HERO.trialLine)}</a></p>
      </header>
${props}
      <section>
        <h2>Pricing</h2>
        <p>One plan, no tiers: <strong>${esc(PRICING.price)}${esc(PRICING.per)}</strong>. ${esc(PRICING.annualLine)}</p>
        <ul>
${includes}
        </ul>
      </section>
      <section>
        <h2>Common questions</h2>
        <dl>
${faqs}
        </dl>
      </section>
      <nav>
        <p>More: <a href="/tools">free tools</a> · <a href="/blog">the InkTracker blog</a> · <a href="/compare">choosing screen printing software</a> · <a href="/support">support</a></p>
        <p>InkTracker is built and used in daily production at <a href="https://biotamfg.com">Biota Mfg</a>, a working screen-print shop in Reno.</p>
      </nav>
    </div>
    ${END}`;
}

const html = readFileSync(INDEX, "utf8");
const startIdx = html.indexOf(START);
const endIdx = html.indexOf(END);
if (startIdx === -1 || endIdx === -1) {
  console.error(`✗ landing-static markers not found in index.html — expected ${START} … ${END} inside <div id="root">`);
  process.exit(1);
}
const next = html.slice(0, startIdx) + render() + html.slice(endIdx + END.length);
writeFileSync(INDEX, next);
console.log("✓ Injected static landing snapshot into index.html #root");
