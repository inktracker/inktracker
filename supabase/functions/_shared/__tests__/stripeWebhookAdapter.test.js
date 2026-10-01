import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyStripeSignature,
  routeStripeEvent,
  paymentIntentToEvent,
  kindForPaymentIntentStatus,
  accountStatusFields,
  isOurs,
  readStripeList,
} from "../stripeWebhookAdapter.js";
import { PAYIN_EVENT } from "../payinEffect.js";

// Built at run time (low-entropy, so secret scanners don't flag a fixture).
const SECRET = `whsec_${"t".repeat(32)}`;
const sign = (body, t, secret = SECRET) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

describe("verifyStripeSignature", () => {
  const body = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" });
  const t = 1759330000;
  it("accepts Stripe's scheme (HMAC-SHA256 hex over `t.body`)", async () => {
    expect(await verifyStripeSignature({ secret: SECRET, rawBody: body, header: sign(body, t), nowSeconds: t + 10 })).toEqual({ ok: true });
  });
  it("accepts when any of several v1 signatures matches (secret rotation)", async () => {
    const header = `t=${t},v1=${"0".repeat(64)},${sign(body, t).split(",")[1]}`;
    expect((await verifyStripeSignature({ secret: SECRET, rawBody: body, header, nowSeconds: t })).ok).toBe(true);
  });
  it("rejects a changed body, wrong secret, stale timestamp, missing header or secret", async () => {
    expect((await verifyStripeSignature({ secret: SECRET, rawBody: body + " ", header: sign(body, t), nowSeconds: t })).reason).toBe("signature_mismatch");
    expect((await verifyStripeSignature({ secret: SECRET, rawBody: body, header: sign(body, t, `whsec_${"u".repeat(32)}`), nowSeconds: t })).reason).toBe("signature_mismatch");
    expect((await verifyStripeSignature({ secret: SECRET, rawBody: body, header: sign(body, t), nowSeconds: t + 301 })).reason).toBe("timestamp_out_of_tolerance");
    expect((await verifyStripeSignature({ secret: SECRET, rawBody: body, header: null, nowSeconds: t })).reason).toBe("missing_signature_header");
    expect((await verifyStripeSignature({ secret: "", rawBody: body, header: sign(body, t), nowSeconds: t })).reason).toBe("no_secret_configured");
  });
});

const md = { inktracker_doc_type: "quote", inktracker_quote_id: "q-uuid", qb_invoice_id: "3815", pay_kind: "full", quote_number: "Q-1" };
const pi = (over = {}) => ({ id: "pi_1", object: "payment_intent", amount: 112648, amount_received: 112648, created: 1759330000, status: "succeeded", payment_method_types: ["card"], metadata: md, ...over });
const evt = (type, object, over = {}) => ({ id: "evt_1", type, account: "acct_shop", created: 1759330100, data: { object }, ...over });

describe("routeStripeEvent", () => {
  it("card success → SUCCEEDED; bank processing → PROCESSING; ids, amount, method, paidAt carried", () => {
    const r = routeStripeEvent(evt("payment_intent.succeeded", pi()));
    expect(r.route).toBe("payin");
    expect(r.event).toMatchObject({ kind: PAYIN_EVENT.SUCCEEDED, payinId: "pi_1", merchantId: "acct_shop", amountCents: 112648, method: "card", paidAt: "2025-10-01T14:46:40.000Z" });
    const bank = routeStripeEvent(evt("payment_intent.processing", pi({ status: "processing", amount_received: 0, payment_method_types: ["us_bank_account"] })));
    expect(bank.event).toMatchObject({ kind: PAYIN_EVENT.PROCESSING, method: "ach", amountCents: 112648 });
  });

  it("only InkTracker's payments: the shop's own Stripe sales are ignored", () => {
    expect(routeStripeEvent(evt("payment_intent.succeeded", pi({ metadata: { order: "shopify-1001" } })))).toEqual({ route: "ignore", reason: "not_inktracker" });
    expect(isOurs({})).toBe(false);
    expect(isOurs(md)).toBe(true);
  });

  it("platform events (no account) are ignored", () => {
    expect(routeStripeEvent({ ...evt("payment_intent.succeeded", pi()), account: undefined }).route).toBe("ignore");
  });

  it("a declined card is a retry on the same payment → ignored; a failed bank payment → FAILED", () => {
    expect(routeStripeEvent(evt("payment_intent.payment_failed", pi({ status: "requires_payment_method" })))).toEqual({ route: "ignore", reason: "card_decline_retry" });
    expect(routeStripeEvent(evt("payment_intent.payment_failed", pi({ payment_method_types: ["us_bank_account"] }))).event.kind).toBe(PAYIN_EVENT.FAILED);
  });

  it("refunds: full vs partial, and only THIS refund's size (from previous_attributes)", () => {
    const partial = routeStripeEvent({ ...evt("charge.refunded", { payment_intent: "pi_1", amount: 112648, amount_refunded: 30000, refunded: false }), data: { object: { payment_intent: "pi_1", amount: 112648, amount_refunded: 30000, refunded: false }, previous_attributes: { amount_refunded: 10000 } } });
    expect(partial).toMatchObject({ route: "fetch_payin", payinId: "pi_1", kind: PAYIN_EVENT.PARTIALLY_REFUNDED, reversalCents: 20000, merchantId: "acct_shop" });
    const full = routeStripeEvent(evt("charge.refunded", { payment_intent: "pi_1", amount_refunded: 112648, refunded: true }));
    expect(full).toMatchObject({ kind: PAYIN_EVENT.REFUNDED, reversalCents: 112648 });
  });

  it("disputes: opened → fetched (card = dispute, bank = return); lost → charged back; won → good news", () => {
    expect(routeStripeEvent(evt("charge.dispute.created", { payment_intent: "pi_1", amount: 112648 }))).toMatchObject({ route: "fetch_payin", kind: "dispute_opened", reversalCents: 112648 });
    expect(routeStripeEvent(evt("charge.dispute.closed", { payment_intent: "pi_1", amount: 112648, status: "lost" })).kind).toBe(PAYIN_EVENT.CHARGED_BACK);
    expect(routeStripeEvent(evt("charge.dispute.closed", { payment_intent: "pi_1", amount: 112648, status: "won" }))).toMatchObject({ route: "dispute_won", payinId: "pi_1" });
  });

  it("payouts, account changes, disconnects", () => {
    expect(routeStripeEvent(evt("payout.paid", { id: "po_1" }))).toEqual({ route: "payout", payoutId: "po_1", status: "paid", merchantId: "acct_shop" });
    expect(routeStripeEvent(evt("payout.failed", { id: "po_1" })).status).toBe("failed");
    expect(routeStripeEvent(evt("account.updated", { id: "acct_shop" }))).toEqual({ route: "merchant", merchantId: "acct_shop" });
    expect(routeStripeEvent(evt("account.application.deauthorized", {}))).toEqual({ route: "deauthorized", merchantId: "acct_shop" });
    expect(routeStripeEvent(evt("customer.created", {})).route).toBe("ignore");
  });
});

describe("backstop helpers", () => {
  it("PaymentIntent status → kind", () => {
    expect(kindForPaymentIntentStatus("succeeded")).toBe(PAYIN_EVENT.SUCCEEDED);
    expect(kindForPaymentIntentStatus("processing")).toBe(PAYIN_EVENT.PROCESSING);
    expect(kindForPaymentIntentStatus("requires_payment_method")).toBeNull();
  });
  it("method from the expanded charge when present", () => {
    expect(paymentIntentToEvent("succeeded", pi({ latest_charge: { payment_method_details: { type: "us_bank_account" } } }), "acct").method).toBe("ach");
  });
  it("list paging", () => {
    expect(readStripeList({ data: [{ id: "a" }, { id: "b" }], has_more: true })).toEqual({ items: [{ id: "a" }, { id: "b" }], hasMore: true, lastId: "b" });
    expect(readStripeList(null)).toEqual({ items: [], hasMore: false, lastId: null });
  });
});

describe("accountStatusFields → the Account → Payments stage", () => {
  const acct = (o = {}) => ({ id: "acct_1", charges_enabled: false, payouts_enabled: false, details_submitted: false, requirements: { currently_due: [], past_due: [], disabled_reason: null }, ...o });
  it("maps each Stripe state", () => {
    expect(accountStatusFields(acct())).toEqual({ merchant_status: "pending", merchant_application_status: "in_progress" });
    expect(accountStatusFields(acct({ details_submitted: true, requirements: { currently_due: ["individual.verification.document"], past_due: [] } }))).toEqual({ merchant_status: "onboarding", merchant_application_status: "needs_information" });
    expect(accountStatusFields(acct({ details_submitted: true, requirements: { disabled_reason: "requirements.pending_verification" } }))).toEqual({ merchant_status: "onboarding", merchant_application_status: "in_review" });
    expect(accountStatusFields(acct({ details_submitted: true, charges_enabled: true, payouts_enabled: true }))).toEqual({ merchant_status: "active", merchant_application_status: "completed" });
    expect(accountStatusFields(acct({ requirements: { disabled_reason: "rejected.fraud" } }))).toEqual({ merchant_status: "deactivated", merchant_application_status: "declined" });
    expect(accountStatusFields(acct({ details_submitted: true, requirements: { disabled_reason: "platform_paused" } })).merchant_status).toBe("suspended");
    expect(accountStatusFields({ id: "acct_1", deleted: true }).merchant_status).toBe("canceled");
  });
});
