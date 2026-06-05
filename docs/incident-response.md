# InkTracker Incident Response Plan

**Owner:** Joe Grennan (Founder)
**Last reviewed:** 2026-05-31
**Audience:** Internal — referenced when filling out vendor security questionnaires (QuickBooks App Store, prospects asking for IR docs), and when an incident actually happens.

This is a one-page plan, on purpose. Most incidents at our stage are
"Vercel is down" or "a shop owner lost access" — overengineering the
runbook makes us slower, not safer. The goal is to know what to do
in the first 30 minutes of a real incident.

---

## What counts as an incident

Tier the severity so we don't run the same playbook for a Vercel hiccup as we would for a breach.

| Severity | Examples | Notify |
|---|---|---|
| **SEV-1 — Critical** | Confirmed unauthorized access to customer data. Production database compromised. Customer-payment data exposed. QuickBooks tokens leaked. | Affected customers within 72 hours by email. |
| **SEV-2 — Major** | Production down >30 min. Payments not processing. Data integrity bug actively duplicating or deleting customer records. | Status update at status URL within 1 hour. |
| **SEV-3 — Minor** | A single shop sees stale data. A non-critical edge function returning 500s. UI bug blocking one workflow. | Email response within 1 business day. |

If you can't classify it confidently, treat it as one tier higher.

---

## First 30 minutes (SEV-1 or SEV-2)

1. **Acknowledge to yourself this is real** — don't second-guess for an hour.
2. **Stop the bleeding before diagnosing.** Acceptable shortcuts:
   - **Vercel rollback** to the last green deploy: `vercel rollback`. Always reversible.
   - **Supabase migration revert**: requires a counter-migration; only do this if the schema change is the cause.
   - **Rotate the leaked secret** (see the rotation runbook below) and force a re-deploy with the new value.
   - **Disable the affected edge function** by setting `verify_jwt = true` in `supabase/config.toml` so unauthenticated callers can't trigger it; redeploy.
3. **Write down what you did, with timestamps.** A plain-text log in a file beats forensic guesswork later. Format:
   ```
   23:04 UTC — Noticed elevated 500s on qbSync via Vercel logs
   23:07 UTC — Rolled back to dpl_xxxxxx — errors stopped
   23:14 UTC — Identified root cause: handler threw on null currentUser
   ```
4. **Decide whether to notify.** SEV-1 always notifies. SEV-2 notifies if the disruption was visible to customers.

---

## Customer notification (SEV-1)

Send this within 72 hours of confirming scope. The 72-hour window is your commitment in the Privacy Policy (Section 4a) and what GDPR effectively requires.

Template (replace square brackets):

> **Subject:** Security incident affecting your InkTracker account
>
> Hi [shop owner name],
>
> On [date], InkTracker became aware of [brief, factual description of what happened]. Based on our investigation, your account was [affected / potentially affected / not affected, but we're notifying you out of caution]. The specific data that may have been accessed includes [list categories — e.g., quote totals, customer emails, QuickBooks invoice metadata. Be specific. Don't say "various account information."].
>
> What we have done:
> - [List remediation actions — rotated secrets, patched the bug, reviewed logs]
>
> What you should do:
> - [Concrete steps. Always include: revoke InkTracker's access in QuickBooks (Settings → Apps) if QB was in scope. Always include: change your InkTracker password. If you reuse passwords, change those elsewhere too.]
>
> What we believe was NOT accessed:
> - [Be specific about scope limits — payment instruments, etc.]
>
> If you have questions, reply to this email. Our security@inktracker.app inbox is monitored.
>
> — Joe Grennan
> Founder, InkTracker

---

## Secret rotation runbook

When a secret is compromised (CRON_SECRET, QB client secret, Supabase service-role key, Stripe webhook secret):

1. **Generate a new value** — `openssl rand -hex 32` for arbitrary secrets, or rotate via the third-party UI for OAuth client secrets.
2. **Set it on every consumer side BEFORE invalidating the old one** — order matters to avoid downtime.

| Secret | Where to set | What breaks if old isn't invalidated |
|---|---|---|
| CRON_SECRET | Vercel env (`vercel env add`) + Supabase secret (`npx supabase secrets set`) | Reconcile cron silently no-ops |
| QB_CLIENT_SECRET | Intuit Developer Portal → Production → Keys + Supabase secret | Token refresh fails after current access token expires (~1 hr) |
| QB_WEBHOOK_VERIFIER_TOKEN | Intuit Developer Portal → Webhook config + Supabase secret | Inbound webhooks return 401 to Intuit |
| SUPABASE_SERVICE_ROLE_KEY | Supabase Dashboard → API → Reset + every place we use it (Vercel, edge functions) | Everything that uses service role: edge functions, migrations, internal scripts |
| STRIPE_WEBHOOK_SECRET | Stripe Dashboard → Webhooks + Supabase secret | Stripe webhooks return 401 |
| RESEND_API_KEY | Resend Dashboard + Supabase secret | Outbound quote / invoice emails fail |

3. **Invalidate the old value** in the issuing system (e.g., Intuit Dev Portal "Regenerate" button).
4. **Redeploy** all affected edge functions (`npx supabase functions deploy <name>`) and Vercel (`npx vercel --prod`).
5. **Verify with a smoke** — try the actual flow that uses the secret end-to-end.

---

## Who has access to what (and what to do if any of them leak)

Treat this as the canonical "blast radius" map.

| System | Who has access | If compromised |
|---|---|---|
| Vercel project | Joe only | Rotate Vercel API token, revoke all teammates, audit deploy history |
| Supabase project (`skmltfbibaqcjddmeqvi`) | Joe only | Reset all DB credentials, rotate service-role key, force-disconnect all sessions |
| Intuit Developer Portal | Joe only | Revoke the app, generate new client_secret + verifier_token, force re-OAuth on every shop |
| Stripe account | Joe only | Rotate API keys, rotate webhook secret, review recent payouts |
| GitHub (if applicable) | n/a (no repo today) | — |
| Production database direct (psql/Studio) | Joe via Supabase Dashboard | Rotate service-role key (effectively the DB-superuser equivalent) |

---

## Things we explicitly DON'T have yet (be honest about this)

If a vendor questionnaire asks, the honest answer is "no — here's our plan":

- **24/7 on-call rotation** — single founder, no on-call rotation. SEV-1 acknowledged within business hours; outside business hours, response is best-effort.
- **SOC 2 / ISO 27001 audit** — none yet. We're a SOC 2-track candidate but have not been audited.
- **Tabletop exercises** — not yet. We plan to run one annually starting 2026.
- **Penetration test** — not yet. Will engage a third party once revenue justifies it (~$10–20k).
- **Bug bounty** — public address (security@inktracker.app) but no monetary bounty.
- **Cyber insurance** — not yet.

---

## Post-incident review

Within 7 days of any SEV-1 or SEV-2:

1. Write a public-facing post-mortem on the changelog (no customer data, but be honest about cause + fix). The credibility you build with transparent post-mortems compounds.
2. File one concrete preventive fix in the codebase. "We added a test." "We added an alert." "We rotated the threshold." Vague resolutions don't count.
3. Update this document with any new tier criteria, new secrets, or new playbook steps the incident revealed.

---

## Quick reference

```
support@inktracker.app    — customer issues
security@inktracker.app   — security reports
status.inktracker.app     — public status page (TODO — see Security Roadmap memory)
```

Deploy commands during an incident:
```bash
vercel rollback                                          # revert frontend to last green
npx supabase functions deploy <name> --no-verify-jwt    # ship an edge function fix
npx supabase db push --include-all --linked --yes       # ship a counter-migration
```
