# QuickBooks App Store — submission kit

Everything for the Intuit Developer Dashboard session, in paste order.
Copy was drafted 2026-06-05 and re-verified 2026-08-06 (endpoints checked
against the live repo; pricing/trial claims current — trial is cardless
as of migration 20260926). Target: **publish the unlisted/public listing**
so InkTracker appears in QB App Store search. No connection cap applies
to unpublished apps, so this is discoverability work, not unblocking work
(see memory: QB Partner Program deferred).

## Pre-submission checklist

- [x] Disconnect endpoint live — `api/qb-disconnect.js` → `https://inktracker.app/api/qb-disconnect`
- [x] OAuth callback on production URLs (`qb-callback.js`)
- [x] Legal pages audited (2026-06-05, no changes needed)
- [ ] Joe: production keys section of the dashboard shows prod Client ID (not sandbox)
- [ ] Joe: screenshots — reuse the iOS App Store set on Desktop (`InkTracker-AppStore-Screenshots`) where aspect ratios allow; Intuit wants app-in-action shots, the QB badge/Events timeline shot is the strongest
- [ ] Joe: security questionnaire (Intuit's OWASP-style form — answer from the security audit doc, `docs/` + memory `project_inktracker_security_audit_2026_07`)
- [ ] Reviewer test account: demo@inktracker.app (same account Apple review uses; password in your password manager). Connect it to a QB sandbox company before submitting so the reviewer lands on a working sync.

## Tagline (58 chars; limit 80)

```
Quote-to-cash for print shops with native QuickBooks sync.
```

Punchier alternate (52): `Print-shop ops with QuickBooks invoicing built in.`

## Description (~470 words; soft cap 500)

```
InkTracker is the operations platform built for screen printers, embroiderers, and DTG/DTF shops. From the moment a customer submits a quote request to the moment they pay, every step lives in one place — and every dollar lands in QuickBooks automatically.

**A complete quote-to-cash workflow**

Most shops stitch together five tools to run their order pipeline: a quote builder, a spreadsheet for pricing, an inbox for customer approval, QuickBooks for invoicing, and a whiteboard for production. InkTracker replaces all of them with one workflow:

1. Customer submits a request through your branded quote wizard (or you build the quote yourself)
2. InkTracker prices the job using your tiered color-count and quantity rates, plus per-technique pricing for embroidery, DTG, DTF, and any custom decoration method you offer
3. You send a quote email with a one-click approve-and-pay link
4. Approval triggers an invoice in QuickBooks, with a payment link the customer uses to pay by card or ACH
5. When the customer pays, InkTracker auto-converts the quote into a production order, sets the job on your shop's production calendar, and marks everything paid — no manual data entry, no QuickBooks tab-switching

**Built for the way print shops actually work**

Tiered pricing by color count, quantity, and print location. Variable rush surcharges by days-out. Customer-saved imprints. Multi-day press scheduling with station counts. Linked-artwork reuse across line items so you don't pay setup twice. Broker pricing with separate markup tiers. Customer self-service mockups. Saved garments per customer.

**How the QuickBooks integration is wired**

- **Invoices.** Every quote you send creates a matching QuickBooks invoice — same line items, same customer record, same totals.
- **Payments.** Customers pay through QuickBooks Payments. Card and bank details stay inside QuickBooks; InkTracker never sees them. Your shop is the merchant of record.
- **Webhooks.** When QuickBooks confirms a payment, InkTracker marks the quote paid and converts it to a production order — without you touching either app.
- **Drift detection.** A nightly reconciliation cross-checks every linked invoice between QuickBooks and InkTracker. If anything has drifted, you get a notification with a link to the quote.
- **Customer reconciliation.** If you merge customers in QuickBooks, InkTracker detects it on next sync and offers a one-click "finish merge in InkTracker" so your local notes, quotes, and saved imprints follow the survivor record.
- **Per-shop audit log.** Every QuickBooks action — create invoice, send payment link, receive paid webhook, nightly reconciliation — is recorded in a per-quote event log. Open any quote → QuickBooks → Events to see the full timeline.

**Built and supported by a real shop**

InkTracker is built by Biota MFG, a working screen-print business in Reno, Nevada. We use it ourselves every day. Pricing is straightforward: a single $99/month plan with a 14-day free trial — no setup fees, no per-user upcharge.
```

## Dashboard field map

| Field | Value |
|---|---|
| Privacy policy URL | `https://inktracker.app/privacy` |
| EULA / Terms URL | `https://inktracker.app/terms` |
| Support email | `support@inktracker.app` |
| Support URL | `https://inktracker.app/support` |
| Host domain | `inktracker.app` |
| Launch URL | `https://inktracker.app/` |
| Disconnect URL | `https://inktracker.app/api/qb-disconnect` |
| Connect/Reconnect URL | `https://inktracker.app/Account` |
| Scopes | `com.intuit.quickbooks.accounting`, `com.intuit.quickbooks.payment` — drop anything else |
| Geolocation | US |
| Categories | Operations Management + an industry tag |
| Accepted connections | Simple Start, Essentials, Plus, Advanced |

## Deliberate omissions in the copy

No AI claims, no SOC 2 claims, no multi-currency/international, no
"real-time," no inventory-as-stocking. Don't add them during the
dashboard session — each invites reviewer scrutiny we can't back yet.

## If Intuit asks for more

- "Who it's for" section: split screen printers / embroidery / broker
  resellers, ~100–150 words.
- Webhook subscription must be configured in the Intuit portal for the
  payments story to demo cleanly (memory: `project_inktracker_qb_webhook_config`
  — code is ready, subscription was never created). Do this BEFORE the
  reviewer connects.
