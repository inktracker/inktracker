import { describe, it, expect } from "vitest";
import {
  chooseQuoteApprovalRecipient,
  chooseArtworkApprovalRecipient,
  chooseQuotePaymentRecipient,
  buildQuoteApprovalEmail,
  buildArtworkApprovalEmail,
  buildQuotePaymentEmail,
} from "../approvalNotificationEmail.js";

// ─────────────────────────────────────────────────────────────────────
// chooseQuoteApprovalRecipient — routing decision
// ─────────────────────────────────────────────────────────────────────

describe("chooseQuoteApprovalRecipient (CQR)", () => {
  it("CQR1 — direct shop quote → shop owner", () => {
    const r = chooseQuoteApprovalRecipient({
      shop_owner: "shop@example.com",
    });
    expect(r).toEqual({
      to: "shop@example.com",
      role: "shop_owner",
      audience_name: "Shop",
    });
  });

  it("CQR2 — broker quote routes to the broker, not the shop", () => {
    // Brokers have to hit Submit to Shop next; the shop won't see it
    // until they do. So the broker is the person who needs the ping.
    const r = chooseQuoteApprovalRecipient({
      shop_owner: "shop@example.com",
      broker_id: "broker-uuid",
      broker_email: "broker@example.com",
      broker_name: "Acme Broker",
    });
    expect(r.role).toBe("broker");
    expect(r.to).toBe("broker@example.com");
    expect(r.audience_name).toBe("Acme Broker");
  });

  it("CQR3 — broker quote without broker_email falls back to shop", () => {
    // Defensive — shouldn't happen but a partial broker row shouldn't
    // produce a null recipient.
    const r = chooseQuoteApprovalRecipient({
      shop_owner: "shop@example.com",
      broker_id: "broker-uuid",
    });
    expect(r.to).toBe("shop@example.com");
    expect(r.role).toBe("shop_owner");
  });

  it("CQR4 — no shop_owner AND no broker → null (don't send)", () => {
    expect(chooseQuoteApprovalRecipient({})).toBe(null);
    expect(chooseQuoteApprovalRecipient(null)).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────
// chooseArtworkApprovalRecipient
// ─────────────────────────────────────────────────────────────────────

describe("chooseArtworkApprovalRecipient (CAR)", () => {
  it("CAR1 — always routes to shop owner (production gatekeeper)", () => {
    const r = chooseArtworkApprovalRecipient({
      shop_owner: "shop@example.com",
      broker_email: "broker@example.com",
    });
    expect(r.role).toBe("shop_owner");
    expect(r.to).toBe("shop@example.com");
  });

  it("CAR2 — no shop_owner → null", () => {
    expect(chooseArtworkApprovalRecipient({})).toBe(null);
    expect(chooseArtworkApprovalRecipient(null)).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildQuoteApprovalEmail
// ─────────────────────────────────────────────────────────────────────

describe("buildQuoteApprovalEmail (BQE)", () => {
  const baseQuote = {
    id: "abc-123",
    quote_id: "Q-2026-100",
    shop_owner: "shop@example.com",
    customer_name: "Jane Customer",
    customer_email: "jane@customer.com",
    total: 1234.56,
  };
  const baseShop = { shop_name: "Biota Mfg" };
  const directRecipient = {
    to: "shop@example.com", role: "shop_owner", audience_name: "Shop",
  };
  const brokerRecipient = {
    to: "broker@example.com", role: "broker", audience_name: "Acme Broker",
  };

  it("BQE1 — direct shop quote: subject names the customer + quote id", () => {
    const r = buildQuoteApprovalEmail({
      quote: baseQuote, shop: baseShop, customer: null, recipient: directRecipient,
    });
    expect(r.subject).toBe("Quote Q-2026-100 approved by Jane Customer");
  });

  it("BQE2 — direct shop quote: CTA goes to /Quotes?id=… in the app", () => {
    const r = buildQuoteApprovalEmail({
      quote: baseQuote, shop: baseShop, customer: null, recipient: directRecipient,
    });
    expect(r.html).toContain("https://www.inktracker.app/Quotes?id=abc-123");
    expect(r.html).toContain("Open Quote in InkTracker");
  });

  it("BQE3 — broker recipient: CTA goes to /BrokerDashboard, NOT /Quotes", () => {
    const r = buildQuoteApprovalEmail({
      quote: baseQuote, shop: baseShop, customer: null, recipient: brokerRecipient,
    });
    expect(r.html).toContain("https://www.inktracker.app/BrokerDashboard");
    expect(r.html).toContain("Open Broker Portal");
    expect(r.html).not.toContain("/Quotes?id=");
  });

  it("BQE4 — reply_to is the customer email, so the shop/broker can reply directly", () => {
    const r = buildQuoteApprovalEmail({
      quote: baseQuote, shop: baseShop, customer: null, recipient: directRecipient,
    });
    expect(r.reply_to).toBe("jane@customer.com");
  });

  it("BQE5 — missing customer_email → reply_to is undefined (no fallback to noise)", () => {
    const q = { ...baseQuote, customer_email: "" };
    const r = buildQuoteApprovalEmail({
      quote: q, shop: baseShop, customer: null, recipient: directRecipient,
    });
    expect(r.reply_to).toBeUndefined();
  });

  it("BQE6 — formats total as USD with two decimals", () => {
    const r = buildQuoteApprovalEmail({
      quote: baseQuote, shop: baseShop, customer: null, recipient: directRecipient,
    });
    expect(r.html).toContain("$1,234.56");
  });

  it("BQE7 — html contains the dark-mode-safe color-scheme meta tag", () => {
    // Lock the email-client compatibility fence in the rendered output
    // so we don't lose it on future template edits.
    const r = buildQuoteApprovalEmail({
      quote: baseQuote, shop: baseShop, customer: null, recipient: directRecipient,
    });
    expect(r.html).toContain('name="color-scheme"');
    expect(r.html).toContain('color:#ffffff !important');
  });

  it("BQE8 — escapes HTML in customer name (XSS guard)", () => {
    const q = { ...baseQuote, customer_name: "<script>alert(1)</script>" };
    const r = buildQuoteApprovalEmail({
      quote: q, shop: baseShop, customer: null, recipient: directRecipient,
    });
    expect(r.html).not.toContain("<script>alert(1)");
    expect(r.html).toContain("&lt;script&gt;");
  });

  it("BQE9 — throws on missing quote (contract)", () => {
    expect(() => buildQuoteApprovalEmail({ recipient: directRecipient })).toThrow(/quote/);
  });

  it("BQE10 — throws on missing recipient (contract)", () => {
    expect(() => buildQuoteApprovalEmail({ quote: baseQuote })).toThrow(/recipient/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildArtworkApprovalEmail
// ─────────────────────────────────────────────────────────────────────

describe("buildArtworkApprovalEmail (BAE)", () => {
  const baseOrder = {
    id: "ord-uuid-9",
    order_id: "ORD-2026-77",
    shop_owner: "shop@example.com",
    customer_name: "Jane Customer",
    job_title: "Spring Drop Tees",
    art_approved_by: "Jane the Manager",
  };
  const recipient = {
    to: "shop@example.com", role: "shop_owner", audience_name: "Shop",
  };

  it("BAE1 — subject names the order id", () => {
    const r = buildArtworkApprovalEmail({ order: baseOrder, shop: null, recipient });
    expect(r.subject).toBe("Artwork approved on order ORD-2026-77");
  });

  it("BAE2 — body shows who approved (art_approved_by)", () => {
    const r = buildArtworkApprovalEmail({ order: baseOrder, shop: null, recipient });
    expect(r.html).toContain("Jane the Manager");
  });

  it("BAE3 — body falls back to customer_name if art_approved_by missing", () => {
    const r = buildArtworkApprovalEmail({
      order: { ...baseOrder, art_approved_by: "" },
      shop: null,
      recipient,
    });
    expect(r.html).toContain("Jane Customer");
  });

  it("BAE4 — CTA goes to /Orders?id=… in the app", () => {
    const r = buildArtworkApprovalEmail({ order: baseOrder, shop: null, recipient });
    expect(r.html).toContain("https://www.inktracker.app/Orders?id=ord-uuid-9");
    expect(r.html).toContain("Open Order in InkTracker");
  });

  it("BAE5 — surfaces the job title when present", () => {
    const r = buildArtworkApprovalEmail({ order: baseOrder, shop: null, recipient });
    expect(r.html).toContain("Spring Drop Tees");
  });

  it("BAE6 — omits the job title row entirely when blank (no empty 'Job:' line)", () => {
    const r = buildArtworkApprovalEmail({
      order: { ...baseOrder, job_title: "" },
      shop: null,
      recipient,
    });
    expect(r.html).not.toMatch(/Job:\s*<\/div>/);
  });

  it("BAE7 — reply_to is undefined (artwork approval doesn't have a customer email handy)", () => {
    const r = buildArtworkApprovalEmail({ order: baseOrder, shop: null, recipient });
    expect(r.reply_to).toBeUndefined();
  });

  it("BAE8 — escapes HTML in job title", () => {
    const r = buildArtworkApprovalEmail({
      order: { ...baseOrder, job_title: "<img src=x onerror=alert(1)>" },
      shop: null,
      recipient,
    });
    expect(r.html).not.toContain("<img src=x");
    expect(r.html).toContain("&lt;img");
  });
});

// ─────────────────────────────────────────────────────────────────────
// chooseQuotePaymentRecipient — same routing as approval
// ─────────────────────────────────────────────────────────────────────

describe("chooseQuotePaymentRecipient (CPR)", () => {
  it("CPR1 — direct shop quote → shop owner (mirrors approval)", () => {
    const r = chooseQuotePaymentRecipient({ shop_owner: "shop@x.com" });
    expect(r?.role).toBe("shop_owner");
  });

  it("CPR2 — broker quote → broker (their client paid, they handle)", () => {
    const r = chooseQuotePaymentRecipient({
      shop_owner: "shop@x.com",
      broker_id: "b1",
      broker_email: "broker@x.com",
    });
    expect(r?.role).toBe("broker");
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildQuotePaymentEmail
// ─────────────────────────────────────────────────────────────────────

describe("buildQuotePaymentEmail (BPE)", () => {
  const baseQuote = {
    id: "abc-123",
    quote_id: "Q-2026-100",
    shop_owner: "shop@example.com",
    customer_name: "Jane Customer",
    customer_email: "jane@customer.com",
    total: 1234.56,
  };
  const shopRecipient = {
    to: "shop@example.com", role: "shop_owner", audience_name: "Shop",
  };
  const brokerRecipient = {
    to: "broker@example.com", role: "broker", audience_name: "Acme Broker",
  };

  it("BPE1 — subject names the amount + customer + quote id", () => {
    const r = buildQuotePaymentEmail({
      quote: baseQuote, shop: null, customer: null, recipient: shopRecipient,
      orderId: "ORD-77", amountPaid: 1234.56,
    });
    expect(r.subject).toContain("$1,234.56");
    expect(r.subject).toContain("Q-2026-100");
    expect(r.subject).toContain("Jane Customer");
  });

  it("BPE2 — when orderId is provided, shop CTA goes to /Orders (not /Quotes)", () => {
    // Payment converts the quote → order; the order is the new
    // authoritative entity. Operators should land there to start
    // production.
    const r = buildQuotePaymentEmail({
      quote: baseQuote, shop: null, customer: null, recipient: shopRecipient,
      orderId: "ORD-77", amountPaid: 1234.56,
    });
    expect(r.html).toContain("https://www.inktracker.app/Orders");
    expect(r.html).toContain("Open Orders in InkTracker");
    expect(r.html).not.toContain("/Quotes?id=");
  });

  it("BPE3 — no orderId (rare race) → falls back to /Quotes link", () => {
    const r = buildQuotePaymentEmail({
      quote: baseQuote, shop: null, customer: null, recipient: shopRecipient,
      amountPaid: 1234.56,
    });
    expect(r.html).toContain(`/Quotes?id=abc-123`);
  });

  it("BPE4 — broker recipient → /BrokerDashboard regardless of orderId", () => {
    const r = buildQuotePaymentEmail({
      quote: baseQuote, shop: null, customer: null, recipient: brokerRecipient,
      orderId: "ORD-77", amountPaid: 1234.56,
    });
    expect(r.html).toContain("https://www.inktracker.app/BrokerDashboard");
    expect(r.html).toContain("Open Broker Portal");
  });

  it("BPE-D1 — kind:'deposit' gets deposit subject + remaining-balance line", () => {
    const r = buildQuotePaymentEmail({
      quote: { ...baseQuote, total: 1000 }, shop: null, customer: null, recipient: shopRecipient,
      orderId: "ORD-77", amountPaid: 400, kind: "deposit",
    });
    expect(r.subject).toContain("Deposit received");
    expect(r.subject).toContain("$400.00");
    expect(r.html).toContain("Remaining balance");
    expect(r.html).toContain("$600.00");
    expect(r.html).not.toContain("paid in full");
  });

  it("BPE-D2 — default kind stays byte-identical to the pre-deposit copy (no regression)", () => {
    const r = buildQuotePaymentEmail({
      quote: baseQuote, shop: null, customer: null, recipient: shopRecipient,
      orderId: "ORD-77", amountPaid: 500,
    });
    expect(r.subject).toContain("Payment received");
    expect(r.subject).not.toContain("Deposit");
  });

  it("BPE5 — amountPaid wins over quote.total when both are present", () => {
    // Deposit case: amountPaid is the actual payment, quote.total is
    // the full quote. Subject + body show what the customer actually
    // paid, not the contract total.
    const r = buildQuotePaymentEmail({
      quote: baseQuote, shop: null, customer: null, recipient: shopRecipient,
      orderId: "ORD-77", amountPaid: 500,
    });
    expect(r.subject).toContain("$500.00");
    expect(r.html).toContain("$500.00");
  });

  it("BPE6 — amountPaid omitted → falls back to quote.total", () => {
    const r = buildQuotePaymentEmail({
      quote: baseQuote, shop: null, customer: null, recipient: shopRecipient,
      orderId: "ORD-77",
    });
    expect(r.subject).toContain("$1,234.56");
  });

  it("BPE7 — reply_to is the customer email so the shop can reply directly", () => {
    const r = buildQuotePaymentEmail({
      quote: baseQuote, shop: null, customer: null, recipient: shopRecipient,
      orderId: "ORD-77", amountPaid: 1234.56,
    });
    expect(r.reply_to).toBe("jane@customer.com");
  });

  it("BPE8 — body surfaces the order id when provided", () => {
    const r = buildQuotePaymentEmail({
      quote: baseQuote, shop: null, customer: null, recipient: shopRecipient,
      orderId: "ORD-77", amountPaid: 1234.56,
    });
    expect(r.html).toContain("ORD-77");
  });

  it("BPE9 — escapes HTML in customer name and orderId (XSS guard)", () => {
    const r = buildQuotePaymentEmail({
      quote: { ...baseQuote, customer_name: "<x>" },
      shop: null, customer: null, recipient: shopRecipient,
      orderId: "<y>", amountPaid: 1234.56,
    });
    expect(r.html).not.toContain("<x>");
    expect(r.html).not.toMatch(/<y><\/strong>/);
    expect(r.html).toContain("&lt;x&gt;");
  });

  it("BPE10 — throws on missing quote / recipient (contract)", () => {
    expect(() => buildQuotePaymentEmail({ recipient: shopRecipient })).toThrow(/quote/);
    expect(() => buildQuotePaymentEmail({ quote: baseQuote })).toThrow(/recipient/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildNotificationLogRow — pure shape contract for the audit row
// ─────────────────────────────────────────────────────────────────────

import { buildNotificationLogRow } from "../approvalNotificationEmail.js";

describe("buildNotificationLogRow (BNLR)", () => {
  it("BNLR1 — copies the required fields verbatim", () => {
    const row = buildNotificationLogRow({
      shop_owner: "shop@x.com",
      event_type: "quote_approval",
      recipient_email: "jane@x.com",
      recipient_role: "broker",
      quote_id: "q-1",
      subject: "Approved",
      status: "sent",
    });
    expect(row).toMatchObject({
      shop_owner: "shop@x.com",
      event_type: "quote_approval",
      recipient_email: "jane@x.com",
      recipient_role: "broker",
      quote_id: "q-1",
      order_id: null,
      subject: "Approved",
      status: "sent",
      failure_reason: null,
      resend_id: null,
    });
  });

  it("BNLR2 — fills nulls for omitted optional fields (jsonb-safe)", () => {
    const row = buildNotificationLogRow({
      shop_owner: "x",
      event_type: "artwork_approval",
      status: "skipped",
    });
    expect(row.recipient_email).toBe("");
    expect(row.recipient_role).toBe(null);
    expect(row.quote_id).toBe(null);
    expect(row.order_id).toBe(null);
    expect(row.subject).toBe(null);
    expect(row.failure_reason).toBe(null);
  });

  it("BNLR3 — preserves failure_reason on failed attempts", () => {
    const row = buildNotificationLogRow({
      shop_owner: "x", event_type: "quote_payment",
      status: "failed", failure_reason: "resend_422",
      recipient_email: "j@x.com",
    });
    expect(row.status).toBe("failed");
    expect(row.failure_reason).toBe("resend_422");
  });
});

// ─────────────────────────────────────────────────────────────────────
// logNotificationAttempt + sendAndLogApprovalNotification
// ─────────────────────────────────────────────────────────────────────

import { logNotificationAttempt, sendAndLogApprovalNotification } from "../approvalNotificationEmail.js";

function makeSupabaseSpy() {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        insert(row) {
          calls.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

describe("logNotificationAttempt (LNA)", () => {
  it("LNA1 — inserts into notification_log with the built row", async () => {
    const sb = makeSupabaseSpy();
    await logNotificationAttempt(sb, {
      shop_owner: "x", event_type: "quote_approval", status: "sent",
      recipient_email: "j@x.com",
    });
    expect(sb.calls.length).toBe(1);
    expect(sb.calls[0].table).toBe("notification_log");
    expect(sb.calls[0].row.shop_owner).toBe("x");
    expect(sb.calls[0].row.status).toBe("sent");
  });

  it("LNA2 — no-op when supabase is null (best-effort)", async () => {
    await expect(
      logNotificationAttempt(null, { shop_owner: "x", event_type: "quote_approval", status: "sent" }),
    ).resolves.toBeUndefined();
  });

  it("LNA3 — no-op when required fields missing (defensive)", async () => {
    const sb = makeSupabaseSpy();
    await logNotificationAttempt(sb, { shop_owner: "x" }); // missing event_type + status
    expect(sb.calls.length).toBe(0);
  });

  it("LNA4 — DB error swallowed (best-effort, doesn't throw)", async () => {
    const sb = {
      from() {
        return { insert: () => Promise.resolve({ error: { message: "down" } }) };
      },
    };
    await expect(
      logNotificationAttempt(sb, {
        shop_owner: "x", event_type: "quote_approval", status: "sent",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("sendAndLogApprovalNotification (SLN)", () => {
  it("SLN1 — no recipient: logs 'skipped' with reason='no_recipient', returns ok:false", async () => {
    const sb = makeSupabaseSpy();
    const result = await sendAndLogApprovalNotification(sb, {
      shop_owner: "x", event_type: "quote_approval", quote_id: "q1",
      to: undefined, subject: "Approved", html: "<x>",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no_recipient");
    expect(sb.calls.length).toBe(1);
    expect(sb.calls[0].row.status).toBe("skipped");
    expect(sb.calls[0].row.failure_reason).toBe("no_recipient");
  });

  it("SLN2 — no API key (Resend unconfigured): logs 'failed' with reason='no_api_key'", async () => {
    // Default Deno.env.get returns undefined in vitest (no Deno),
    // so the send path falls into the no_api_key branch.
    const sb = makeSupabaseSpy();
    const result = await sendAndLogApprovalNotification(sb, {
      shop_owner: "x", event_type: "quote_approval", quote_id: "q1",
      to: "j@x.com", subject: "Approved", html: "<x>", reply_to: "c@x.com",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no_api_key");
    expect(sb.calls.length).toBe(1);
    expect(sb.calls[0].row.status).toBe("failed");
    expect(sb.calls[0].row.failure_reason).toBe("no_api_key");
    expect(sb.calls[0].row.recipient_email).toBe("j@x.com");
    expect(sb.calls[0].row.subject).toBe("Approved");
    expect(sb.calls[0].row.quote_id).toBe("q1");
  });
});

// Spy that also answers the notification_log dedup read used by the
// quote_payment guard. `priorRows` seeds the "have we already sent?"
// lookup; `selectThrows` simulates a DB failure on that read.
function makePaymentSpy({ priorRows = [], selectThrows = false } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        insert(row) {
          calls.push({ table, op: "insert", row });
          return Promise.resolve({ error: null });
        },
        select() {
          const chain = {
            eq() { return chain; },
            limit() {
              calls.push({ table, op: "select" });
              if (selectThrows) return Promise.reject(new Error("db down"));
              return Promise.resolve({ data: priorRows });
            },
          };
          return chain;
        },
      };
    },
  };
}

describe("sendAndLogApprovalNotification — payment dedup (DEDUP)", () => {
  it("DEDUP1 — quote_payment with a prior 'sent' row: returns deduped, sends nothing, logs nothing", async () => {
    const sb = makePaymentSpy({ priorRows: [{ id: "n1" }] });
    const result = await sendAndLogApprovalNotification(sb, {
      shop_owner: "x", event_type: "quote_payment", quote_id: "q1",
      to: "j@x.com", subject: "Paid", html: "<x>", reply_to: "c@x.com",
    });
    expect(result.deduped).toBe(true);
    expect(result.ok).toBe(true);
    // A select happened; no insert (no send, no log row) followed.
    expect(sb.calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("DEDUP2 — quote_payment with no prior row: proceeds to send (not deduped)", async () => {
    const sb = makePaymentSpy({ priorRows: [] });
    const result = await sendAndLogApprovalNotification(sb, {
      shop_owner: "x", event_type: "quote_payment", quote_id: "q1",
      to: "j@x.com", subject: "Paid", html: "<x>", reply_to: "c@x.com",
    });
    expect(result.deduped).toBeUndefined();
    // No Resend key in vitest → send fails; a 'failed' row is still logged.
    expect(sb.calls.some((c) => c.op === "insert")).toBe(true);
  });

  it("DEDUP3 — dedup read failure does NOT block the send (send proceeds)", async () => {
    const sb = makePaymentSpy({ selectThrows: true });
    const result = await sendAndLogApprovalNotification(sb, {
      shop_owner: "x", event_type: "quote_payment", quote_id: "q1",
      to: "j@x.com", subject: "Paid", html: "<x>", reply_to: "c@x.com",
    });
    expect(result.deduped).toBeUndefined();
    expect(sb.calls.some((c) => c.op === "insert")).toBe(true);
  });

  it("DEDUP4 — non-payment event types skip the dedup read entirely", async () => {
    const sb = makePaymentSpy({ priorRows: [{ id: "n1" }] });
    await sendAndLogApprovalNotification(sb, {
      shop_owner: "x", event_type: "quote_approval", quote_id: "q1",
      to: "j@x.com", subject: "Approved", html: "<x>", reply_to: "c@x.com",
    });
    // Guard is scoped to quote_payment, so no select was issued.
    expect(sb.calls.some((c) => c.op === "select")).toBe(false);
  });
});
