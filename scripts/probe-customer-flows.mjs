#!/usr/bin/env node
// Synthetic monitor for the CUSTOMER-facing flows — the checks that would have
// caught the "Bucket not found" art-proof outage before a customer emailed us.
//
// Why this exists: the existing uptime probe (.github/workflows/uptime.yml)
// checks that the homepage and /api/health return 200. Both were perfectly
// green for the three weeks that EVERY customer's art proof was broken —
// because the page loads fine, and the failure is one layer deeper: a dead URL
// embedded inside it. Liveness checks don't catch broken customer journeys.
//
// So this walks the actual path a customer walks, from the outside, against
// production, using real data:
//
//   1. the quote-payment page HTML serves
//   2. the deployed JS bundles contain NO runtime `import.meta`
//      (the exact #680 failure: Vite env replacement silently not applied,
//      which broke every proof URL while all status codes stayed 200)
//   3. createCheckoutSession getQuote returns the quote for a real token
//   4. the artworkProof proxy 302s to a signed URL that actually serves the
//      file — asserting the CONTENT TYPE, not just the status
//   5. no customer-facing response body contains a raw error signature
//      ("Bucket not found", {"statusCode":...}, stack traces)
//   6. the proxy's FAILURE path renders friendly HTML, not bare "Not found"
//
// Read-only: it picks a recent real quote that has artwork via the service
// role, then exercises it exactly as an anonymous customer would. It never
// writes to production and never creates canary rows.
//
// Run locally:  SUPABASE_SERVICE_ROLE_KEY=... node scripts/probe-customer-flows.mjs
// In CI:        .github/workflows/customer-flows.yml (hourly)

const SUPABASE_URL = process.env.SUPABASE_URL || "https://skmltfbibaqcjddmeqvi.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SITE = (process.env.PROBE_SITE_URL || "https://www.inktracker.app").replace(/\/$/, "");
const TIMEOUT_MS = 25000;

// Substrings that must NEVER appear in a response a customer can see.
const RAW_ERROR_SIGNATURES = [
  "Bucket not found",
  '"statusCode"',
  "at Object.<anonymous>",
  "TypeError:",
  "ReferenceError:",
  "PGRST",
  "duplicate key value",
  "violates row-level security",
];

const failures = [];
const notes = [];
let checks = 0;

function ok(name, detail = "") {
  checks++;
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail) {
  checks++;
  failures.push(`${name}: ${detail}`);
  console.log(`  ✗ ${name} — ${detail}`);
}
function skip(name, why) {
  notes.push(`${name} skipped (${why})`);
  console.log(`  ~ ${name} skipped — ${why}`);
}

async function fetchWithTimeout(url, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function scanForRawErrors(label, body) {
  const hit = RAW_ERROR_SIGNATURES.find((sig) => body.includes(sig));
  if (hit) {
    fail(`${label} leaks raw error text`, `body contains ${JSON.stringify(hit)}`);
    return false;
  }
  return true;
}

// ── 1. Customer page serves ────────────────────────────────────────────
async function checkPageServes() {
  try {
    const res = await fetchWithTimeout(`${SITE}/quotepayment`, { redirect: "follow" });
    const body = await res.text();
    if (!res.ok) return fail("quote-payment page", `HTTP ${res.status}`);
    scanForRawErrors("quote-payment page", body);
    ok("quote-payment page serves", `HTTP ${res.status}`);
    return body;
  } catch (err) {
    fail("quote-payment page", err.message);
    return "";
  }
}

// ── 2. Deployed bundles have no runtime import.meta ────────────────────
// This is the #680 regression detector, checked against what production is
// ACTUALLY serving (the build gate checks the artifact; this checks the wire).
async function checkBundlesEnvReplaced(pageHtml) {
  const idxMatch = pageHtml.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
  if (!idxMatch) return skip("bundle env replacement", "no index chunk in page HTML");

  const seen = new Set();
  const queue = [idxMatch[0]];
  let scanned = 0;

  // Walk index → lazy chunks (one level is enough to reach the customer pages).
  while (queue.length && scanned < 25) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    let src;
    try {
      const res = await fetchWithTimeout(`${SITE}/${rel.replace(/^\//, "")}`);
      if (!res.ok) continue;
      src = await res.text();
    } catch { continue; }
    scanned++;

    if (src.includes("import.meta")) {
      return fail(
        "bundle env replacement",
        `${rel} contains runtime 'import.meta' — Vite env replacement did not apply (this is the #680 bug: every proof URL silently breaks while all status codes stay 200)`,
      );
    }
    if (scanned === 1) {
      for (const m of src.matchAll(/(?:QuotePayment|ArtApproval|OrderStatus|proxyUrl|uploadFile)-[A-Za-z0-9_-]+\.js/g)) {
        queue.push(`assets/${m[0]}`);
      }
    }
  }
  ok("bundle env replacement", `${scanned} chunk(s) clean of runtime import.meta`);
}

// ── Pick a real quote with artwork (read-only) ─────────────────────────
async function pickQuoteWithArtwork() {
  // Explicit override — lets the journey run without the service-role key
  // (which deliberately isn't on any dev machine). Point it at any quote that
  // has a proof; the token is that quote's public_token.
  if (process.env.PROBE_QUOTE_ID && process.env.PROBE_QUOTE_TOKEN) {
    const res = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/createCheckoutSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "getQuote",
        quoteId: process.env.PROBE_QUOTE_ID,
        token: process.env.PROBE_QUOTE_TOKEN,
      }),
    });
    if (!res.ok) return null;
    const { quote } = await res.json();
    if (!quote?.selected_artwork?.length) return null;
    return {
      id: process.env.PROBE_QUOTE_ID,
      quote_id: quote.quote_id || "(override)",
      public_token: process.env.PROBE_QUOTE_TOKEN,
      selected_artwork: quote.selected_artwork,
    };
  }
  if (!SERVICE_KEY) return null;
  const res = await fetchWithTimeout(
    `${SUPABASE_URL}/rest/v1/quotes?select=id,quote_id,public_token,selected_artwork` +
      `&selected_artwork=not.is.null&public_token=not.is.null&order=created_date.desc&limit=25`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.find((r) => Array.isArray(r.selected_artwork) && r.selected_artwork.some((a) => a?.path || a?.url)) || null;
}

// ── 3 + 4 + 5. The real customer journey ───────────────────────────────
async function checkCustomerJourney(quote) {
  // 3. The page's data call
  try {
    const res = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/createCheckoutSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "getQuote", quoteId: quote.id, token: quote.public_token }),
    });
    const body = await res.text();
    if (!res.ok) fail("getQuote", `HTTP ${res.status}`);
    else if (!body.includes('"quote"')) fail("getQuote", "response has no quote payload");
    else ok("getQuote returns the quote", `HTTP ${res.status}`);
    scanForRawErrors("getQuote", body);
  } catch (err) {
    fail("getQuote", err.message);
  }

  // 4. The proof proxy — status AND content type. A 200 that serves JSON is
  //    exactly what the customer saw; only a real file counts as healthy.
  const art = quote.selected_artwork.find((a) => a?.path || a?.url);
  const path = art.path || art.url;
  const proxy = `${SUPABASE_URL}/functions/v1/artworkProof?type=quote&id=${encodeURIComponent(quote.id)}` +
    `&token=${encodeURIComponent(quote.public_token)}&path=${encodeURIComponent(path)}`;
  try {
    const res = await fetchWithTimeout(proxy, { redirect: "follow" });
    const ctype = res.headers.get("content-type") || "";
    const body = await res.text();
    if (!res.ok) {
      fail("art-proof proxy", `HTTP ${res.status} (customer would see a broken proof)`);
    } else if (/application\/json/i.test(ctype)) {
      fail("art-proof proxy", `served JSON (${ctype}) instead of the file — this is the customer-visible error class`);
    } else {
      ok("art-proof proxy serves the file", `HTTP ${res.status}, ${ctype || "no content-type"}`);
    }
    scanForRawErrors("art-proof proxy", body.slice(0, 4000));
  } catch (err) {
    fail("art-proof proxy", err.message);
  }

  // 6. Failure path must be friendly for a NAVIGATING customer, never bare text.
  try {
    const res = await fetchWithTimeout(
      `${SUPABASE_URL}/functions/v1/artworkProof?type=quote&id=${encodeURIComponent(quote.id)}&token=deadbeefdeadbeef&path=nope.pdf`,
      { headers: { Accept: "text/html", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" } },
    );
    const body = await res.text();
    if (body.trim() === "Not found") {
      fail("art-proof failure page", "returns bare 'Not found' text to a navigating customer");
    } else if (!/<html/i.test(body)) {
      fail("art-proof failure page", `not an HTML page (${body.slice(0, 60)})`);
    } else {
      ok("art-proof failure page is friendly HTML", `HTTP ${res.status}`);
    }
    scanForRawErrors("art-proof failure page", body);
  } catch (err) {
    fail("art-proof failure page", err.message);
  }
}

// ── main ───────────────────────────────────────────────────────────────
console.log(`Customer-flow probe → ${SITE}\n`);

const pageHtml = await checkPageServes();
if (pageHtml) await checkBundlesEnvReplaced(pageHtml);

const quote = await pickQuoteWithArtwork();
if (!quote) {
  skip("customer journey", SERVICE_KEY
    ? "no recent quote with artwork found"
    : "SUPABASE_SERVICE_ROLE_KEY not set");
} else {
  console.log(`  · using quote ${quote.quote_id} (read-only)`);
  await checkCustomerJourney(quote);
}

console.log("");
if (notes.length) notes.forEach((n) => console.log(`note: ${n}`));

if (failures.length) {
  console.error(`\nFAILED — ${failures.length} of ${checks} customer-flow checks:\n`);
  failures.forEach((f) => console.error(`  • ${f}`));
  console.error("\nA customer may be seeing a broken page or an error code RIGHT NOW.");
  process.exit(1);
}

console.log(`OK — ${checks} customer-flow checks passed.`);
