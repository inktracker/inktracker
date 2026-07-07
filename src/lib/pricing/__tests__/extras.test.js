// Extras (per-piece add-on fees) — flat-or-percent contract tests.
//
// The user explicitly asked to make Extra Fees either flat $ or a
// percentage of garment cost. Snapshot semantics matter for quotes:
// once a customer agrees to a number, the dollar amount on the quote
// has to stay stable. That contract is pinned by the tests below.

import { describe, it, expect } from "vitest";
import {
  normalizeExtraConfigEntry,
  resolveExtraRatePerPiece,
  snapshotExtraForQuote,
  getLineExtras,
  resolveExtraBasis,
  normalizeExtraBasis,
  computeJobFeeAmount,
  DEFAULT_EXTRA_BASIS,
  EXTRA_BASES,
} from "../extras";

describe("add-on categories (basis)", () => {
  it("EXTRA_BASES is the three categories; default is per_garment", () => {
    expect(EXTRA_BASES.slice().sort()).toEqual(["per_garment", "per_job", "per_print"]);
    expect(DEFAULT_EXTRA_BASIS).toBe("per_garment");
  });

  it("normalizeExtraBasis clamps unknowns to per_garment", () => {
    expect(normalizeExtraBasis("per_print")).toBe("per_print");
    expect(normalizeExtraBasis("per_job")).toBe("per_job");
    expect(normalizeExtraBasis("nonsense")).toBe("per_garment");
    expect(normalizeExtraBasis(undefined)).toBe("per_garment");
  });

  it("resolveExtraBasis prefers the SNAPSHOT's basis (immutability) over config", () => {
    // Saved snapshot says per_print; shop later recategorized to per_job → snapshot wins.
    expect(resolveExtraBasis({ mode: "flat", rate: 1, basis: "per_print" }, "per_job")).toBe("per_print");
  });

  it("resolveExtraBasis falls back to config, then per_garment", () => {
    expect(resolveExtraBasis(2, "per_print")).toBe("per_print");   // bare number → no own basis → config
    expect(resolveExtraBasis(true, "per_job")).toBe("per_job");
    expect(resolveExtraBasis(2, undefined)).toBe("per_garment");
    expect(resolveExtraBasis({ mode: "flat", rate: 1 }, undefined)).toBe("per_garment");
  });
});

describe("snapshotExtraForQuote — carries the category", () => {
  it("keeps per_garment FLAT as a bare number (backward compatible)", () => {
    expect(snapshotExtraForQuote({ mode: "flat", rate: 1.5, basis: "per_garment" })).toBe(1.5);
    expect(snapshotExtraForQuote({ mode: "flat", rate: 1.5 })).toBe(1.5); // basis defaults
  });
  it("snapshots percent as an object (per_garment basis stays implicit)", () => {
    expect(snapshotExtraForQuote({ mode: "percent", rate: 10, basis: "per_garment" }))
      .toEqual({ mode: "percent", rate: 10 });
  });
  it("includes basis for per_print / per_job", () => {
    expect(snapshotExtraForQuote({ mode: "flat", rate: 0.5, basis: "per_print" }))
      .toEqual({ mode: "flat", rate: 0.5, basis: "per_print" });
    expect(snapshotExtraForQuote({ mode: "flat", rate: 25, basis: "per_job" }))
      .toEqual({ mode: "flat", rate: 25, basis: "per_job" });
    expect(snapshotExtraForQuote({ mode: "percent", rate: 5, basis: "per_job" }))
      .toEqual({ mode: "percent", rate: 5, basis: "per_job" });
  });
});

describe("computeJobFeeAmount — the once-per-order dollar amount", () => {
  it("flat → the rate, once", () => {
    expect(computeJobFeeAmount({ mode: "flat", rate: 25 }, 840)).toBe(25);
  });
  it("percent → rate% of the line subtotal", () => {
    expect(computeJobFeeAmount({ mode: "percent", rate: 5 }, 840)).toBe(42);
  });
  it("percent with no/zero subtotal → 0", () => {
    expect(computeJobFeeAmount({ mode: "percent", rate: 5 }, 0)).toBe(0);
  });
  it("returns 0 for bad input", () => {
    expect(computeJobFeeAmount(null, 100)).toBe(0);
    expect(computeJobFeeAmount(undefined, 100)).toBe(0);
  });
});

describe("normalizeExtraConfigEntry — shop-side config normalization", () => {
  it("returns flat 0 when the key is missing from both maps", () => {
    expect(normalizeExtraConfigEntry({}, {}, "tags")).toEqual({ mode: "flat", rate: 0, basis: "per_garment" });
    expect(normalizeExtraConfigEntry(undefined, undefined, "tags")).toEqual({ mode: "flat", rate: 0, basis: "per_garment" });
  });

  it("reads a v1 plain-number entry as flat", () => {
    const extras = { tags: 1.5 };
    expect(normalizeExtraConfigEntry(extras, undefined, "tags"))
      .toEqual({ mode: "flat", rate: 1.5, basis: "per_garment" });
  });

  it("reads explicit percent mode", () => {
    const extras = { waterbased: 5 };
    const extraModes = { waterbased: "percent" };
    expect(normalizeExtraConfigEntry(extras, extraModes, "waterbased"))
      .toEqual({ mode: "percent", rate: 5, basis: "per_garment" });
  });

  it("reads the fee category (basis) from extraBasis, defaulting to per_garment", () => {
    const extras = { underbase: 0.5, artFee: 25 };
    const extraBasis = { underbase: "per_print", artFee: "per_job" };
    expect(normalizeExtraConfigEntry(extras, undefined, "underbase", extraBasis).basis).toBe("per_print");
    expect(normalizeExtraConfigEntry(extras, undefined, "artFee", extraBasis).basis).toBe("per_job");
    expect(normalizeExtraConfigEntry(extras, undefined, "underbase", {}).basis).toBe("per_garment");
    expect(normalizeExtraConfigEntry(extras, undefined, "underbase", { underbase: "bogus" }).basis).toBe("per_garment");
  });

  it("treats unknown mode strings as flat (defensive default)", () => {
    const extras = { tags: 2 };
    const extraModes = { tags: "fixed" };
    expect(normalizeExtraConfigEntry(extras, extraModes, "tags").mode).toBe("flat");
  });

  it("coerces numeric-string rates", () => {
    expect(normalizeExtraConfigEntry({ tags: "1.5" }, undefined, "tags").rate).toBe(1.5);
  });

  it("zeroes a NaN / non-finite rate (defensive)", () => {
    expect(normalizeExtraConfigEntry({ tags: NaN }, undefined, "tags").rate).toBe(0);
    expect(normalizeExtraConfigEntry({ tags: Infinity }, undefined, "tags").rate).toBe(0);
    expect(normalizeExtraConfigEntry({ tags: "abc" }, undefined, "tags").rate).toBe(0);
  });
});

describe("resolveExtraRatePerPiece — quote-time dollar resolution", () => {
  it("returns 0 for off / missing / null", () => {
    expect(resolveExtraRatePerPiece(false, 10)).toBe(0);
    expect(resolveExtraRatePerPiece(null, 10)).toBe(0);
    expect(resolveExtraRatePerPiece(undefined, 10)).toBe(0);
    expect(resolveExtraRatePerPiece(0, 10)).toBe(0);
  });

  it("treats a bare number as flat dollars (legacy shape preserved)", () => {
    expect(resolveExtraRatePerPiece(1.5, 10)).toBe(1.5);
    expect(resolveExtraRatePerPiece(2, 0)).toBe(2);
  });

  it("applies percent mode against per-piece decoration cost", () => {
    // 5% of $10 decoration/pc = $0.50/pc
    expect(resolveExtraRatePerPiece({ mode: "percent", rate: 5 }, 10)).toBe(0.5);
    // 100% of $4 = $4
    expect(resolveExtraRatePerPiece({ mode: "percent", rate: 100 }, 4)).toBe(4);
  });

  it("returns 0 for percent when decoration cost is zero / missing", () => {
    expect(resolveExtraRatePerPiece({ mode: "percent", rate: 5 }, 0)).toBe(0);
    expect(resolveExtraRatePerPiece({ mode: "percent", rate: 5 }, null)).toBe(0);
    expect(resolveExtraRatePerPiece({ mode: "percent", rate: 5 }, undefined)).toBe(0);
  });

  it("returns 0 for percent when decoration cost is negative (defensive)", () => {
    expect(resolveExtraRatePerPiece({ mode: "percent", rate: 5 }, -10)).toBe(0);
  });

  it("treats an explicit { mode: 'flat' } object the same as a bare number", () => {
    expect(resolveExtraRatePerPiece({ mode: "flat", rate: 1.5 }, 10)).toBe(1.5);
  });

  it("returns 0 for an object with a non-finite rate", () => {
    expect(resolveExtraRatePerPiece({ mode: "percent", rate: NaN }, 10)).toBe(0);
    expect(resolveExtraRatePerPiece({ mode: "flat", rate: Infinity }, 10)).toBe(0);
  });
});

describe("snapshotExtraForQuote — what the toggle UI writes to quote.extras", () => {
  it("returns a bare number for flat fees so legacy consumers keep working", () => {
    expect(snapshotExtraForQuote({ mode: "flat", rate: 1.5 })).toBe(1.5);
  });

  it("returns the full object for percent fees so the engine can recompute against garment cost", () => {
    expect(snapshotExtraForQuote({ mode: "percent", rate: 5 }))
      .toEqual({ mode: "percent", rate: 5 });
  });

  it("zeroes a missing entry", () => {
    expect(snapshotExtraForQuote(null)).toBe(0);
    expect(snapshotExtraForQuote(undefined)).toBe(0);
  });
});

describe("getLineExtras — per-line vs legacy quote-level fallback", () => {
  it("uses li.extras when the line has its own (new quotes)", () => {
    const li = { extras: { tags: 1.5 } };
    const q  = { extras: { waterbased: 2 } };
    expect(getLineExtras(li, q)).toEqual({ tags: 1.5 });
  });

  it("falls back to quote.extras when the line has no extras field (old quotes)", () => {
    const li = { id: "li-1" };
    const q  = { extras: { tags: 1.5 } };
    expect(getLineExtras(li, q)).toEqual({ tags: 1.5 });
  });

  it("respects an EXPLICITLY empty li.extras — does NOT fall through to quote", () => {
    // A fresh line on a new quote: user hasn't toggled any fees on
    // this particular line. Falling through to quote.extras would
    // wrongly apply quote-level legacy fees to the new line.
    const li = { extras: {} };
    const q  = { extras: { tags: 1.5 } };
    expect(getLineExtras(li, q)).toEqual({});
  });

  it("returns {} when both line and quote have no extras", () => {
    expect(getLineExtras({}, {})).toEqual({});
    expect(getLineExtras(null, null)).toEqual({});
    expect(getLineExtras(undefined, undefined)).toEqual({});
  });

  it("treats li.extras = null as 'never set' and falls back to quote (defensive)", () => {
    // JSONB round-trips can sometimes nullify an empty object. Be
    // conservative and fall back rather than mis-render zero fees.
    const li = { extras: null };
    const q  = { extras: { tags: 1.5 } };
    expect(getLineExtras(li, q)).toEqual({ tags: 1.5 });
  });
});

describe("end-to-end snapshot round-trip", () => {
  it("flat fee: shop=$1.50 → snapshot=1.5 → resolves to $1.50 even if shop later changes the rate", () => {
    const shop = { tags: 1.5 };
    const entry = normalizeExtraConfigEntry(shop, undefined, "tags");
    const snapshot = snapshotExtraForQuote(entry);
    // Shop later raises the rate — quote stays at the snapshot.
    expect(resolveExtraRatePerPiece(snapshot, 99)).toBe(1.5);
  });

  it("percent fee: shop=5% / decoration=$10/pc → snapshot stays 5% → $0.50/pc regardless of shop changes", () => {
    const shop = { tags: 5 };
    const modes = { tags: "percent" };
    const entry = normalizeExtraConfigEntry(shop, modes, "tags");
    const snapshot = snapshotExtraForQuote(entry);
    expect(resolveExtraRatePerPiece(snapshot, 10)).toBe(0.5);
    // The quote's snapshot is stable across shop config changes.
    expect(snapshot).toEqual({ mode: "percent", rate: 5 });
  });
});
