# SanMar integration — map & status (`feat/sanmar-integration`)

_Do not merge until Joe has thoroughly tested. This doc maps what's done, what's
left, and the one hard external blocker on ordering._

## TL;DR

- **Product data + pricing lookup is DONE and green** (60 unit tests pass). SanMar
  styles enrich in quotes and the wizard just like S&S / AS Colour.
- **Live inventory** (per-size stock) and **ordering (PO submission)** are NOT built.
- **Ordering is blocked on a SanMar onboarding step you haven't done yet** — SanMar
  provisions *separate test PO credentials* only after you request PO onboarding, and
  the exact PO field spec lives in a PDF (`SanMar-Purchase-Order-Integration-Guide-24.3.pdf`).
  I will not guess those fields or ship an untested real-money order path.

## SanMar API basics (confirmed from `_shared/sanmar.ts` + the onboarding emails)

- **SOAP/XML only** — no REST. Prod base `https://ws.sanmar.com:8080/SanMarWebService`,
  test base `https://test-ws.sanmar.com:8080/SanMarWebService` (gated by `SANMAR_USE_TEST=1`).
- **Auth** = `sanMarCustomerNumber` + `sanMarUserName` + `sanMarUserPassword` in the SOAP body
  (no OAuth/token). Customer number **198063** (Biota LLC). Per-shop creds stored on
  `profiles` (migration `20260702000000_sanmar_profile_secrets.sql`), platform env fallback.
- **Integration Agreement is signed** (Adobe Sign, 2026-07-02). Product-data API access is live.

## What's DONE (on this branch)

| Area | File(s) | Status |
|------|---------|--------|
| SOAP transport + XML parse | `supabase/functions/_shared/sanmar.ts` | ✅ |
| Product Info service (`getProductInfoByStyleColorSize`) | `sanmar.ts` | ✅ |
| Pricing service (`getPricing`, uses shop's `myPrice`) | `sanmar.ts` | ✅ |
| Style lookup edge function | `supabase/functions/smLookupStyle/index.ts` | ✅ |
| Per-shop creds (UI + secrets) | `SupplierKeysSection.jsx`, `profileSecrets`, migration | ✅ |
| Wizard/quote enrichment + multi-supplier choice | `enrichStyle.js`, `LineItemEditor.jsx`, `WizardConfigEditor.jsx` | ✅ |
| Unit tests | `sanmarLogic.test.js`, `enrichStyle.test.js`, `buildBrandOptions.test.js` | ✅ 60 pass |

The earlier CI failure (commit `5d96568`) was fixed by the revert `5dfa70e` — the
SanMar suites are green now.

## What's LEFT

### 1. Live inventory (medium effort, not blocked)
`buildMatchFromEntries` sets `sizeQuantities: {}` — a TODO for the **SanMar Product
Inventory Service** (`getInventoryQtyForStyleColorSize`-style call). Mirrors
`acGetInventory`. Can be built now against the product-data creds. Adds real-time
per-size stock to the colors[] the UI already renders.

### 2. Ordering / PO submission (the "more to consider" part — BLOCKED)

**External blocker (only Joe can clear):** SanMar's own words —
> "Once you have successfully made API calls for product data and wish to begin
> development of PO submittal, please reach out to us again… We will be happy to
> provision **Test account credentials** at that time."

So before ordering can be built and tested:
1. Confirm product-data calls succeed with the live creds.
2. Email `sanmarintegrations@sanmar.com` to request **PO submission onboarding** →
   receive **test PO credentials** + the test PO endpoint.
3. Then implement against `test-ws.sanmar.com` using those test creds.

**Planned architecture** (`smPlaceOrder`, mirroring `ssPlaceOrder`/`acPlaceOrder`):

- New edge function `supabase/functions/smPlaceOrder/index.ts`:
  - Bearer-auth the user → load profile → `requireActiveSubscription`.
  - **Idempotency is mandatory** (`claimSupplierOrder`/`finishSupplierOrder`, supplier
    `"SanMar"`) — same as S&S; PO submission spends real money, never place twice.
  - Input contract (align with `ssPlaceOrder`):
    `{ poNumber, shipTo{name,address1,address2,city,state,zip,country,phone,email},
       lines[{ style, catalogColor, size, inventoryKey, qty }], warehouse,
       shippingMethod, dropship, residential, testOrder, idempotencyKey }`.
  - Build the PO **SOAP envelope** in `sanmar.ts` (`buildPurchaseOrderEnvelope`) from the
    PO Integration Guide — exact operation/field names TBD from the PDF (do NOT guess).
  - POST via `smSoapCall`, parse the PO acknowledgement (SanMar SO number), record outcome.

**SanMar-specific ordering considerations to nail down (from the PO PDF):**

- **Line keys:** SanMar orders by `inventoryKey` / `uniqueKey` (+ `catalogColor`), which the
  product-info parser already captures — cart `style+color+size` must resolve to those.
- **Warehouse / distribution center:** SanMar has multiple DCs; **DC-NV (Sparks, NV)** is
  nearest to Reno and is what Biota already ships from. Decide: pin to a DC, or let SanMar
  auto-route. Warehouse is a per-line/per-order field like S&S's `Warehouse`.
- **Dropship vs. bulk:** SanMar supports shipping to the end customer (dropship) or to the
  shop (bulk). Dropship carries **sales-tax / resale-certificate** implications (SanMar has
  emailed about this) — surface a clear flag; don't auto-dropship.
- **Shipping method** + residential flag.
- **PO number** handling + duplicate-PO behavior on SanMar's side.
- **Order acknowledgement / status:** SanMar returns an SO number and sends email
  confirmations/ship acks; a later `smGetOrderStatus` can mirror `acGetOrder`.

### 3. Static-IP allow-list (open question — confirm from PDF/SanMar)

SanMar emailed about **IP allow-list updates** (2026-07-09), and the app's old copy said
SanMar needs "static-IP whitelisting." **Supabase edge functions have dynamic egress IPs.**
Before relying on API calls in production, confirm with SanMar whether the **Web Services API**
(vs. FTP) requires the *caller's* IP to be allow-listed. If it does, we need a static-egress
path (e.g. a fixed-IP proxy) for `smLookupStyle`/`smPlaceOrder`. **This could affect product
lookup too, not just ordering — verify early.**

## Remaining task checklist

- [ ] Joe: verify product-data lookups succeed with live creds (smoke `smLookupStyle`).
- [ ] Joe: request SanMar **PO onboarding** → obtain **test PO credentials** + test endpoint.
- [ ] Joe/SanMar: confirm whether the **API requires IP allow-listing** (static egress?).
- [ ] Build `smGetInventory` (live stock) — not blocked; mirrors `acGetInventory`.
- [ ] Read `SanMar-Purchase-Order-Integration-Guide-24.3.pdf` → add `buildPurchaseOrderEnvelope`
      + parser to `sanmar.ts` with exact fields.
- [ ] Build `smPlaceOrder` edge function (auth + subscription + idempotency + SOAP PO).
- [ ] Wire the shop-floor "order goods" UI to `smPlaceOrder` (warehouse/dropship options).
- [ ] Unit tests for PO envelope build + line resolution + ack parse.
- [ ] Test end-to-end against `test-ws.sanmar.com` with test PO creds (never prod for testing).
- [ ] `config.toml` entries for `smPlaceOrder`/`smGetInventory` (`verify_jwt = false`), smoke script.
- [ ] Keep `npm test` green; **do not merge** until Joe signs off after live testing.
