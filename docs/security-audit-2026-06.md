# InkTracker Security Audit — June 2026

Seven-domain review (tenant isolation/RLS, edge-function authZ, secrets, payment
integrity, public endpoints/IDOR/SSRF, injection/XSS, input-validation/headers/storage).
Each serious finding was verified against live code before action.

## FIXED & DEPLOYED (2026-06-19)

### CRITICAL
1. **Authenticated profile self-escalation → cross-tenant breakout.**
   `profiles` UPDATE policy scoped the row but not the columns, so any
   authenticated user could `UPDATE profiles SET role='admin'` / `assigned_shops=[victim]`
   / `subscription_tier='shop'` / `mfa_email_enabled=false` on their own row.
   **Fix:** `BEFORE UPDATE` trigger `guard_profiles_privileged_columns`
   (migration 20260710000000) — blocks changes to role, shop_owner,
   subscription_*, trial_ends_at, mfa_email_enabled, assigned_shops,
   manager_permissions when `current_user IN (authenticated, anon)`, firing only
   on actual change. service_role + postgres-owned DEFINER RPCs exempt.
   Onboarding payload (`buildOnboardingProfile`) no longer writes the redundant
   billing columns. Verified live: escalation blocked, benign edits pass,
   service_role unaffected.

2. **Anon self-mark-paid.** `quotes_anon_update` let a quote-link/token holder
   PATCH any column (`paid`, `status`, `total`) via REST. No legitimate client
   use. **Fix:** dropped the policy (migration 20260710010000). Remaining anon
   quote policies: insert-restricted + token-scoped select only.

### HIGH
3. **`sendQuoteEmail` phishing/impersonation.** Authed path sent arbitrary
   recipients + subject/body/payment-link + spoofed shop name from the verified
   domain, with no quote-ownership check. **Fix:** authed path now verifies the
   caller's shop owns the quote (owner / member / assigned / broker) and forces
   brand fields (shopName, logo, broker name/email) from the DB.

4. **Broker wholesale pricing + customer PII leaked over the wire.**
   `getQuote`/`approveQuote` returned the raw quote (`select *`) with broker
   wholesale numbers + full customer row (tax_id, private notes) to the
   unauthenticated payment page; the broker→client swap was client-side only.
   **Fix:** server-side `toCustomerFacingQuote` (overwrites wholesale with
   client values) + drop `public_token` from the body + allowlist customer to
   {name, company, email, default_deposit_pct}. New shared module
   `_shared/customerFacingQuote.js`. Verified live.

5. **Wizard had no reCAPTCHA** (highest-volume anon write; only honeypot/dwell/
   30-hr cap). **Fix:** new `wizardSubmit` edge function verifies a reCAPTCHA v3
   token server-side, then runs the locked-down `submit_wizard_quote` RPC via
   service role (fails closed on missing/low-score token, open only if Google's
   siteverify is unreachable). QuoteRequest loads reCAPTCHA + passes a token.
   Verified live (no token → 400, bad token → 403, no insert).

## MEDIUM TIER — FIXED & DEPLOYED (2026-06-20)
- **M1 inviteBroker role allowlist.** `adminAction` now rejects any invitee role
  outside {broker, employee, manager} — a shop owner can no longer mint an `admin`.
- **M2 wizard shop-existence guard.** `submit_wizard_quote` now raises
  `unknown shop` unless the shop_owner exists in `shops` (mig 20260710020000).
  Verified live: unknown shop rejected, real shop still works.
- **M3 stripeWebhook escaping.** HTML-escape `customer_name`/`shopName`/etc. in
  payment emails + `escapeQbStringLiteral` on the QB invoice query.
- **M4 server-side payment amount.** `createSession` ignores client
  `lineItems`/`unit_amount` and computes the charge from the saved quote
  (`client_total`/`total`, deposit % from customer record). No more $1-for-$600.
- **M5 SVG stored-XSS.** Artwork bucket now enforces `allowed_mime_types`
  (image/svg+xml excluded) + 25 MB `file_size_limit` at the STORAGE layer
  (mig 20260710030000) — verified: anon SVG upload → 415 invalid_mime_type.
  SVG also removed from client picker/accept attrs.
- **M6 CSP.** Enforced `object-src 'none'; base-uri 'self'` + frame-ancestors;
  full `script-src`/`connect-src`/etc. staged as `Content-Security-Policy-Report-Only`
  for a soak before enforcing (can't safely enforce an unvalidated script-src on
  a live app). Wizard route keeps `frame-ancestors *`. Verified live on www.
- **M7 anon email rate limit.** New `check_anon_email_rate` RPC + table
  (mig 20260710040000); anon `sendQuoteEmail` capped at 10/hr per quote (429
  past that). Verified the counter trips.
- **M8 MFA log hygiene.** Dev-fallback log lines no longer print the sign-in
  code / recovery URL.

### ⚠️ DISCOVERED DURING M2 — migration drift (needs decision)
`submit_wizard_quote` migrations 20260606170000 (bot guards: honeypot + dwell +
30/hr cap) and 20260621020000 (customer autolink) are RECORDED as applied in
`schema_migrations` but their code is NOT live — a later out-of-order
`CREATE OR REPLACE` reverted the function body. So in production the wizard has
had **no honeypot/dwell/rate-limit and no customer-autolink** despite the files.
The new reCAPTCHA gate (H5) is now the real bot protection, so this isn't an open
hole — but the bot guards (defense-in-depth) and the autolink FEATURE are silently
absent. M2 only added the shop-existence guard to the live body (no behavior
change). DECISION NEEDED: re-apply the intended 20260621020000 body to restore
bot guards + autolink (it starts creating customer rows again — a behavior change).

## REMAINING (LOW/INFO — recommended, not urgent)
- message recipients can overwrite fields; Gmail OAuth state has no TTL; CSV
  formula injection in PO export; getOrder ships broker totals; `billingWebhook`
  uses sync `constructEvent`; finish the CSP soak → enforce `script-src`.
- **OPERATIONAL:** keep the service-role key out of any `.env*` file the Vite
  build reads.
- **PROCESS:** the migration drift above means "recorded as applied" ≠ "live."
  Worth a one-time reconcile pass diffing every `CREATE OR REPLACE FUNCTION`
  migration against `pg_get_functiondef` in prod.

## VERIFIED-STRONG (no action needed)
profile_secrets server-only (legacy secret columns dropped); all 3 webhooks
verify signatures + fail closed + idempotent; QB tenant scoping + amounts-from-QB;
constant-time public_token gate; anon storage enumeration closed; MFA hashed
codes + rate limits; security headers (HSTS/nosniff/referrer/frame); subscription
gating server-side; billing self-heal can't grant another user a plan.
