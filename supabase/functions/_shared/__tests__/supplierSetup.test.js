// S&S + AS Colour in-app setup — pure state + email builders.
import { describe, it, expect } from "vitest";
import {
  normalizeSupplierSetup,
  ssStep,
  acStep,
  applySsVerified,
  applySsCleared,
  applyAcApiRequested,
  applyAcVerified,
  applyAcCleared,
  applyAcCreditRequested,
  applyAcCreditApproved,
  buildAcApiRequestEmail,
  buildAcCreditRequestEmail,
  AC_API_EMAIL,
  AC_SUPPORT_EMAIL,
} from "../supplierSetup.js";

describe("normalize", () => {
  it("fills a stable shape from garbage", () => {
    expect(normalizeSupplierSetup(null)).toEqual({
      ss: { verified_at: null, verified_account: null },
      ac: { api_requested_at: null, verified_at: null, credit_requested_at: null, credit_approved_at: null },
    });
  });
});

describe("S&S steps", () => {
  it("1 until creds saved, 3 once saved, done once verified", () => {
    expect(ssStep({}, { ss: false })).toBe(1);
    expect(ssStep({}, { ss: true })).toBe(3);
    const v = applySsVerified({}, "12345", "t1");
    expect(v.ss).toEqual({ verified_at: "t1", verified_account: "12345" });
    expect(ssStep(v, { ss: true })).toBe(4);
    // creds removed after verification → back to step 1, verification stale
    expect(ssStep(v, { ss: false })).toBe(1);
    expect(applySsCleared(v).ss.verified_at).toBeNull();
  });
});

describe("AS Colour steps", () => {
  const connected = { ac: true, ac_email: "shop@example.com", ac_password: true };
  it("walks request → enter → verify → credit request → approved", () => {
    expect(acStep({}, {})).toBe(1);
    let o = applyAcApiRequested({}, "t1");
    expect(acStep(o, {})).toBe(2);
    expect(acStep(o, connected)).toBe(3);
    o = applyAcVerified(o, "t2");
    expect(acStep(o, connected)).toBe(4);
    o = applyAcCreditRequested(o, "t3");
    expect(acStep(o, connected)).toBe(5);
    o = applyAcCreditApproved(o, true, "t4");
    expect(o.ac.credit_approved_at).toBe("t4");
    expect(acStep(o, connected)).toBe(6);
    // un-approve
    expect(applyAcCreditApproved(o, false).ac.credit_approved_at).toBeNull();
  });

  it("key-only connection (no password) is not 'connected' — stays on enter step", () => {
    expect(acStep(applyAcApiRequested({}), { ac: true, ac_email: "x", ac_password: false })).toBe(2);
  });

  it("refuses credit-approved before verification; clearing verification drops it back", () => {
    expect(() => applyAcCreditApproved({}, true)).toThrow(/Verify/);
    const o = applyAcCleared(applyAcVerified({}, "t2"));
    expect(o.ac.verified_at).toBeNull();
    expect(acStep(o, connected)).toBe(3);
  });

  it("re-requesting keeps the original request timestamp", () => {
    const o = applyAcApiRequested(applyAcApiRequested({}, "t1"), "t9");
    expect(o.ac.api_requested_at).toBe("t1");
  });
});

describe("emails", () => {
  it("API request goes to the API team with the account email and reply-to", () => {
    const e = buildAcApiRequestEmail({ shopName: "Biota Mfg", ownerName: "Joe", ownerEmail: "owner@example.com", accountEmail: "acct@example.com" });
    expect(AC_API_EMAIL).toBe("api@ascolour.com");
    expect(e.subject).toContain("Biota Mfg");
    expect(e.text).toContain("subscription key");
    expect(e.text).toContain("acct@example.com");
    expect(e.text).toContain("reply to owner@example.com");
    expect(e.html).toContain("Biota Mfg");
  });

  it("credit request goes to support and falls back to the owner email as the account email", () => {
    const e = buildAcCreditRequestEmail({ shopName: "Biota Mfg", ownerEmail: "owner@example.com" });
    expect(AC_SUPPORT_EMAIL).toBe("support@ascolour.com");
    expect(e.text).toContain("credit application");
    expect(e.text).toContain("login email owner@example.com");
  });
});
