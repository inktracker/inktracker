// NorCal (Shopify) cart permalink — the client-side "submit to NorCal" link.
//
// Verified live against norcalsps.com: /cart/{variantId}:{qty},{variantId}:{qty}
// 302s straight into a pre-filled NorCal checkout, so submitting an order is
// just opening this URL — no API key, nothing to type again.
//
// (There's a mirror of this in supabase/functions/_shared/norcal.ts for any
// server-side use; this is the copy the browser runs.)

export const NORCAL_STORE_URL = "https://norcalsps.com";

// Build the permalink from order lines ({ variantId, qty }). Skips lines with a
// non-numeric variant id or non-positive qty; returns null when nothing is
// orderable (caller falls back to opening the store). refParams become the
// query string (e.g. { utm_source: "inktracker" }) for basic attribution.
export function norcalCartPermalink(lines, refParams = {}) {
  const parts = (Array.isArray(lines) ? lines : [])
    .map((l) => ({
      id: String(l?.variantId ?? "").trim(),
      qty: Math.max(0, Math.floor(Number(l?.qty) || 0)),
    }))
    .filter((l) => /^\d+$/.test(l.id) && l.qty > 0)
    .map((l) => `${l.id}:${l.qty}`);
  if (parts.length === 0) return null;
  const qs = new URLSearchParams(refParams).toString();
  return `${NORCAL_STORE_URL}/cart/${parts.join(",")}${qs ? `?${qs}` : ""}`;
}
