#!/usr/bin/env node
// Smoke-test the live edge functions that the anonymous public quote
// wizard depends on. Catches the failure class that bit us twice now:
//
//   - 2026-05-27: ssLookupStyle/acLookupStyle code updated locally to
//     accept `shopOwner`, but the new code never got deployed to
//     Supabase. Public wizard returned "No results" for valid styles.
//
//   - 2026-05-29: Same functions redeployed, but Supabase's gateway
//     still rejected because verify_jwt wasn't disabled on the new
//     deploy. Public wizard returned "No results" for valid styles
//     AGAIN.
//
// What this script does: pings each function with a known good payload
// (style 1717 — Comfort Colors Heavyweight Tee for ssLookupStyle, a
// known AC style for acLookupStyle) using ONLY the anon key + shopOwner
// body param — exactly what the anonymous wizard sends. If either
// function returns a 401 / "Missing authorization header" / "Style not
// found" the script exits non-zero and BLOCKS the deploy.
//
// Run via `npm run smoke:functions`. Wired into `npm run deploy` so it
// runs automatically after `deploy:functions` and BEFORE the Vercel
// build ships. A frontend deploy that depends on un-deployed edge
// functions never reaches production.
//
// Required env (already present in .env.local for dev):
//   VITE_SUPABASE_URL
//   VITE_SUPABASE_ANON_KEY
//   SMOKE_SHOP_OWNER   (optional; defaults to joe@biotamfg.co)

import { readFileSync, existsSync } from "node:fs";

// Lightweight .env reader so we don't need a dependency.
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env");

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const SHOP_OWNER = process.env.SMOKE_SHOP_OWNER || "joe@biotamfg.co";

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("[smoke] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.");
  console.error("Set them in .env / .env.local and re-run.");
  process.exit(2);
}

// Each probe is one function + payload + a predicate that returns true
// when the live response looks healthy. Predicates are intentionally
// loose — they assert the shape we need at the wizard, not exact field
// values that might shift as supplier catalogs change.
const probes = [
  {
    name: "ssLookupStyle",
    payload: { styleNumber: "1717", shopOwner: SHOP_OWNER },
    healthy: (json) => Array.isArray(json?.matches) && json.matches.length > 0,
    badShape: (json) => json?.code === "UNAUTHORIZED_NO_AUTH_HEADER" || json?.error === "Unauthorized",
  },
  {
    name: "acLookupStyle",
    payload: { styleCode: "5001", shopOwner: SHOP_OWNER },
    // AC may legitimately 404 on certain style codes — what we're
    // really verifying is that the GATEWAY accepts our anon+shopOwner
    // call. As long as the response isn't a JWT/auth rejection, the
    // function is live and reachable by the public wizard.
    healthy: (json) => !(json?.code === "UNAUTHORIZED_NO_AUTH_HEADER" || json?.error === "Unauthorized"),
    badShape: (json) => json?.code === "UNAUTHORIZED_NO_AUTH_HEADER" || json?.error === "Unauthorized",
  },
  {
    name: "smLookupStyle",
    payload: { styleNumber: "PC61", shopOwner: SHOP_OWNER },
    // Same gateway-level check as AC. Additionally: until SanMar
    // onboarding completes there are no credentials anywhere, so the
    // function legitimately answers 500 "SanMar credentials not
    // configured" — that still proves it's deployed and reachable by
    // the anonymous wizard, which is what this smoke test guards.
    tolerateHttpError: (json) => /sanmar credentials not configured/i.test(json?.error || ""),
    healthy: (json) => !(json?.code === "UNAUTHORIZED_NO_AUTH_HEADER" || json?.error === "Unauthorized"),
    badShape: (json) => json?.code === "UNAUTHORIZED_NO_AUTH_HEADER" || json?.error === "Unauthorized",
  },
];

console.log(`[smoke] Probing ${probes.length} edge function(s) at ${SUPABASE_URL}…\n`);

let failures = 0;

for (const probe of probes) {
  const url = `${SUPABASE_URL}/functions/v1/${probe.name}`;
  let res, json, text;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY },
      body: JSON.stringify(probe.payload),
    });
    text = await res.text();
    try { json = JSON.parse(text); } catch { json = null; }
  } catch (err) {
    console.error(`  ✗ ${probe.name} — network error: ${err.message}`);
    failures++;
    continue;
  }

  const httpOk = res.ok || Boolean(probe.tolerateHttpError?.(json));
  const ok = httpOk && json && probe.healthy(json) && !probe.badShape(json);
  if (ok) {
    console.log(`  ✓ ${probe.name} — live, accepting anon+shopOwner.`);
  } else {
    failures++;
    console.error(`  ✗ ${probe.name} — status ${res.status}, response:`);
    console.error(`    ${text.slice(0, 300)}${text.length > 300 ? "…" : ""}`);
    if (probe.badShape(json)) {
      console.error(`    → Looks like Supabase's JWT gateway is blocking. Redeploy with:`);
      console.error(`      npx supabase functions deploy ${probe.name} --no-verify-jwt`);
    }
  }
}

console.log("");
if (failures > 0) {
  console.error(`[smoke] ${failures} probe(s) failed. Refusing to ship the frontend on top of broken edge functions.`);
  process.exit(1);
}
console.log("[smoke] All edge functions healthy. Safe to deploy frontend.");
