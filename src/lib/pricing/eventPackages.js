// Event / package pricing — flat-rate service packages that don't fit
// the color×qty decoration matrices (Reagan's "Live In-Person Printing"
// sheet, tester notes 2026-07-18 + Joe 2026-07-20):
//
//   Tier 1: supply your own — $1,000, 4 hr min
//   Tier 2: 50 tees included — $1,200, 4 hr min, screen fee $200
//   Tier 3: 100 tees included — $1,400, 6 hr min, screen fee $300
//   $125/hr beyond the minimum; extra Gildans $5/shirt, AS Colour $9/shirt;
//   art fee waived when art is supplied.
//
// Storage: pricing_config.eventPackages =
//   {
//     enabled: boolean,
//     hourlyRate: number,              // $/hr beyond a package's minHours
//     packages: [{
//       id, label,                     // "Tier 2: 50 tees included"
//       basePrice: number,             // 1200
//       minHours: number,              // 4
//       notes: string,                 // free text shown in the picker
//       fees:   [{ id, label, amount, waivable }],  // flat per-job fees
//       addOns: [{ id, label, rate, unit }],        // per-unit extras ($5/shirt)
//     }],
//   }
//
// A package never prices lines or matrices — selecting one on a quote
// GENERATES itemized additional_charges rows (the flat, whole-order
// charge system), so totals, the PDF, the customer payment page, and
// the QB invoice all carry event pricing with zero new money paths.
// Charges are fully editable after insertion, same as hand-typed ones.

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function normalizeEventPackages(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const packages = (Array.isArray(src.packages) ? src.packages : [])
    .map((p, i) => ({
      id: p?.id || `pkg_${i}`,
      label: typeof p?.label === "string" ? p.label : "",
      basePrice: Math.max(0, num(p?.basePrice)),
      minHours: Math.max(0, num(p?.minHours)),
      notes: typeof p?.notes === "string" ? p.notes : "",
      fees: (Array.isArray(p?.fees) ? p.fees : [])
        .map((f, j) => ({
          id: f?.id || `fee_${i}_${j}`,
          label: typeof f?.label === "string" ? f.label : "",
          amount: Math.max(0, num(f?.amount)),
          waivable: !!f?.waivable,
        }))
        .filter((f) => f.label.trim() !== "" || f.amount > 0),
      addOns: (Array.isArray(p?.addOns) ? p.addOns : [])
        .map((a, j) => ({
          id: a?.id || `addon_${i}_${j}`,
          label: typeof a?.label === "string" ? a.label : "",
          rate: Math.max(0, num(a?.rate)),
          unit: typeof a?.unit === "string" && a.unit.trim() ? a.unit.trim() : "shirt",
        }))
        .filter((a) => a.label.trim() !== "" || a.rate > 0),
    }))
    .filter((p) => p.label.trim() !== "" || p.basePrice > 0);

  return {
    enabled: !!src.enabled,
    hourlyRate: Math.max(0, num(src.hourlyRate)),
    packages,
  };
}

export function hasEventPackages(pricingConfig) {
  const ev = normalizeEventPackages(pricingConfig?.eventPackages);
  return ev.enabled && ev.packages.length > 0;
}

/**
 * Turn a selected package + the operator's inputs into itemized
 * additional_charges rows ([{id,label,amount,taxable}]).
 *
 * @param pkg        a normalized package (from normalizeEventPackages)
 * @param opts.hours       total booked hours (defaults to pkg.minHours)
 * @param opts.hourlyRate  the shop's overage $/hr
 * @param opts.addOnQtys   { [addOnId]: qty }
 * @param opts.waivedFeeIds fee ids the operator waived (e.g. art supplied)
 * @param opts.makeId      id generator (the editor passes uid); defaults
 *                         to a deterministic per-call counter for tests
 *
 * All rows are TAXABLE by default (TAX-04 convention for charges) and
 * remain editable — flip taxable off per row on the quote if a
 * jurisdiction treats the service differently.
 */
export function buildEventCharges(pkg, { hours, hourlyRate, addOnQtys = {}, waivedFeeIds = [], makeId } = {}) {
  if (!pkg) return [];
  let seq = 0;
  const nextId = makeId || (() => `evt_${pkg.id}_${seq++}`);
  const rows = [];

  rows.push({
    id: nextId(),
    label: `${pkg.label} — event package (${pkg.minHours} hr min)`,
    amount: Math.round(pkg.basePrice * 100) / 100,
    taxable: true,
  });

  const bookedHours = Math.max(num(hours, pkg.minHours), 0);
  const overageHours = Math.max(0, bookedHours - pkg.minHours);
  const rate = Math.max(0, num(hourlyRate));
  if (overageHours > 0 && rate > 0) {
    rows.push({
      id: nextId(),
      label: `Additional event hours (${overageHours} × $${rate}/hr)`,
      amount: Math.round(overageHours * rate * 100) / 100,
      taxable: true,
    });
  }

  for (const addOn of pkg.addOns || []) {
    const qty = Math.max(0, Math.round(num(addOnQtys[addOn.id])));
    if (qty > 0 && addOn.rate > 0) {
      rows.push({
        id: nextId(),
        label: `${addOn.label} (${qty} × $${addOn.rate}/${addOn.unit})`,
        amount: Math.round(qty * addOn.rate * 100) / 100,
        taxable: true,
      });
    }
  }

  const waived = new Set(waivedFeeIds);
  for (const fee of pkg.fees || []) {
    if (waived.has(fee.id)) continue;
    if (fee.amount <= 0) continue;
    rows.push({
      id: nextId(),
      label: fee.label,
      amount: Math.round(fee.amount * 100) / 100,
      taxable: true,
    });
  }

  return rows;
}
