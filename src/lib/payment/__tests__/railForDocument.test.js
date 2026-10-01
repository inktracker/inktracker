import { describe, it, expect, vi } from "vitest";

vi.mock("@/api/supabaseClient", () => ({ base44: {}, supabase: {} }));
const { railForDocument } = await import("../usePaymentRail.js");

describe("railForDocument — the send screens' per-document rail", () => {
  const live = { rail: "processor", testMode: false };
  const test = { rail: "processor", testMode: true };
  it("live: every document uses Stripe once the shop is on", () => {
    expect(railForDocument(live, { customer_name: "Tahoe Gift Co" })).toBe("processor");
  });
  it("test mode: only TEST/DEMO documents; real customers keep QuickBooks links", () => {
    expect(railForDocument(test, { customer_name: "Tahoe Gift Co" })).toBe("qb");
    expect(railForDocument(test, { customer_name: "TEST Tahoe Gift Co" })).toBe("processor");
  });
  it("QuickBooks shops and unknown status stay QuickBooks", () => {
    expect(railForDocument({ rail: "qb" }, {})).toBe("qb");
    expect(railForDocument(null, {})).toBe("qb");
  });
});
