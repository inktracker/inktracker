// Add-on categories (per print / per garment / per job) — engine math.
//
// Proves each basis multiplies correctly through the real pricing engine, using
// DELTAS (line with the fee vs. without) so the assertions don't depend on the
// exact base print rates. Snapshots carry their own basis, so these exercise the
// immutable path the quote editors write.
import { describe, it, expect, beforeEach } from "vitest";
import {
  calcLinkedLinePrice,
  calcQuoteTotalsWithLinking,
  loadShopPricingConfig,
} from "../pricing";

beforeEach(() => loadShopPricingConfig(null)); // default shop config

const imp = (over = {}) => ({ id: Math.random().toString(36).slice(2), colors: 1, technique: "Screen Print", ...over });
const line = (over = {}) => ({
  id: "li-1",
  garmentCost: "5.00",
  sizes: { M: "48" },              // qty = 48
  imprints: [imp(), imp()],        // TWO print locations (front + back)
  ...over,
});
const base = (li, extras) => calcLinkedLinePrice(li, 0, extras || {}, undefined, {}).baseSubtotal;

describe("per_garment (the historical default)", () => {
  it("adds rate × pieces, NOT × print count", () => {
    const li = line();
    const withFee = base(li, { tags: 1 });          // bare number = per_garment flat
    const without = base(li, {});
    expect(Math.round((withFee - without) * 100) / 100).toBe(48); // $1 × 48 pcs
  });

  it("an unknown-basis object still behaves per_garment", () => {
    const li = line();
    const delta = base(li, { tags: { mode: "flat", rate: 1 } }) - base(li, {});
    expect(Math.round(delta * 100) / 100).toBe(48);
  });
});

describe("per_print", () => {
  it("adds rate × print locations × pieces", () => {
    const li = line(); // 2 prints, 48 pcs
    const delta = base(li, { underbase: { mode: "flat", rate: 0.5, basis: "per_print" } }) - base(li, {});
    expect(Math.round(delta * 100) / 100).toBe(48); // 0.5 × 2 × 48
  });

  it("scales with the number of locations (1 print → half of 2 prints)", () => {
    const one = line({ imprints: [imp()] });
    const two = line({ imprints: [imp(), imp()] });
    const snap = { mode: "flat", rate: 0.5, basis: "per_print" };
    const d1 = base(one, { underbase: snap }) - base(one, {});
    const d2 = base(two, { underbase: snap }) - base(two, {});
    expect(Math.round(d1 * 100) / 100).toBe(24); // 0.5 × 1 × 48
    expect(Math.round(d2 * 100) / 100).toBe(48); // 0.5 × 2 × 48
  });
});

describe("per_job (routed through additional_charges — once per order)", () => {
  it("a flat per_job fee (a jobfee_* additional charge) is added once, taxable", () => {
    const q = {
      line_items: [line(), line({ id: "li-2", sizes: { L: "100" } })],
      rush_rate: 0, tax_rate: 0,
      additional_charges: [{ id: "jobfee_art", label: "Art fee", amount: 25, taxable: true }],
    };
    const withJob = calcQuoteTotalsWithLinking(q);
    const withoutJob = calcQuoteTotalsWithLinking({ ...q, additional_charges: [] });
    expect(Math.round((withJob.total - withoutJob.total) * 100) / 100).toBe(25);
    expect(withJob.additionalTaxable).toBe(25);
  });

  it("a per_job fee mistakenly toggled on a LINE is ignored by the line calc", () => {
    // excludeJobAddons keeps per_job out of the line UI, but defend the engine.
    const li = line();
    const delta = base(li, { art: { mode: "flat", rate: 25, basis: "per_job" } }) - base(li, {});
    expect(delta).toBe(0);
  });
});
