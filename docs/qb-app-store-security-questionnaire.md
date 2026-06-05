# QuickBooks App Store — Security Questionnaire Draft Answers

**Purpose:** Pre-written, honest answers to the questions Intuit asks during the App Store security review. Use these as starting points — review and edit each before submitting, especially numbers that may have shifted (e.g., user counts, data volumes).

**Tone guidance:** Answer concisely. Don't volunteer weaknesses you weren't asked about, but don't paper over them either. Intuit's reviewers prefer "we don't have X yet, here's our plan" over silence on a gap.

**Status legend:**
- ✅ Verified true in the codebase as of 2026-05-31
- ⚠️ Soft answer — be ready for follow-up
- ❌ We don't have this — answer honestly

---

## Section 1 — Company & app overview

**Q. Briefly describe your application.**

> InkTracker is a print-shop management SaaS for small US screen-print and embroidery shops. We integrate with QuickBooks Online to issue invoices and receive payments on behalf of our customers (the shop owners). We also integrate with garment suppliers (S&S Activewear, AS Colour) for product pricing and Shopify for inventory sync. We are a single-founder operation based in Reno, Nevada, USA. Subscription: $99/month per shop.

**Q. Who is your target customer for this QuickBooks integration?**

> Small US-based print shops, typically 1–5 employees, that already use QuickBooks Online for accounting and want their quote-to-invoice-to-payment flow automated. Our typical shop has $200K–$1M in annual revenue.

**Q. Estimated number of QuickBooks-connected users?**

> Under 10 shops currently connected to QuickBooks. We are in early-stage onboarding for our beta/founding shop cohort.

**Q. Estimated annual transaction volume through your QuickBooks integration?**

> Under 100 invoices created via the integration in the past 12 months. Early-stage volume, reflective of our beta cohort.

---

## Section 2 — Authentication

**Q. How do users authenticate to your application?** ✅

> Email + password authentication via Supabase Auth. Email verification is required before sign-in. Passwords are hashed by Supabase using bcrypt with cost factor 10. We never see or store user passwords in plaintext. We also offer magic-link sign-in (single-use OTP delivered to email) and password-reset by email.

**Q. Do you support multi-factor authentication?** ❌

> Not yet. MFA is on our 2026 roadmap (target: Q3 2026) and will be opt-in initially via Supabase Auth's TOTP support. We do not currently market the absence as a gap to customers because for our target customer (small print shops) the friction trade-off was material; we will revisit when we have enterprise prospects.

**Q. How are user sessions managed?** ✅

> JWT-based sessions via Supabase Auth. Tokens are stored in HTTP-only-equivalent secure browser storage by the Supabase JS client. Refresh tokens rotate on every refresh. Sessions expire after one hour of inactivity (idle timeout) or seven days absolute.

**Q. How are passwords enforced?** ✅

> Minimum 6 characters at signup (Supabase Auth default). Reset flow requires email confirmation and never sends the new password in plaintext.

---

## Section 3 — QuickBooks token storage & access

**Q. Where are QuickBooks access tokens and refresh tokens stored?** ✅

> Tokens are stored in a dedicated PostgreSQL table named `profile_secrets`, encrypted at rest by Supabase using AES-256. The table is locked down with row-level security policies that grant access only to the Supabase service role; no authenticated user query — including the user whose tokens are stored — can read this table. The application's frontend never receives QB tokens; all QB API calls happen server-side from our edge functions.

**Q. How is access to QuickBooks tokens controlled?** ✅

> Three layers:
> 1. Database-level: row-level security grants SELECT/UPDATE on `profile_secrets` to the service role only. The authenticated role and anonymous role are explicitly REVOKED.
> 2. Application-level: only specific edge functions (qbSync, qbWebhook, qbReconcile, qbOAuthCallback) can read the secret. These functions run under Deno and use the service-role key from environment variables.
> 3. Infrastructure-level: the service-role key is stored in Supabase secrets and Vercel environment variables, never checked into source control, and accessible only to the founder.

**Q. Are tokens encrypted at rest?** ✅

> Yes. All Supabase database storage is encrypted at rest with AES-256, including the `profile_secrets` table that holds QuickBooks tokens.

**Q. How long do you retain tokens after a customer disconnects?** ✅

> Zero retention. On Disconnect (Account → QuickBooks → Disconnect), the qb_access_token, qb_refresh_token, qb_realm_id, and qb_token_expires_at fields on the customer's `profile_secrets` row are set to NULL in the same transaction as the user's click. The row itself persists (it holds other unrelated secrets like Shopify tokens) but no QuickBooks state remains.

**Q. Do you log access to tokens?** ⚠️

> We do not have a separate access log for the tokens themselves. We do have a per-shop audit log (`qb_event_log`) for every API call made TO QuickBooks using those tokens, which provides effective accountability: any read of a token is followed by a logged outbound call. Adding a per-secret-read audit log is on our roadmap.

---

## Section 4 — Data handling

**Q. What QuickBooks data do you read?** ✅

> Invoices (full record, including line items, customer ref, balance, payment link), customers (full record), and Payment records (when handling webhooks). We read these via Intuit's REST API v3 query and entity endpoints.

**Q. What QuickBooks data do you write?** ✅

> Customers (create on first quote with a new client), Invoices (create when a shop sends a quote via QuickBooks, update on re-sync), and Payments (record the deposit against an invoice when applicable). Every write is logged in our per-shop audit table.

**Q. Do you cache QuickBooks data, and if so, for how long?** ✅

> We persist a few QuickBooks-derived fields back to our own database for performance: `qb_invoice_id` and `qb_payment_link` are stored on the quote row so the UI doesn't have to round-trip Intuit on every page load. QB-side totals (`qb_total`, `qb_tax_amount`, `qb_subtotal`) are snapshotted at write time for the same reason. We do not persist customer details, line items, or payment instruments from QuickBooks. Our nightly reconciliation cron re-reads each linked invoice's current state from Intuit and surfaces drift to the shop owner via in-app notifications.

**Q. Is customer financial data (card numbers, ACH details, bank info) ever stored by your application?** ✅

> No. Customer payment instruments stay inside QuickBooks Payments at all times. Our integration does not invoke any endpoint that returns card or bank-account data. We surface the QuickBooks-provided payment link to customers, who then enter their payment details directly into Intuit's hosted payment page.

**Q. How is customer data deleted on request?** ⚠️

> Currently a manual process: the shop owner emails support@inktracker.app and we delete their records and disconnect their QuickBooks within one business day. On account cancellation, data is retained for 30 days in read-only state, then permanently deleted. A self-serve "delete my account and all data" button is on our 2026 roadmap.

---

## Section 5 — Multi-tenancy

**Q. How do you isolate one customer's data from another's?** ✅

> Row-level security policies are enforced at the PostgreSQL layer on every table that holds shop-scoped data. The policy filter is `shop_owner = auth.jwt()->>'email'`. No application code or query can return another shop's records; even if our code had a bug, the database rejects the read. The lockdown was applied across all 18 customer-facing tables on 2026-05-01.

**Q. How do you handle the case where a webhook payload could match multiple customers?** ✅

> QuickBooks invoice IDs are scoped to the Intuit realm, not globally unique. Two different shops on InkTracker can each have an invoice with id "1042" in their respective QuickBooks accounts. Every webhook lookup is scoped by BOTH the invoice id AND the shop_owner derived from the webhook's realm-id. This is enforced in a shared helper (`buildPaidInvoiceQuery`) that throws if either parameter is missing. Unit tests pin the contract.

**Q. Has your isolation been independently audited?** ❌

> Not yet. We have unit tests on the tenant-scoping logic and a manual audit performed by the founder during the 2026-05-01 RLS lockdown. A third-party penetration test is on the roadmap once revenue supports it.

---

## Section 6 — Webhook security

**Q. How do you verify QuickBooks webhooks?** ✅

> Every inbound webhook from Intuit is HMAC-SHA256 verified against the verifier token we configured in the Intuit Developer Portal. The comparison is constant-time (`crypto.timingSafeEqual` semantics) to prevent timing-based signature recovery. Webhooks with missing or mismatched signatures return 401 without processing. Verified webhooks return 200 even on internal processing errors so Intuit doesn't enter an exponential backoff retry loop on our intermittent issues.

**Q. How do you handle duplicate webhook deliveries?** ✅

> A dedicated `processed_webhook_events` table tracks the (source, event_id) pair atomically via INSERT-with-conflict-detection. Duplicate deliveries (Intuit retries are explicit at-least-once) short-circuit before side effects fire. Tests pin this behavior.

**Q. What happens if your webhook handler crashes mid-processing?** ✅

> The Intuit-facing response remains 200 (we wrap all internal errors). The crash is captured by Supabase's edge function logs. Our nightly reconciliation cron will re-detect the missed event by re-reading the affected invoice and reconciling the quote state. Operators see the conversion show up overnight with an "overnight reconcile" notification.

---

## Section 7 — Infrastructure

**Q. Where is your application hosted?** ✅

> Frontend: Vercel (US edge regions). Backend: Supabase (PostgreSQL + Edge Functions, AWS us-east-1). Email: Resend. We do not operate any of our own server infrastructure.

**Q. How is data transmitted between components?** ✅

> All traffic uses TLS 1.2 or higher. Vercel and Supabase enforce HTTPS-only. The Strict-Transport-Security header with `preload` is set on inktracker.app. There is no plaintext transmission of customer data at any point.

**Q. Are your provider relationships covered by Business Associate Agreements (BAAs) or Data Processing Agreements (DPAs)?**

> BAAs are not applicable — we do not handle Protected Health Information (PHI).
>
> DPAs: we are currently on the free tier of both Supabase and Vercel, which do not include the standard DPA addendum on lower-tier plans. Signing both providers' DPAs is on our near-term roadmap and will be completed when we move to paid tiers as our shop count grows. We comply with the substance of GDPR/CCPA today through our internal handling practices (described in our Privacy Policy and earlier sections of this questionnaire); the DPAs will formalize that with our subprocessors.

**Q. What is your backup strategy?** ✅

> The Supabase database is backed up daily with point-in-time recovery for the past 7 days. Backups are stored encrypted in a separate AWS region. We have not yet performed a documented restore drill but plan to do so annually starting 2026.

---

## Section 8 — Auditability & forensics

**Q. Can you reconstruct what happened to a specific QuickBooks invoice?** ✅

> Yes, fully. Every QuickBooks API operation we perform writes a row to a per-shop `qb_event_log` table: action (create_invoice / update_invoice / sync_customer / mint_link / webhook_received / reconcile_invoice), status (success/error/skipped/duplicate), request body, response body, idempotency key, duration, and timestamp. Shop owners see this timeline themselves in the Events tab on each quote — they do not need to contact us to investigate "what did InkTracker do?"

**Q. How long do you retain logs?** ⚠️

> qb_event_log rows are retained indefinitely currently. No automated retention/expiry yet. We plan to add a 12-month rolling retention policy in 2026 once volume justifies it. Vercel and Supabase provider-level logs are retained per their respective default policies (typically 30 days for free tier, longer for paid).

**Q. Are administrative actions logged separately?** ❌

> Not yet. We do not have a dedicated admin-action audit log. There is currently only one administrative account (the founder); any administrative database action would be traceable via Supabase's connection logs. A separate admin audit log is on the roadmap if/when we hire additional staff with elevated access.

---

## Section 9 — Incident response

**Q. Do you have a written incident response plan?** ✅

> Yes. Maintained at `docs/incident-response.md` in our source tree. It covers severity tiering, first-30-minute response, customer notification template, secret rotation runbook, and access-control map. We commit to notifying affected customers within 72 hours of confirming a security incident's scope (consistent with GDPR Article 33).

**Q. Do you have a security contact email?** ✅

> security@inktracker.app — monitored. Acknowledgment within 48 hours per our public commitment on inktracker.app/security.

**Q. Have you experienced any security incidents in the past 24 months?**

> No. There have been no security incidents involving unauthorized access, data exposure, or token compromise in InkTracker's operating history.

---

## Section 10 — Compliance & certifications

**Q. Are you SOC 2 audited?** ❌

> Not yet. We are pursuing SOC 2 Type 1 in 2026.

**Q. Are you HIPAA / GDPR / CCPA compliant?**

> We do not handle PHI (no HIPAA scope). For GDPR/CCPA: we comply with the spirit of both (data subject access requests, right to deletion, no sale of data) via the manual support process described in our Privacy Policy. We have not engaged outside counsel for a formal compliance audit.

**Q. Do you participate in any bug bounty programs?** ⚠️

> We accept security disclosures at security@inktracker.app with a 48-hour acknowledgment SLA. We do not currently offer a monetary bounty but publicly credit researchers on their reports with permission.

---

## Final checklist before submitting

- [ ] All [FILL IN] placeholders replaced with current numbers
- [ ] All ⚠️ and ❌ items reviewed — confirm I'm comfortable with each answer
- [ ] Privacy Policy at inktracker.app/privacy reviewed for consistency with these answers
- [ ] Security page at inktracker.app/security reviewed for consistency
- [ ] Support email actively monitored
- [ ] IR plan (docs/incident-response.md) up-to-date
- [ ] Demo video shows: OAuth connect → core action → Disconnect
- [ ] Screenshots include the Events tab to demonstrate auditability claim
- [ ] [If applicable] DPAs signed with Supabase + Vercel
