import { describe, it, expect } from "vitest";
import { DEPOSITS_ENABLED, depositAmountFor, depositRemaining, depositRequested } from "../deposits";

describe("deposits feature flag", () => {
  it("is ON (deposit path live, docs/deposit-path-design.md)", () => {
    expect(DEPOSITS_ENABLED).toBe(true);
  });
});

describe("depositAmountFor — snapshot-first (lockstep with _shared/qbDeposit.js computeDepositAmount)", () => {
  it("snapshot wins over pct-derivation", () => {
    expect(depositAmountFor({ deposit_amount: 125.5, deposit_pct: 50, total: 1000 })).toBe(125.5);
  });
  it("pct fallback for pre-snapshot docs, 2dp", () => {
    expect(depositAmountFor({ deposit_pct: 50, total: 999.99 })).toBe(500.0);
    expect(depositAmountFor({ deposit_pct: 33, total: 100 })).toBe(33);
  });
  it("no deposit → 0; pct clamped to [0,100]", () => {
    expect(depositAmountFor({ deposit_pct: 0, total: 100 })).toBe(0);
    expect(depositAmountFor({ deposit_pct: 150, total: 100 })).toBe(100);
    expect(depositAmountFor(null)).toBe(0);
  });
});

describe("depositRemaining", () => {
  it("total minus deposit, 2dp", () => {
    expect(depositRemaining({ deposit_amount: 125.5, total: 400 })).toBe(274.5);
  });
  it("clamped at 0 when an edit dropped the total below the deposit (over-collection surfaces as an edit warning, not negative money)", () => {
    expect(depositRemaining({ deposit_amount: 500, total: 400 })).toBe(0);
  });
});

describe("depositRequested", () => {
  it("true for an unpaid requested deposit only", () => {
    expect(depositRequested({ deposit_pct: 50, total: 100, deposit_paid: false })).toBe(true);
    expect(depositRequested({ deposit_amount: 50, deposit_paid: false })).toBe(true);
    expect(depositRequested({ deposit_pct: 50, total: 100, deposit_paid: true })).toBe(false);
    expect(depositRequested({ deposit_pct: 0, total: 100 })).toBe(false);
  });
});
