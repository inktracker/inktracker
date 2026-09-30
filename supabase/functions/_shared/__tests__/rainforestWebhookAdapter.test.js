import { describe, it, expect } from "vitest";
import {
  verifyWebhookSignature,
  routeWebhook,
  webhookDedupeKey,
  payinToEvent,
  refundKind,
} from "../rainforestWebhookAdapter.js";

// Svix's published verification example (docs.svix.com "Verifying manually").
const SVIX = {
  secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
  id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
  timestamp: "1614265330",
  rawBody: '{"test": 2432232314}',
  signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
};

describe("verifyWebhookSignature (Svix scheme)", () => {
  const now = Number(SVIX.timestamp) + 10;
  it("accepts Svix's own known-good example", async () => {
    expect(await verifyWebhookSignature({ ...SVIX, nowSeconds: now })).toEqual({ ok: true });
  });
  it("accepts when one of several signatures matches (key rotation)", async () => {
    const r = await verifyWebhookSignature({ ...SVIX, signature: `v1,AAAA ${SVIX.signature}`, nowSeconds: now });
    expect(r.ok).toBe(true);
  });
  it("rejects a tampered body, wrong secret, or wrong id", async () => {
    expect((await verifyWebhookSignature({ ...SVIX, rawBody: '{"test": 1}', nowSeconds: now })).reason).toBe("signature_mismatch");
    expect((await verifyWebhookSignature({ ...SVIX, secret: "whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", nowSeconds: now })).ok).toBe(false);
    expect((await verifyWebhookSignature({ ...SVIX, id: "msg_other", nowSeconds: now })).ok).toBe(false);
  });
  it("rejects replays outside 5 minutes, missing headers, unconfigured secret", async () => {
    expect((await verifyWebhookSignature({ ...SVIX, nowSeconds: Number(SVIX.timestamp) + 301 })).reason).toBe("timestamp_out_of_tolerance");
    expect((await verifyWebhookSignature({ ...SVIX, signature: null, nowSeconds: now })).reason).toBe("missing_signature_headers");
    expect((await verifyWebhookSignature({ ...SVIX, secret: "", nowSeconds: now })).reason).toBe("no_secret_configured");
    expect((await verifyWebhookSignature({ ...SVIX, signature: "v2,abc", nowSeconds: now })).ok).toBe(false);
  });
});

const payin = (over = {}) => ({
  payin_id: "pyi_1", merchant_id: "mid_1", amount: 228482, method_type: "CARD",
  refundable_amount: 228482, metadata: { inktracker_quote_id: "q" }, updated_at: "2026-10-02T17:00:00Z", ...over,
});

describe("routeWebhook", () => {
  it("payin statuses map to neutral events; pre-capture ones are ignored", () => {
    expect(routeWebhook({ event_type: "payin.processing", data: payin() })).toMatchObject({ route: "payin", event: { kind: "processing", method: "card", amountCents: 228482, payinId: "pyi_1", merchantId: "mid_1" } });
    expect(routeWebhook({ event_type: "payin.succeeded", data: payin({ method_type: "ACH" }) }).event).toMatchObject({ kind: "succeeded", method: "ach" });
    expect(routeWebhook({ event_type: "payin.returned", data: payin() }).event.kind).toBe("returned");
    for (const s of ["created", "authorized", "presenting", "in_review", "expected_deposit_date_updated"]) {
      expect(routeWebhook({ event_type: `payin.${s}`, data: payin() }).route).toBe("ignore");
    }
  });
  it("Apple/Google Pay count as card; Plaid ACH as bank", () => {
    expect(payinToEvent("succeeded", payin({ method_type: "APPLE_PAY" })).method).toBe("card");
    expect(payinToEvent("succeeded", payin({ method_type: "PLAID_ACH" })).method).toBe("ach");
    expect(payinToEvent("succeeded", payin({ method_type: "VENMO" })).method).toBeNull();
  });
  it("refunds/returns/chargebacks re-fetch the payin (authoritative amount + metadata)", () => {
    expect(routeWebhook({ event_type: "refund.succeeded", data: { refund_id: "rfd_1", payin_id: "pyi_1", amount: 5000 } }))
      .toEqual({ route: "fetch_payin", payinId: "pyi_1", kind: "refund", reversalCents: 5000 });
    expect(routeWebhook({ event_type: "refund.processing", data: { payin_id: "pyi_1" } }).route).toBe("ignore");
    expect(routeWebhook({ event_type: "ach_return.created", data: { payin_id: "pyi_1", amount: 129700 } }).kind).toBe("returned");
    expect(routeWebhook({ event_type: "chargeback.dispute_action_required", data: { payin_id: "pyi_1", amount: 100 } }).kind).toBe("disputed");
    expect(routeWebhook({ event_type: "chargeback.lost", data: { payin_id: "pyi_1", amount: 100 } }).kind).toBe("charged_back");
    expect(routeWebhook({ event_type: "chargeback.won", data: { payin_id: "pyi_1" } }).route).toBe("ignore");
  });
  it("merchant + application events update onboarding state", () => {
    expect(routeWebhook({ event_type: "merchant.active", data: { merchant_id: "mid_1", status: "ACTIVE" } }))
      .toEqual({ route: "merchant", merchantId: "mid_1", merchantStatus: "active" });
    expect(routeWebhook({ event_type: "merchant_application.needs_information", data: { merchant_id: "mid_1", status: "NEEDS_INFORMATION" } }))
      .toEqual({ route: "merchant", merchantId: "mid_1", applicationStatus: "needs_information" });
  });
  it("junk is ignored, never thrown on", () => {
    expect(routeWebhook(null).route).toBe("ignore");
    expect(routeWebhook({ event_type: "message.attempt.exhausted", data: {} }).route).toBe("ignore");
  });
});

describe("dedupe + refund size", () => {
  it("dedupes on resource id + event type", () => {
    expect(webhookDedupeKey({ event_type: "payin.succeeded", data: payin() })).toBe("pyi_1:payin.succeeded");
    expect(webhookDedupeKey({ event_type: "refund.succeeded", data: { refund_id: "rfd_9", payin_id: "pyi_1" } })).toBe("rfd_9:refund.succeeded");
    expect(webhookDedupeKey({ event_type: "x", data: {} })).toBeNull();
  });
  it("full vs partial refund from what's left refundable", () => {
    expect(refundKind(payin({ refundable_amount: 0 }))).toBe("refunded");
    expect(refundKind(payin({ refundable_amount: 1000 }))).toBe("partially_refunded");
  });
});
