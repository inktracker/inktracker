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
    // AS Colour's public API has no order-placement endpoint as of this
    // integration. `placeOrder` intentionally omitted — UI should hide the
    // "Place order" CTA when supplier === AC.
  },
};

async function invoke(fn, body) {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export function supportsOrdering(supplier) {
  return Boolean(FN[supplier]?.placeOrder);
}

export async function searchCatalog(supplier, { query, category, limit = 48, page = 1 } = {}) {
  const fn = FN[supplier]?.search;
  if (!fn) throw new Error(`No search function for supplier ${supplier}`);
  return invoke(fn, { query, category, limit, page });
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

export async function getInventory(supplier, params = {}) {
  const fn = FN[supplier]?.inventory;
  if (!fn) throw new Error(`No inventory function for supplier ${supplier}`);
  return invoke(fn, params);
}

export async function getPricelist(supplier, params = {}) {
  const fn = FN[supplier]?.pricelist;
  if (!fn) throw new Error(`No pricelist function for supplier ${supplier}`);
  return invoke(fn, params);
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
