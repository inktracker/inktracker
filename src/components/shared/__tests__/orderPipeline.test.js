import { describe, it, expect } from "vitest";
import { O_STATUSES } from "../pricing";

// Order pipeline regression guard.
//
// The pipeline was slimmed from 8 stages to 5 on 2026-05-12 (Joe's
// audit decision: Finishing, QC, and Ready for Pickup are inline
// with Printing for the single-press ICP). The DB CHECK constraint
// (20260518_slim_order_pipeline.sql) enforces the same set on the
// server side — any drift between this list and the DB would
// produce inserts that pass the client but fail the constraint.
//
// If you're here because this test failed: you intentionally
// changed the pipeline. Update the constant in this test AND the
// CHECK constraint in a new migration in lockstep.

const EXPECTED_PIPELINE = [
  "Art Approval",
  "Order Goods",
  "Pre-Press",
  "Printing",
  "Completed",
];

const FORBIDDEN_LEGACY = ["Finishing", "QC", "Ready for Pickup"];

describe("O_STATUSES — slim 5-stage pipeline", () => {
  it("matches the canonical 5-stage list exactly (order-sensitive)", () => {
    expect(O_STATUSES).toEqual(EXPECTED_PIPELINE);
  });

  it("contains no legacy statuses (Finishing / QC / Ready for Pickup)", () => {
    for (const legacy of FORBIDDEN_LEGACY) {
      expect(O_STATUSES).not.toContain(legacy);
    }
  });

  it("starts with Art Approval (first stage, customer-facing)", () => {
    expect(O_STATUSES[0]).toBe("Art Approval");
  });

  it("ends with Completed (terminal — preserved forever by trigger from PR #33)", () => {
    expect(O_STATUSES[O_STATUSES.length - 1]).toBe("Completed");
  });

  it("has no duplicates", () => {
    expect(new Set(O_STATUSES).size).toBe(O_STATUSES.length);
  });
});
