# AS Colour Integration

This wires the AS Colour NZ public API into inktracker, mirroring the existing S&S
Activewear integration pattern (Supabase edge functions + a thin client wrapper).

## What's included

Edge functions in `supabase/functions/`:

| Function          | Endpoint hit                                      | Auth                              |
| ----------------- | ------------------------------------------------- | --------------------------------- |
| `acSearchCatalog` | `GET /v1/catalog/products/`                       | Subscription-Key                  |
| `acLookupStyle`   | `GET /v1/catalog/products/{styleCode}` + variants + images + inventory | Subscription-Key |
| `acGetInventory`  | `GET /v1/inventory/items` (full / SKU / wildcard) | Subscription-Key                  |
| `acGetPriceList`  | `POST /v1/api/authentication` then `GET /v1/catalog/pricelist` | Subscription-Key + Bearer |

Shared helpers live in `supabase/functions/_shared/ascolour.ts` (auth, fetch
wrapper with timeout/logging, normalisers, in-memory token cache).

Front-end wrapper: `src/api/suppliers.js` exposes a supplier-agnostic API
(`searchCatalog`, `lookupStyle`, `getInventory`, `getPricelist`, `placeOrder`)
so pages don't have to hardcode edge-function names.

UI changes:

- `src/pages/Catalog.jsx` now has an S&S / AS Colour toggle in the header. The
  rest of the catalog UX is unchanged — both suppliers return the same shape
  (`{ products, total, page, limit }`).

## ⚠️ Order placement is NOT supported

The published AS Colour API (per the supplied PDF) is **read-only** — there is
no `POST /orders` endpoint. The supplier wrapper deliberately throws on
`placeOrder("AS Colour", …)` and the front-end should hide the order CTA when
`supplier === "AS Colour"`.

If/when AS Colour publishes an order endpoint, add `acPlaceOrder/index.ts`
modeled on `ssPlaceOrder/index.ts` and add it to the `FN[SUPPLIERS.AC]` map in
`src/api/suppliers.js`. Until then, blank-garment orders to AS Colour need to
be placed directly through their portal.

Email `api@ascolour.com` to ask whether they have an order API in beta.

## Setup

1. **Get a subscription key** — email `api@ascolour.com` per the PDF. They
   provision a key tied to your trade account.

2. **Set Supabase secrets** (these are read by the edge functions via
   `Deno.env.get`):

   ```bash
   supabase secrets set \
     ASCOLOUR_SUBSCRIPTION_KEY=<your-key> \
     ASCOLOUR_EMAIL=<your-website-login-email> \
     ASCOLOUR_PASSWORD=<your-website-login-password>
   ```

   The email/password pair is only needed for `acGetPriceList` (the pricelist
   endpoint requires a Bearer token from `POST /v1/api/authentication`). The
   other three functions only need the subscription key.

3. **Deploy the functions:**

   ```bash
   supabase functions deploy acSearchCatalog
   supabase functions deploy acLookupStyle
   supabase functions deploy acGetInventory
   supabase functions deploy acGetPriceList
   ```

4. **Local smoke test** (after deploy):

   ```bash
   curl -X POST "$VITE_SUPABASE_URL/functions/v1/acSearchCatalog" \
     -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
     -H "Content-Type: application/json" \
     -d '{"query":"5050"}'
   ```

5. Open the Catalog page in inktracker and click **AS Colour** in the toggle.

## Known caveats / things to watch

- **No native search param.** AS Colour's `/catalog/products/` returns the full
  catalog; `acSearchCatalog` filters in-memory by `styleCode` / `title` /
  `category`. The catalog isn't huge so this is fine, but if it grows we should
  cache the catalog server-side and refresh on a schedule.
- **Field name aliases.** The PDF only shows endpoint URLs, not response
  schemas. The normalisers in `_shared/ascolour.ts` accept several common
  camelCase variants (`colourName`/`colorName`, `styleCode`/`code`, etc.). Once
  you've made real calls, tighten the normalisers to the actual response shape.
- **Bearer token caching.** `getAcBearerToken()` caches the token for 50
  minutes in the function's memory. If a function instance is cold-started it
  will re-auth, which is fine. If you see spurious 401s on `acGetPriceList`,
  retry with `{ refreshAuth: true }`.
- **NZ vs US base URL.** The PDF uses `api.ascolour.co.nz`. If AS Colour ever
  spins up a US or AU host, change `AC_BASE` in `_shared/ascolour.ts`.
- **CORS.** All four functions emit the same `Access-Control-Allow-Origin: *`
  header that the existing `ss*` functions use.

## File map

```
supabase/functions/
  _shared/ascolour.ts          ← shared helpers, auth, normalisers
  acSearchCatalog/index.ts     ← list/search products
  acLookupStyle/index.ts       ← single style + variants + images + inventory
  acGetInventory/index.ts      ← /inventory/items (full | sku | wildcard)
  acGetPriceList/index.ts      ← /catalog/pricelist (auths first)

src/api/suppliers.js           ← unified front-end wrapper
src/pages/Catalog.jsx          ← supplier toggle in header
```
