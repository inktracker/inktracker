import { EMPTY_PUSH } from "./taxProvider";

/**
 * InternalTaxProvider — computes tax locally from `shop.rate_table`.
 *
 * Rate lookup precedence:
 *   1. exact zip match in rate_table
 *   2. state match in rate_table
 *   3. shop.default_jurisdiction state match in rate_table
 *   4. zero
 *
 * A line contributes tax only when:
 *   customer.taxable !== false  AND
 *   customer.tax_exempt !== true  AND
 *   line.taxable !== false
 *
 * (We honor the legacy `customer.tax_exempt` flag in addition to the new
 * `customer.taxable` so existing exempt customers stay exempt with no UI
 * change.)
 */

function lineSubtotal(line) {
  // The wider app stamps `_lineTotal` onto each line item via the pricing
  // engine's "calculate once" pass. Prefer it when present; fall back to
  // `subtotal`/`amount` for legacy/test inputs.
  if (Number.isFinite(line?._lineTotal)) return Number(line._lineTotal);
  if (Number.isFinite(line?.subtotal))   return Number(line.subtotal);
  if (Number.isFinite(line?.amount))     return Number(line.amount);
  return 0;
}

function normalizeState(s) {
  return (s || "").toString().trim().toUpperCase();
}

function normalizeZip(z) {
  // 5-digit US zip; strip ZIP+4 suffix and any whitespace.
  return (z || "").toString().trim().split("-")[0].slice(0, 5);
}

export function lookupRate(rateTable, shipTo, defaultJurisdiction) {
  const table = Array.isArray(rateTable) ? rateTable : [];
  const zip   = normalizeZip(shipTo?.zip);
  const state = normalizeState(shipTo?.state);

  if (zip) {
    const byZip = table.find(r => normalizeZip(r.zip) === zip);
    if (byZip) {
      return { rate: Number(byZip.rate) || 0, jurisdiction: byZip.zip || state || null };
    }
  }
  if (state) {
    const byState = table.find(r => normalizeState(r.state) === state);
    if (byState) {
      return { rate: Number(byState.rate) || 0, jurisdiction: state };
    }
  }
  const fallbackState = normalizeState(defaultJurisdiction);
  if (fallbackState) {
    const byFallback = table.find(r => normalizeState(r.state) === fallbackState);
    if (byFallback) {
      return { rate: Number(byFallback.rate) || 0, jurisdiction: fallbackState };
    }
  }
  return { rate: 0, jurisdiction: null };
}

export function createInternalTaxProvider() {
  return {
    mode: "internal",

    calculate(quote, { shop = {}, customer = {} } = {}) {
      const lines = Array.isArray(quote?.line_items) ? quote.line_items : [];
      const customerTaxable = customer.taxable !== false && customer.tax_exempt !== true;

      const { rate, jurisdiction } = lookupRate(
        shop.rate_table,
        customer.ship_to_address,
        shop.default_jurisdiction,
      );

      const ratePct = rate / 100;
      let totalTax = 0;

      const lineTax = lines.map((li) => {
        const lineTaxable = li?.taxable !== false;
        if (!customerTaxable || !lineTaxable) {
          return { id: li?.id, taxAmount: 0, taxableAmount: 0 };
        }
        const taxableAmount = lineSubtotal(li);
        const taxAmount = Math.round(taxableAmount * ratePct * 100) / 100;
        totalTax += taxAmount;
        return { id: li?.id, taxAmount, taxableAmount };
      });

      return {
        lineTax,
        totalTax: Math.round(totalTax * 100) / 100,
        rate,
        jurisdiction,
      };
    },

    // Internal provider has no external invoice system to push to.
    async pushInvoice() {
      return { ...EMPTY_PUSH };
    },
  };
}
