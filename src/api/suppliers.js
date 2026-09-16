// Supplier abstraction — lets pages call one function and switch between
// S&S Activewear and AS Colour without scattering edge-function names through
// the UI.
//
// Each method accepts the same shape regardless of supplier. AS Colour uses
// `styleCode` rather than S&S's `styleNumber`, but the wrapper hides that.

import { supabase } from "@/api/supabaseClient";

export const SUPPLIERS = {
  SS: "S&S Activewear",
  AC: "AS Colour",
  SANMAR: "SanMar",
};

const FN = {
  [SUPPLIERS.SS]: {
    search: "ssSearchCatalog",
    lookup: "ssLookupStyle",
    placeOrder: "ssPlaceOrder",
  },
  [SUPPLIERS.AC]: {
    search: "acSearchCatalog",
    lookup: "acLookupStyle",
    inventory: "acGetInventory",
    pricelist: "acGetPriceList",
    placeOrder: "acPlaceOrder",
    shippingMethods: "acGetShippingMethods",
  },
  // SanMar has no keyword-search API — exact style-number lookup only.
  // smPlaceOrder is gated TWICE: the platform SANMAR_PO_ENABLED secret, and
  // per shop by SanMar's PO-integration onboarding (Account → Suppliers →
  // SanMar ordering setup, smOnboarding) reaching 'live'. Until both, it
  // returns { needsManual: true } and callers keep the "place directly, then
  // Mark submitted" flow. See supabase/functions/smPlaceOrder + _shared/sanmar.ts.
  [SUPPLIERS.SANMAR]: {
    lookup: "smLookupStyle",
    placeOrder: "smPlaceOrder",
  },
};

async function invoke(fn, body) {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    // FunctionsHttpError on a non-2xx puts the raw Response on
    // error.context. Read its body, surface what the edge function
    // actually returned. Without this the UI shows the wrapper's
    // generic "Edge Function returned a non-2xx status code" and the
    // real reason (auth gate, AS Colour rejection, validation error)
    // stays invisible.
    //
    // Defensive shape check: depending on supabase-js version,
    // error.context could be the Response itself or { response }.
    const ctxRes = (error?.context && typeof error.context.text === "function")
      ? error.context
      : error?.context?.response;
    if (ctxRes && typeof ctxRes.text === "function") {
      let body;
      try { body = await ctxRes.text(); } catch { /* response already consumed */ }
      if (body) {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch { /* not JSON */ }
        // Build the most useful message we can. Edge fn responses are
        // {error, details}; show BOTH when present so a wrapper string
        // like "AS Colour order failed (400)" doesn't hide the actual
        // supplier rejection (e.g. AS Colour's
        // {errors:[{field:"sku", message:"invalid"}]}).
        let msg;
        if (parsed?.error && parsed?.details !== undefined) {
          const detailStr = typeof parsed.details === "string"
            ? parsed.details
            : JSON.stringify(parsed.details);
          msg = `${parsed.error}\n${detailStr}`;
        } else {
          msg = parsed?.error || parsed?.message || body;
        }
        const wrapped = new Error(msg);
        wrapped.status = ctxRes.status;
        throw wrapped;
      }
    }
    throw error;
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function lookupStyle(supplier, { styleNumber, styleCode, ...rest } = {}) {
  const fn = FN[supplier]?.lookup;
  if (!fn) throw new Error(`No lookup function for supplier ${supplier}`);
  // AS Colour's edge fn expects `styleCode`; S&S expects `styleNumber`.
  if (supplier === SUPPLIERS.AC) {
    return invoke(fn, { styleCode: styleCode ?? styleNumber, ...rest });
  }
  return invoke(fn, { styleNumber: styleNumber ?? styleCode, ...rest });
}

// Standard shipping-method options for suppliers that don't expose a live
// methods endpoint (AS Colour does — acGetShippingMethods; S&S and SanMar
// don't). These are the common carrier service levels each accepts on an
// order; the operator can still keep any previously-saved value. If a supplier
// later rejects a method the shop can pick another — the order response says so.
const FALLBACK_SHIPPING_METHODS = {
  [SUPPLIERS.SS]: ["Ground", "3 Day Select", "2nd Day Air", "Next Day Air"],
  [SUPPLIERS.SANMAR]: ["UPS Ground", "UPS 3 Day Select", "UPS 2nd Day Air", "UPS Next Day Air"],
};

export async function getShippingMethods(supplier) {
  const fn = FN[supplier]?.shippingMethods;
  if (!fn) return { methods: FALLBACK_SHIPPING_METHODS[supplier] || [] };
  const data = await invoke(fn, {});
  return { methods: Array.isArray(data?.methods) ? data.methods : [] };
}

export async function placeOrder(supplier, payload) {
  const fn = FN[supplier]?.placeOrder;
  if (!fn) {
    throw new Error(
      `${supplier} does not support order placement via API. Place the order directly with the supplier.`,
    );
  }
  return invoke(fn, payload);
}
