import { describe, it, expect, vi, beforeEach } from "vitest";

// M4 (audit 2026-10-02): a deposit-paid webhook that collects the money and
// flips deposit_paid but FAILS the quote→order conversion used to swallow the
// throw and log status:"success" — deposit collected, NO order, and never
// repaired (the backstop scans deposit_paid=false only). Pin the new contract:
// status:"error" with the conversion message, shop notified, flip NOT reverted
// (the payment is real), handled:true so the webhook claim stays committed.

const logEvent = vi.fn(async () => {});
const insertShopNotification = vi.fn(async () => {});
const convertQuoteToOrder = vi.fn();

vi.mock("../qbAudit.js", () => ({ logEvent: (...a) => logEvent(...a) }));
vi.mock("../notifications.js", () => ({ insertShopNotification: (...a) => insertShopNotification(...a) }));
vi.mock("../qbConvertQuote.js", () => ({ convertQuoteToOrder: (...a) => convertQuoteToOrder(...a) }));
vi.mock("../approvalNotificationEmail.js", () => ({
  chooseQuotePaymentRecipient: () => null,
  buildQuotePaymentEmail: () => null,
  sendAndLogApprovalNotification: vi.fn(async () => {}),
}));

import { processDepositInvoicePaid } from "../qbDepositPaid.js";

// Minimal chainable fake: quotes.update → returns the updated row (flip wins);
// orders.update → success. Records every update payload per table.
function fakeSupabase() {
  const writes = [];
  const makeChain = (table) => {
    const chain = {
      _table: table,
      update(payload) { writes.push({ table, payload }); return chain; },
      select() { return chain; },
      eq() { return chain; },
      is() { return chain; },
      maybeSingle: async () => (table === "quotes" ? { data: { id: "q1" }, error: null } : { data: null, error: null }),
      then(resolve) { resolve({ data: null, error: null }); }, // awaited chains without maybeSingle
    };
    return chain;
  };
  return { from: (t) => makeChain(t), _writes: writes };
}

const quote = {
  id: "q1", quote_id: "Q-2026-TEST", shop_owner: "shop@x.com",
  deposit_paid: false, converted_order_id: null, qb_deposit_invoice_id: "55",
};

beforeEach(() => {
  logEvent.mockClear();
  insertShopNotification.mockClear();
  convertQuoteToOrder.mockReset();
});

describe("processDepositInvoicePaid — conversion failure is LOUD (M4)", () => {
  it("conversion throw → logEvent status 'error' with the message, shop notified, handled:true", async () => {
    convertQuoteToOrder.mockRejectedValue(new Error("orders.insert failed: RLS"));
    const sb = fakeSupabase();
    const r = await processDepositInvoicePaid(sb, {
      quote, qbInvoiceId: "55", shopOwner: "shop@x.com",
      qbInvoice: { TotalAmt: 100, Balance: 0 }, source: "webhook",
    });
    expect(r.handled).toBe(true);
    expect(r.orderId).toBeNull();
    const ev = logEvent.mock.calls.at(-1)[1];
    expect(ev.status).toBe("error");
    expect(ev.error_message).toMatch(/conversion failed/i);
    expect(ev.error_message).toMatch(/RLS/);
    expect(insertShopNotification).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: "deposit_paid_conversion_failed",
      severity: "error",
    }));
    // The deposit flip is NOT reverted — the money was collected.
    expect(sb._writes.some((w) => w.table === "quotes")).toBe(true);
  });

  it("successful conversion still logs success (no regression)", async () => {
    convertQuoteToOrder.mockResolvedValue("ORD-9");
    const sb = fakeSupabase();
    const r = await processDepositInvoicePaid(sb, {
      quote, qbInvoiceId: "55", shopOwner: "shop@x.com",
      qbInvoice: { TotalAmt: 100, Balance: 0 }, source: "webhook",
    });
    expect(r.orderId).toBe("ORD-9");
    const ev = logEvent.mock.calls.at(-1)[1];
    expect(ev.status).toBe("success");
    expect(insertShopNotification).not.toHaveBeenCalled();
  });
});
