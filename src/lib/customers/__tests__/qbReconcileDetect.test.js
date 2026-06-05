// Pinned contract for QB-reconcile pair detection. If detection
// misfires, the Customers page either shouts about merges that
// aren't there or silently misses ones that are — both erode trust
// in the QB integration. The pairs feed directly into the same
// additive merge contract pinned in mergeCustomerData.test.js.

import { describe, it, expect } from "vitest";
import { findReconcileNeeded, partitionReconcilePairs } from "../qbReconcileDetect";

describe("findReconcileNeeded", () => {
  it("returns [] when either argument is missing or non-array", () => {
    expect(findReconcileNeeded(null, [])).toEqual([]);
    expect(findReconcileNeeded([], null)).toEqual([]);
    expect(findReconcileNeeded(undefined, undefined)).toEqual([]);
    expect(findReconcileNeeded("nope", "nope")).toEqual([]);
  });

  it("returns [] when no local rows match any inactive QB id", () => {
    const customers = [{ id: 1, qb_customer_id: "999" }];
    const inactive = [{ qb_customer_id: "111", mergedIntoId: "222" }];
    expect(findReconcileNeeded(customers, inactive)).toEqual([]);
  });

  it("pairs inactive+survivor when both sides have local records", () => {
    const customers = [
      { id: 1, name: "Acme A", qb_customer_id: "111" },
      { id: 2, name: "Acme B", qb_customer_id: "222" },
      { id: 3, name: "Unrelated", qb_customer_id: "333" },
    ];
    const inactive = [{ qb_customer_id: "111", mergedIntoId: "222", displayName: "Acme A" }];
    const out = findReconcileNeeded(customers, inactive);
    expect(out).toHaveLength(1);
    expect(out[0].inactive.id).toBe(1);
    expect(out[0].survivor.id).toBe(2);
    expect(out[0].mergedIntoId).toBe("222");
    expect(out[0].qbDisplayName).toBe("Acme A");
  });

  it("returns survivor=null when QB survivor has no local row yet", () => {
    // Common scenario: shop did the QB merge but the survivor was
    // created in QB after our last customer pull, so InkTracker only
    // has the inactive side locally. Banner UI handles this by
    // pointing the operator at the pull-from-QB action first.
    const customers = [{ id: 1, qb_customer_id: "111" }];
    const inactive = [{ qb_customer_id: "111", mergedIntoId: "222" }];
    const out = findReconcileNeeded(customers, inactive);
    expect(out).toHaveLength(1);
    expect(out[0].inactive.id).toBe(1);
    expect(out[0].survivor).toBeNull();
    expect(out[0].mergedIntoId).toBe("222");
  });

  it("returns survivor=null when QB omits MergedIntoId (deactivated, not merged)", () => {
    // QB lets you deactivate without merging. We still surface it so
    // the operator notices, but with no survivor pointer.
    const customers = [{ id: 1, qb_customer_id: "111" }];
    const inactive = [{ qb_customer_id: "111", mergedIntoId: null }];
    const out = findReconcileNeeded(customers, inactive);
    expect(out[0].survivor).toBeNull();
    expect(out[0].mergedIntoId).toBeNull();
  });

  it("skips inactive QB records that don't correspond to any local row", () => {
    // QB had multiple merges; only one had a local InkTracker record.
    const customers = [{ id: 1, qb_customer_id: "111" }];
    const inactive = [
      { qb_customer_id: "111", mergedIntoId: "222" },
      { qb_customer_id: "888", mergedIntoId: "999" }, // not in InkTracker
    ];
    const out = findReconcileNeeded(customers, inactive);
    expect(out).toHaveLength(1);
    expect(out[0].inactive.id).toBe(1);
  });

  it("deduplicates by inactive qb_customer_id when QB returns the same row twice", () => {
    const customers = [{ id: 1, qb_customer_id: "111" }];
    const inactive = [
      { qb_customer_id: "111", mergedIntoId: "222" },
      { qb_customer_id: "111", mergedIntoId: "222" },
    ];
    expect(findReconcileNeeded(customers, inactive)).toHaveLength(1);
  });

  it("coerces numeric IDs to strings on both sides (QB ships them inconsistently)", () => {
    const customers = [
      { id: 1, qb_customer_id: 111 }, // numeric
      { id: 2, qb_customer_id: "222" },
    ];
    const inactive = [{ qb_customer_id: "111", mergedIntoId: 222 }];
    const out = findReconcileNeeded(customers, inactive);
    expect(out[0].inactive.id).toBe(1);
    expect(out[0].survivor.id).toBe(2);
  });

  it("ignores local rows without a qb_customer_id", () => {
    const customers = [
      { id: 1, qb_customer_id: "" }, // empty string
      { id: 2 }, // missing
      { id: 3, qb_customer_id: null },
    ];
    const inactive = [{ qb_customer_id: "111", mergedIntoId: "222" }];
    expect(findReconcileNeeded(customers, inactive)).toEqual([]);
  });

  it("handles malformed inactive rows defensively", () => {
    const customers = [{ id: 1, qb_customer_id: "111" }];
    const inactive = [null, undefined, {}, { qb_customer_id: "" }, { qb_customer_id: "111", mergedIntoId: "222" }];
    const out = findReconcileNeeded(customers, inactive);
    expect(out).toHaveLength(1);
    expect(out[0].inactive.id).toBe(1);
  });
});

describe("partitionReconcilePairs", () => {
  it("splits actionable (has survivor) from survivor-missing", () => {
    const pairs = [
      { inactive: { id: 1 }, survivor: { id: 2 }, mergedIntoId: "222", qbDisplayName: "A" },
      { inactive: { id: 3 }, survivor: null, mergedIntoId: "999", qbDisplayName: "B" },
      { inactive: { id: 4 }, survivor: { id: 5 }, mergedIntoId: "555", qbDisplayName: "C" },
    ];
    const { actionable, survivorMissing } = partitionReconcilePairs(pairs);
    expect(actionable.map(p => p.inactive.id)).toEqual([1, 4]);
    expect(survivorMissing.map(p => p.inactive.id)).toEqual([3]);
  });

  it("returns empty arrays for null / undefined / empty inputs", () => {
    expect(partitionReconcilePairs(null)).toEqual({ actionable: [], survivorMissing: [] });
    expect(partitionReconcilePairs(undefined)).toEqual({ actionable: [], survivorMissing: [] });
    expect(partitionReconcilePairs([])).toEqual({ actionable: [], survivorMissing: [] });
  });

  it("filters out null entries defensively", () => {
    const pairs = [null, undefined, { inactive: { id: 1 }, survivor: { id: 2 } }];
    const { actionable, survivorMissing } = partitionReconcilePairs(pairs);
    expect(actionable).toHaveLength(1);
    expect(survivorMissing).toHaveLength(0);
  });
});
