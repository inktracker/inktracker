import { describe, it, expect } from "vitest";
import {
  isConvertedToOrder,
  quoteAlreadyApproved,
  quoteAlreadyPaid,
} from "../approvalState.js";

describe("isConvertedToOrder", () => {
  it("true on status alone", () => {
    expect(isConvertedToOrder({ status: "Converted to Order" })).toBe(true);
  });

  it("true on converted_order_id alone — the desynced zombie shape", () => {
    expect(isConvertedToOrder({ status: "Approved", converted_order_id: "ORD-1" })).toBe(true);
  });

  it("false when neither signal is set", () => {
    expect(isConvertedToOrder({ status: "Approved" })).toBe(false);
    expect(isConvertedToOrder({ status: "Sent", converted_order_id: null })).toBe(false);
    expect(isConvertedToOrder({})).toBe(false);
    expect(isConvertedToOrder(null)).toBe(false);
    expect(isConvertedToOrder(undefined)).toBe(false);
  });
});

describe("quoteAlreadyApproved", () => {
  it.each(["Approved", "Approved and Paid", "Paid", "Client Approved", "Converted to Order"])(
    "true for status %j",
    (status) => {
      expect(quoteAlreadyApproved({ status })).toBe(true);
    },
  );

  it("true when client_status is Approved even if status moved on (broker mid-flow)", () => {
    expect(quoteAlreadyApproved({ status: "Submitted to Shop", client_status: "Approved" })).toBe(true);
  });

  it("true on converted_order_id regardless of status", () => {
    expect(quoteAlreadyApproved({ status: "Sent", converted_order_id: "ORD-1" })).toBe(true);
  });

  it.each(["Draft", "Sent", "Pending", "Declined", "Expired", undefined])(
    "false for pre-approval status %j",
    (status) => {
      expect(quoteAlreadyApproved({ status })).toBe(false);
    },
  );

  it("false on null/undefined quote", () => {
    expect(quoteAlreadyApproved(null)).toBe(false);
    expect(quoteAlreadyApproved(undefined)).toBe(false);
  });
});

describe("quoteAlreadyPaid — unchanged from the inline QuotePayment logic", () => {
  it.each(["Approved and Paid", "Paid"])("true for status %j", (status) => {
    expect(quoteAlreadyPaid({ status })).toBe(true);
  });

  it("true for Approved + deposit_paid", () => {
    expect(quoteAlreadyPaid({ status: "Approved", deposit_paid: true })).toBe(true);
  });

  it("false for Approved without deposit_paid", () => {
    expect(quoteAlreadyPaid({ status: "Approved" })).toBe(false);
    expect(quoteAlreadyPaid({ status: "Approved", deposit_paid: false })).toBe(false);
  });

  it("false for Converted to Order — the balance may still be owed through the QB link", () => {
    expect(quoteAlreadyPaid({ status: "Converted to Order" })).toBe(false);
  });

  it("false on null quote", () => {
    expect(quoteAlreadyPaid(null)).toBe(false);
  });
});
