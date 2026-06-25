#!/usr/bin/env node
// Smoke test: prove the DEPLOYED qbWebhook function accepts a webhook signed
// with the verifier token you provide. This is exactly the check that was
// missing when production webhooks silently 401'd because the Supabase secret
// didn't match Intuit's production verifier token.
//
// Usage:
//   QB_WEBHOOK_VERIFIER_TOKEN=<intuit production verifier token> \
//   SUPABASE_URL=https://<ref>.supabase.co \
//   node scripts/smoke-qb-webhook.mjs
//
// Pass  → the function verified a body signed with that token (token matches).
// FAIL (401) → the deployed function's QB_WEBHOOK_VERIFIER_TOKEN does NOT match
//              the token you signed with. Fix the Supabase secret to match
//              Intuit's PRODUCTION verifier token, redeploy qbWebhook, re-run.
//
// Side effects: none meaningful. The payload uses realmId "0" (matches no shop),
// so nothing is read or written beyond a single idempotency-dedup row.

import { computeQbSignature } from "../supabase/functions/_shared/qbWebhookSignature.js";

const token = process.env.QB_WEBHOOK_VERIFIER_TOKEN;
const baseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

if (!token) {
  console.error("✗ QB_WEBHOOK_VERIFIER_TOKEN not set. Pass Intuit's PRODUCTION verifier token.");
  process.exit(2);
}
if (!baseUrl) {
  console.error("✗ SUPABASE_URL (or VITE_SUPABASE_URL) not set.");
  process.exit(2);
}

const endpoint = `${baseUrl.replace(/\/$/, "")}/functions/v1/qbWebhook`;
// Benign payload: bogus realm → no shop match → no data touched.
const body = JSON.stringify({
  eventNotifications: [
    { realmId: "0", dataChangeEvent: { entities: [] } },
  ],
});

const signature = await computeQbSignature(body, token);

console.log(`[smoke:qbwebhook] POST ${endpoint}`);
const res = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json", "intuit-signature": signature },
  body,
});

if (res.status === 401) {
  console.error(
    `✗ FAIL — HTTP 401. The deployed qbWebhook rejected a body signed with this token.\n` +
    `  → The Supabase secret QB_WEBHOOK_VERIFIER_TOKEN does not match the token you passed.\n` +
    `  → Set it to Intuit's PRODUCTION verifier token, redeploy qbWebhook, re-run.`,
  );
  process.exit(1);
}
if (!res.ok) {
  console.error(`✗ FAIL — unexpected HTTP ${res.status}. ${await res.text()}`);
  process.exit(1);
}
console.log(`✓ PASS — HTTP ${res.status}. Signature accepted; the deployed token matches.`);
process.exit(0);
