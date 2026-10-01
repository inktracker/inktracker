import { describe, it, expect } from "vitest";
import {
  onboardingStage,
  validateQbAccountMapping,
  qbAccountChoices,
  checkCanEnable,
  canTogglePayments,
  canMapQbAccounts,
  canViewPayments,
} from "../paymentsAccount.js";

const ACCTS = [
  { Id: "35", Name: "Checking", FullyQualifiedName: "Checking", AccountType: "Bank" },
  { Id: "36", Name: "Old Savings", AccountType: "Bank", Active: false },
  { Id: "88", Name: "Merchant account fees", FullyQualifiedName: "Bank charges:Merchant account fees", AccountType: "Expense" },
  { Id: "90", Name: "Supplies", AccountType: "Expense" },
  { Id: "4", Name: "Sales", AccountType: "Income" },
];

describe("roles", () => {
  it("owner toggles; managers map accounts; brokers see nothing", () => {
    expect(canTogglePayments({ role: "shop" })).toBe(true);
    expect(canTogglePayments({ role: "admin" })).toBe(true);
    expect(canTogglePayments({ role: "manager" })).toBe(false);
    expect(canMapQbAccounts({ role: "manager" })).toBe(true);
    expect(canMapQbAccounts({ role: "employee" })).toBe(false);
    expect(canViewPayments({ role: "employee" })).toBe(true);
    expect(canViewPayments({ role: "broker" })).toBe(false);
    expect(canViewPayments({ role: "user" })).toBe(false);
    expect(canViewPayments(null)).toBe(false);
  });
});

describe("onboardingStage", () => {
  it("maps merchant state to what the shop sees", () => {
    expect(onboardingStage(null)).toBe("not_started");
    expect(onboardingStage({ merchant_id: null })).toBe("not_started");
    expect(onboardingStage({ merchant_id: "m", merchant_status: "active" })).toBe("active");
    expect(onboardingStage({ merchant_id: "m", merchant_status: "pending", merchant_application_status: "created" })).toBe("in_progress");
    expect(onboardingStage({ merchant_id: "m", merchant_status: "onboarding", merchant_application_status: "processing" })).toBe("in_review");
    expect(onboardingStage({ merchant_id: "m", merchant_status: "onboarding", merchant_application_status: "needs_information" })).toBe("needs_information");
    expect(onboardingStage({ merchant_id: "m", merchant_status: "SUSPENDED" })).toBe("suspended");
    expect(onboardingStage({ merchant_id: "m", merchant_status: "canceled", merchant_application_status: "declined" })).toBe("declined");
    expect(onboardingStage({ merchant_id: "m", merchant_status: "deactivated" })).toBe("declined");
  });
});

describe("validateQbAccountMapping — checked against the live chart of accounts", () => {
  it("accepts a real bank + expense account", () => {
    expect(validateQbAccountMapping({ bankAccountId: "35", feeAccountId: "88", qbAccounts: ACCTS }))
      .toEqual({ ok: true, bankAccountId: "35", feeAccountId: "88" });
  });
  it("refuses wrong types, inactive, or made-up ids", () => {
    expect(validateQbAccountMapping({ bankAccountId: "4", feeAccountId: "88", qbAccounts: ACCTS }).error).toMatch(/isn't a bank account/);
    expect(validateQbAccountMapping({ bankAccountId: "36", feeAccountId: "88", qbAccounts: ACCTS }).ok).toBe(false);
    expect(validateQbAccountMapping({ bankAccountId: "35", feeAccountId: "4", qbAccounts: ACCTS }).error).toMatch(/isn't an expense account/);
    expect(validateQbAccountMapping({ bankAccountId: "999", feeAccountId: "88", qbAccounts: ACCTS }).ok).toBe(false);
    expect(validateQbAccountMapping({ bankAccountId: "35", feeAccountId: "88", qbAccounts: null }).ok).toBe(false);
  });
});

describe("qbAccountChoices", () => {
  it("splits pick-lists, hides inactive, suggests the fee account", () => {
    const c = qbAccountChoices(ACCTS);
    expect(c.banks).toEqual([{ id: "35", name: "Checking" }]);
    expect(c.expenses.map((e) => e.id)).toEqual(["88", "90"]);
    expect(c.suggestedFeeAccountId).toBe("88");
    expect(qbAccountChoices([]).suggestedFeeAccountId).toBeNull();
  });
});

describe("checkCanEnable", () => {
  const acct = { merchant_id: "m", merchant_status: "active", qb_bank_account_id: "35", qb_fee_account_id: "88" };
  const owner = { role: "shop" };
  it("all set → ok", () => {
    expect(checkCanEnable({ envEnabled: true, account: acct, viewer: owner })).toEqual({ ok: true });
  });
  it("each missing piece has its own plain message", () => {
    expect(checkCanEnable({ envEnabled: true, account: acct, viewer: { role: "manager" } }).error).toMatch(/Only the shop owner/);
    expect(checkCanEnable({ envEnabled: false, account: acct, viewer: owner }).error).toMatch(/aren't available/);
    expect(checkCanEnable({ envEnabled: true, account: null, viewer: owner }).error).toMatch(/sign-up/);
    expect(checkCanEnable({ envEnabled: true, account: { ...acct, merchant_status: "canceled" }, viewer: owner }).error).toMatch(/isn't available for InkTracker payments/);
    expect(checkCanEnable({ envEnabled: true, account: { ...acct, qb_bank_account_id: null }, viewer: owner }).error).toMatch(/QuickBooks bank account/);
  });
});

describe("lapsed plan can't switch payments on", () => {
  it("asks the owner to renew", () => {
    const acct = { merchant_id: "m", merchant_status: "active", qb_bank_account_id: "35", qb_fee_account_id: "88" };
    expect(checkCanEnable({ envEnabled: true, account: acct, viewer: { role: "shop" }, payingPlan: false }).error).toMatch(/Renew your plan/);
  });
});
