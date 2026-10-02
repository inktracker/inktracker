import { describe, it, expect } from "vitest";
import { stripePaymentsHealth } from "../paymentsHealth.js";

const ON = { enabled: true, hasSecretKey: true, hasWebhookSecret: true, liveKey: true };

describe("Stripe payments in the daily health check", () => {
  it("switched off → fine, says so", () => {
    expect(stripePaymentsHealth({ enabled: false })).toEqual({ ok: true, detail: "switched off" });
  });
  it("all booked → fine; test mode says nothing is booked", () => {
    expect(stripePaymentsHealth(ON).ok).toBe(true);
    expect(stripePaymentsHealth({ ...ON, liveKey: false }).detail).toBe("test mode (nothing is booked)");
  });
  it("missing secrets and stuck money are each named", () => {
    const r = stripePaymentsHealth({ ...ON, hasWebhookSecret: false, stuckPayments: 2, unmatched: 1, stuckPayouts: 1 });
    expect(r.ok).toBe(false);
    expect(r.detail).toBe("STRIPE_CONNECT_WEBHOOK_SECRET missing; 2 payments not in QuickBooks after 24h; 1 payment matched to no invoice; 1 payout without a QuickBooks deposit after 6 days");
  });
  it("a refused surcharge shows up", () => {
    expect(stripePaymentsHealth({ ...ON, surchargeRefused: 1 }).detail).toBe("Stripe refused the credit card surcharge on 1 payment (24h)");
  });
});
