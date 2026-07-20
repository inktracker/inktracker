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
  buildQBInvoicePayload,
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

describe("per_print — attaches to a SPECIFIC print (imprint.extras)", () => {
  const snap = { mode: "flat", rate: 0.5, basis: "per_print" };

  it("a fee on ONE print costs rate × qty — not × all prints", () => {
    // front has underbase, back does not → charged for the front alone.
    const li = line({ imprints: [imp({ extras: { underbase: snap } }), imp()] });
    expect(Math.round((base(li) - base(line())) * 100) / 100).toBe(24); // 0.5 × 48
  });

  it("the same fee on BOTH prints costs rate × 2 × qty", () => {
    const li = line({ imprints: [imp({ extras: { underbase: snap } }), imp({ extras: { underbase: snap } })] });
    expect(Math.round((base(li) - base(line())) * 100) / 100).toBe(48); // 0.5 × 2 × 48
  });

  it("front-only and back-only cost the same (fee follows the print it's on)", () => {
    const front = line({ imprints: [imp({ extras: { underbase: snap } }), imp()] });
    const back = line({ imprints: [imp(), imp({ extras: { underbase: snap } })] });
    expect(base(front)).toBeCloseTo(base(back), 5);
  });

  it("LEGACY line-level per_print (pre-2026-07 quotes) still bills × locations", () => {
    // Quotes saved in the brief window before per-print moved onto imprints.
    const li = line(); // 2 prints
    expect(Math.round((base(li, { underbase: snap }) - base(li, {})) * 100) / 100).toBe(48); // 0.5 × 2 × 48
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

// ── QuickBooks payload — nothing silently dropped, no double-count ────────────
// buildQBInvoicePayload is what the frontend sends to qbSync (the edge fn does
// NOT recompute), so QB correctness lives here. sum(line.amount) must equal the
// engine subtotal + fees for all three categories.
describe("QuickBooks payload translation", () => {
  const salesSum = (p) => p.lines.filter((l) => !l.isFee).reduce((s, l) => s + l.amount, 0);
  const allSum = (p) => p.lines.reduce((s, l) => s + l.amount, 0);

  it("per_print (on one print) + per_garment fold into the taxable garment line amount", () => {
    const withPrint = line({ imprints: [imp({ extras: { underbase: { mode: "flat", rate: 0.5, basis: "per_print" } } }), imp()] });
    const withGarment = { ...line(), extras: { tags: 1 } }; // per_garment flat
    const pPrint = buildQBInvoicePayload({ line_items: [withPrint], rush_rate: 0, tax_rate: 0 });
    const pGarment = buildQBInvoicePayload({ line_items: [withGarment], rush_rate: 0, tax_rate: 0 });
    const pPlain = buildQBInvoicePayload({ line_items: [line()], rush_rate: 0, tax_rate: 0 });
    expect(Math.round((salesSum(pPrint) - salesSum(pPlain)) * 100) / 100).toBe(24); // 0.5 × 48 (one print)
    expect(Math.round((salesSum(pGarment) - salesSum(pPlain)) * 100) / 100).toBe(48); // 1 × 48
  });

  it("a per_job fee becomes its own taxable QB fee line (not dropped)", () => {
    const p = buildQBInvoicePayload({
      line_items: [line()], rush_rate: 0, tax_rate: 0,
      additional_charges: [{ id: "jobfee_art", label: "Art fee", amount: 25, taxable: true }],
    });
    const feeLine = p.lines.find((l) => l.isFee && (l.description || "").includes("Art fee"));
    expect(feeLine).toBeTruthy();
    expect(feeLine.amount).toBe(25);
    expect(feeLine.taxable).toBe(true);
  });

  it("QB line sum equals engine subtotal + fees with all three categories at once", () => {
    const q = {
      line_items: [line({
        extras: { tags: 1 }, // per_garment on the line
        imprints: [imp({ extras: { underbase: { mode: "flat", rate: 0.5, basis: "per_print" } } }), imp()], // per_print on one imprint
      })],
      rush_rate: 0, tax_rate: 0,
      additional_charges: [{ id: "jobfee_art", label: "Art fee", amount: 25, taxable: true }],
    };
    const p = buildQBInvoicePayload(q);
    const t = calcQuoteTotalsWithLinking(q);
    // garment lines = subtotal (incl. per-print + per-garment), fee line = 25.
    expect(Math.round(allSum(p) * 100) / 100).toBe(Math.round((t.subtotal + 25) * 100) / 100);
  });
});
