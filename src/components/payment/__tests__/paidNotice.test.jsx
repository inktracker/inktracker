// @vitest-environment jsdom
//
// "Payment received" is shown only when the server confirms the Checkout;
// a typed ?paid=card gets the pay options back, never a false receipt.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@/api/supabaseClient", () => ({ base44: { functions: { invoke: (...a) => invoke(...a) } } }));
const { PaidNotice } = await import("../OnlinePaymentPanel.jsx");

afterEach(() => { cleanup(); invoke.mockReset(); });

const props = { docType: "quote", id: "q1", token: "tok", paid: { method: "card", sessionId: "cs_test_1" }, fallback: <div>PAY OPTIONS</div> };

describe("PaidNotice", () => {
  it("confirmed card payment → Payment received", async () => {
    invoke.mockResolvedValue({ data: { confirmed: true, state: "paid" } });
    render(<PaidNotice {...props} />);
    expect(await screen.findByText("Payment received")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("stripePayments", { action: "paidStatus", docType: "quote", id: "q1", token: "tok", sessionId: "cs_test_1" });
  });
  it("confirmed bank payment → submitted, clears in days", async () => {
    invoke.mockResolvedValue({ data: { confirmed: true, state: "processing" } });
    render(<PaidNotice {...props} />);
    expect(await screen.findByText("Bank payment submitted")).toBeTruthy();
  });
  it("not confirmed (or the check failed) → the pay options, no receipt", async () => {
    invoke.mockResolvedValue({ data: { confirmed: false } });
    render(<PaidNotice {...props} />);
    expect(await screen.findByText("PAY OPTIONS")).toBeTruthy();
    expect(screen.queryByText("Payment received")).toBeNull();
    cleanup();
    invoke.mockRejectedValue(new Error("network"));
    render(<PaidNotice {...props} />);
    expect(await screen.findByText("PAY OPTIONS")).toBeTruthy();
  });
});
