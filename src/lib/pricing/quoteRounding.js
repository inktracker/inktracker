// Single rounding contract for a quote's discount / setup / fees / tax / total.
// Used by BOTH the editor's live preview AND the save-time snapshot so the
// number you see while editing is exactly the number that gets stored, and the
// displayed line column always foots:
//
//   subtotal − discount + setup + additional fees + tax === total
//
// The bug this fixes (2026-06-17): the old save rounded tax, then rounded
// (afterDisc + tax) AGAIN with afterDisc left UNROUNDED — a double-round that
// pushed half-cent totals a penny above the true math (15% of $466.70 stored
// as $429.49 instead of the correct $429.48). Here every component is rounded
// to cents ONCE and the total is their sum.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param {object} a
 * @param {number} a.sub           line-item subtotal incl. rush (pre-discount)
 * @param {number|string} a.discount      discount value (% or flat $)
 * @param {string} [a.discountType]       "flat" | "percent"
 * @param {number} [a.setup]        setup/screen fees total
 * @param {number} [a.addlTaxable]  taxable additional fees total
 * @param {number} [a.addlNonTax]   non-taxable additional fees total
 * @param {number|string} [a.taxRate]     tax rate (percent)
 * @returns {{sub,discountAmount,afterDisc,setup,taxableBase,tax,total:number}}
 */
export function roundedQuoteTotals({ sub, discount, discountType, setup = 0, addlTaxable = 0, addlNonTax = 0, taxRate = 0 }) {
  const s = r2(sub);
  const dv = parseFloat(discount) || 0;
  const isFlat = discountType === "flat" || (dv > 100 && discountType !== "percent");
  const discountAmount = isFlat ? Math.min(r2(dv), s) : r2((s * dv) / 100);
  const afterDisc = r2(Math.max(0, s - discountAmount));
  const setupR = r2(setup);
  const taxableBase = r2(afterDisc + setupR + r2(addlTaxable));
  const tax = r2(taxableBase * ((parseFloat(taxRate) || 0) / 100));
  const total = r2(taxableBase + tax + r2(addlNonTax));
  return { sub: s, discountAmount, afterDisc, setup: setupR, taxableBase, tax, total };
}
