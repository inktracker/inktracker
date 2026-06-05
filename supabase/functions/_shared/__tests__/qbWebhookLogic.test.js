import { describe, it, expect } from "vitest";
import {
  buildPaidInvoiceQuery,
  buildPaidInvoiceQueryFromInvoices,
  cascadeMarkLinkedPaid,
  cascadeMarkInvoicePaid,
  decidePaidInvoiceAction,
  buildOrderInsertFromQuote,
  extractInvoiceIdsFromPayment,
  isInvoiceFullyPaid,
  PAID_INVOICE_ACTIONS,
} from "../qbWebhookLogic.js";

// ─── Mock supabase chain that records every .from/.select/.eq call ───────────
//
// Mirrors the supabase-js fluent builder shape just enough for the
// queries this module produces. Returns a fake { data, error } from
// maybeSingle() based on a seeded list of "quote" rows. Every .eq()
// is recorded so tests can assert tenant-scoping is in place.

function mockSupabase(quotes = []) {
  const calls = { from: [], select: [], eqs: [], maybeSingleCalled: 0 };
  const matches = (q, eqs) => eqs.every(([col, val]) => q?.[col] === val);

  function chain(filters = []) {
    return {
      eq(col, val) {
        const next = [...filters, [col, val]];
        calls.eqs.push([col, val]);
        return chain(next);
      },
      async maybeSingle() {
        calls.maybeSingleCalled += 1;
        const found = quotes.find((q) => matches(q, filters));
        return { data: found ?? null, error: null };
      },
    };
  }

  return {
    from(table) {
      calls.from.push(table);
      return {
        select(cols) {
          calls.select.push(cols);
          return chain();
        },
      };
    },
    _calls: calls,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// buildPaidInvoiceQuery — the tenant-scoping bug fix
// ════════════════════════════════════════════════════════════════════════════

describe("buildPaidInvoiceQuery — cross-tenant isolation", () => {
  it("returns the matching quote when invoice id AND shop_owner both match", async () => {
    const sb = mockSupabase([
      { id: "q1", qb_invoice_id: "1042", shop_owner: "shopA@example.com" },
    ]);
    const { data } = await buildPaidInvoiceQuery(sb, "1042", "shopA@example.com");
    expect(data).toEqual({
      id: "q1",
      qb_invoice_id: "1042",
      shop_owner: "shopA@example.com",
    });
  });

  it("does NOT return Shop B's quote when Shop A's invoice id collides — the bug fix", async () => {
    // Two shops with QB invoices that happen to share id "1042" — this
    // is realistic because QB invoice ids are realm-scoped, not
    // globally unique. Pre-fix code returned Shop B's quote when
    // queried for Shop A's invoice.
    const sb = mockSupabase([
      { id: "shopB-quote", qb_invoice_id: "1042", shop_owner: "shopB@example.com" },
      { id: "shopA-quote", qb_invoice_id: "1042", shop_owner: "shopA@example.com" },
    ]);
    const { data } = await buildPaidInvoiceQuery(sb, "1042", "shopA@example.com");
    expect(data?.id).toBe("shopA-quote");
    expect(data?.shop_owner).toBe("shopA@example.com");
  });

  it("returns null when invoice id matches but shop_owner does not", async () => {
    const sb = mockSupabase([
      { id: "shopB-quote", qb_invoice_id: "1042", shop_owner: "shopB@example.com" },
    ]);
    const { data } = await buildPaidInvoiceQuery(sb, "1042", "shopA@example.com");
    expect(data).toBeNull();
  });

  it("returns null when shop_owner matches but invoice id does not", async () => {
    const sb = mockSupabase([
      { id: "shopA-quote", qb_invoice_id: "9999", shop_owner: "shopA@example.com" },
    ]);
    const { data } = await buildPaidInvoiceQuery(sb, "1042", "shopA@example.com");
    expect(data).toBeNull();
  });

  it("issues exactly one query against the quotes table", async () => {
    const sb = mockSupabase([]);
    await buildPaidInvoiceQuery(sb, "1042", "shopA@example.com");
    expect(sb._calls.from).toEqual(["quotes"]);
    expect(sb._calls.maybeSingleCalled).toBe(1);
  });

  it("applies BOTH .eq filters in a single query (regression guard)", async () => {
    const sb = mockSupabase([]);
    await buildPaidInvoiceQuery(sb, "1042", "shopA@example.com");
    // Order doesn't matter, just that both filters are present.
    const eqMap = Object.fromEntries(sb._calls.eqs);
    expect(eqMap.qb_invoice_id).toBe("1042");
    expect(eqMap.shop_owner).toBe("shopA@example.com");
    expect(sb._calls.eqs).toHaveLength(2);
  });

  it("throws when qbInvoiceId is missing — defensive guard", () => {
    expect(() => buildPaidInvoiceQuery(mockSupabase(), "", "shopA@example.com")).toThrow(/qbInvoiceId required/);
    expect(() => buildPaidInvoiceQuery(mockSupabase(), null, "shopA@example.com")).toThrow(/qbInvoiceId required/);
  });

  it("throws when shopOwner is missing — defensive guard against tenant-scope bypass", () => {
    expect(() => buildPaidInvoiceQuery(mockSupabase(), "1042", "")).toThrow(/shopOwner required/);
    expect(() => buildPaidInvoiceQuery(mockSupabase(), "1042", null)).toThrow(/shopOwner required/);
    expect(() => buildPaidInvoiceQuery(mockSupabase(), "1042", undefined)).toThrow(/shopOwner required/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// decidePaidInvoiceAction — idempotency + sanity
// ════════════════════════════════════════════════════════════════════════════

describe("decidePaidInvoiceAction", () => {
  it("returns SKIP_NOT_FOUND for null input", () => {
    expect(decidePaidInvoiceAction(null).action).toBe(PAID_INVOICE_ACTIONS.SKIP_NOT_FOUND);
    expect(decidePaidInvoiceAction(undefined).action).toBe(PAID_INVOICE_ACTIONS.SKIP_NOT_FOUND);
  });

  it("returns SKIP_INVALID_QUOTE when quote has no id", () => {
    const r = decidePaidInvoiceAction({ shop_owner: "x@y.com" });
    expect(r.action).toBe(PAID_INVOICE_ACTIONS.SKIP_INVALID_QUOTE);
  });

  it("returns SKIP_INVALID_QUOTE when quote has no shop_owner — refuses to write tenant-less data", () => {
    const r = decidePaidInvoiceAction({ id: "q1" });
    expect(r.action).toBe(PAID_INVOICE_ACTIONS.SKIP_INVALID_QUOTE);
  });

  it("returns SKIP_ALREADY_CONVERTED when status is 'Converted to Order' AND quote.paid is true (true idempotency)", () => {
    const r = decidePaidInvoiceAction({
      id: "q1",
      shop_owner: "x@y.com",
      status: "Converted to Order",
      paid: true,
    });
    expect(r.action).toBe(PAID_INVOICE_ACTIONS.SKIP_ALREADY_CONVERTED);
  });

  it("returns SKIP_ALREADY_CONVERTED when converted_order_id is set AND paid, even if status drifted", () => {
    // QB might fire a duplicate webhook before status is updated, OR a
    // user might manually edit the status. converted_order_id is the
    // authoritative idempotency key.
    const r = decidePaidInvoiceAction({
      id: "q1",
      shop_owner: "x@y.com",
      status: "Quote Sent",
      converted_order_id: "ORD-001",
      paid: true,
    });
    expect(r.action).toBe(PAID_INVOICE_ACTIONS.SKIP_ALREADY_CONVERTED);
  });

  it("returns MARK_LINKED_PAID when converted but quote.paid is false — the approve→convert→pay-later scenario", () => {
    // Quote was manually converted before payment, customer paid later
    // in QB. The webhook should NOT skip — it should cascade-mark paid.
    const r = decidePaidInvoiceAction({
      id: "q1",
      shop_owner: "x@y.com",
      status: "Converted to Order",
      converted_order_id: "ORD-001",
      paid: false,
    });
    expect(r.action).toBe(PAID_INVOICE_ACTIONS.MARK_LINKED_PAID);
  });

  it("returns MARK_LINKED_PAID when converted_order_id set + paid undefined (legacy unpaid)", () => {
    // Legacy rows that pre-date the paid column treat paid as falsy
    // → should still cascade rather than skip silently.
    const r = decidePaidInvoiceAction({
      id: "q1",
      shop_owner: "x@y.com",
      converted_order_id: "ORD-002",
    });
    expect(r.action).toBe(PAID_INVOICE_ACTIONS.MARK_LINKED_PAID);
  });

  it("returns CONVERT for an active quote", () => {
    const r = decidePaidInvoiceAction({
      id: "q1",
      shop_owner: "x@y.com",
      status: "Quote Sent",
    });
    expect(r.action).toBe(PAID_INVOICE_ACTIONS.CONVERT);
  });

  it("returns CONVERT even when status is empty/null (legacy quotes)", () => {
    const r = decidePaidInvoiceAction({
      id: "q1",
      shop_owner: "x@y.com",
    });
    expect(r.action).toBe(PAID_INVOICE_ACTIONS.CONVERT);
  });

  it("never throws on garbage input (defensive — the webhook must keep processing other notifications)", () => {
    expect(() => decidePaidInvoiceAction({})).not.toThrow();
    expect(() => decidePaidInvoiceAction(0)).not.toThrow();
    expect(() => decidePaidInvoiceAction("not-a-quote")).not.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// buildOrderInsertFromQuote — preserves tenant + handles broker tax
// ════════════════════════════════════════════════════════════════════════════

describe("buildOrderInsertFromQuote", () => {
  const baseQuote = {
    id: "q1",
    quote_id: "Q-001",
    shop_owner: "shopA@example.com",
    customer_id: "cust-1",
    customer_name: "Acme Co",
    job_title: "T-shirts",
    date: "2026-05-01",
    line_items: [{ id: 1 }],
    notes: "rush",
    rush_rate: 0.2,
    extras: [],
    discount: 0,
    tax_rate: 0.0875,
    subtotal: "100.00",
    tax: "8.75",
    total: "108.75",
  };

  it("preserves the quote's shop_owner on the order — defense in depth", () => {
    // Even if the lookup query somehow returned the wrong tenant's
    // quote, the order would still be filed against the QUOTE's
    // shop_owner — never against any caller-supplied or context-
    // derived value.
    const row = buildOrderInsertFromQuote(baseQuote, "ORD-001");
    expect(row.shop_owner).toBe("shopA@example.com");
  });

  it("zeroes tax_rate for broker-submitted quotes (broker_id present)", () => {
    const row = buildOrderInsertFromQuote(
      { ...baseQuote, broker_id: "broker-1" },
      "ORD-001",
    );
    expect(row.tax_rate).toBe(0);
  });

  it("zeroes tax_rate for broker-submitted quotes (broker_email only)", () => {
    const row = buildOrderInsertFromQuote(
      { ...baseQuote, broker_email: "broker@example.com" },
      "ORD-001",
    );
    expect(row.tax_rate).toBe(0);
  });

  it("preserves the original tax_rate for non-broker quotes", () => {
    const row = buildOrderInsertFromQuote(baseQuote, "ORD-001");
    expect(row.tax_rate).toBe(0.0875);
  });

  it("populates broker_client_name from customer_name only when the quote is from a broker", () => {
    const brokerRow = buildOrderInsertFromQuote(
      { ...baseQuote, broker_id: "b1" },
      "ORD-001",
    );
    expect(brokerRow.broker_client_name).toBe("Acme Co");

    const directRow = buildOrderInsertFromQuote(baseQuote, "ORD-001");
    expect(directRow.broker_client_name).toBe("");
  });

  it("parses string totals and falls back to subtotal+tax when total is missing", () => {
    const row = buildOrderInsertFromQuote(
      { ...baseQuote, total: undefined },
      "ORD-001",
    );
    expect(row.subtotal).toBe(100);
    expect(row.tax).toBe(8.75);
    expect(row.total).toBeCloseTo(108.75, 5);
  });

  it("handles non-numeric/garbage money fields without producing NaN", () => {
    const row = buildOrderInsertFromQuote(
      { ...baseQuote, subtotal: "abc", tax: null, total: undefined },
      "ORD-001",
    );
    // NaN in a money field would silently corrupt the books — must coerce to 0.
    expect(row.subtotal).toBe(0);
    expect(row.tax).toBe(0);
    expect(row.total).toBe(0);
  });

  it("sets status='Art Approval' and paid=false on every new order", () => {
    const row = buildOrderInsertFromQuote(baseQuote, "ORD-001");
    expect(row.status).toBe("Art Approval");
    expect(row.paid).toBe(false);
  });

  it("uses the provided orderId on the row", () => {
    const row = buildOrderInsertFromQuote(baseQuote, "ORD-XYZ");
    expect(row.order_id).toBe("ORD-XYZ");
  });

  it("throws when the quote has no shop_owner — refuses to write tenant-less rows", () => {
    expect(() =>
      buildOrderInsertFromQuote({ id: "q1" }, "ORD-001"),
    ).toThrow(/shop_owner required/);
  });

  it("throws when quote.id is missing — required for the post-insert quote update", () => {
    expect(() =>
      buildOrderInsertFromQuote({ shop_owner: "x@y.com" }, "ORD-001"),
    ).toThrow(/quote.id required/);
  });

  it("throws when orderId is missing", () => {
    expect(() =>
      buildOrderInsertFromQuote(baseQuote, ""),
    ).toThrow(/orderId required/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// extractInvoiceIdsFromPayment — QB Payment payload parsing
// ════════════════════════════════════════════════════════════════════════════

describe("extractInvoiceIdsFromPayment", () => {
  it("returns empty array for null/undefined/missing Line", () => {
    expect(extractInvoiceIdsFromPayment(null)).toEqual([]);
    expect(extractInvoiceIdsFromPayment(undefined)).toEqual([]);
    expect(extractInvoiceIdsFromPayment({})).toEqual([]);
    expect(extractInvoiceIdsFromPayment({ Line: [] })).toEqual([]);
  });

  it("extracts a single invoice id from a one-line payment", () => {
    const payment = {
      Line: [{ LinkedTxn: [{ TxnType: "Invoice", TxnId: "1042" }] }],
    };
    expect(extractInvoiceIdsFromPayment(payment)).toEqual(["1042"]);
  });

  it("extracts multiple invoice ids when one payment covers multiple invoices", () => {
    const payment = {
      Line: [
        { LinkedTxn: [{ TxnType: "Invoice", TxnId: "1042" }] },
        { LinkedTxn: [{ TxnType: "Invoice", TxnId: "1043" }] },
      ],
    };
    expect(extractInvoiceIdsFromPayment(payment)).toEqual(["1042", "1043"]);
  });

  it("ignores non-Invoice TxnTypes (e.g. CreditMemo, JournalEntry)", () => {
    const payment = {
      Line: [
        { LinkedTxn: [{ TxnType: "CreditMemo",   TxnId: "c-1" }] },
        { LinkedTxn: [{ TxnType: "JournalEntry", TxnId: "j-1" }] },
        { LinkedTxn: [{ TxnType: "Invoice",      TxnId: "1042" }] },
      ],
    };
    expect(extractInvoiceIdsFromPayment(payment)).toEqual(["1042"]);
  });

  it("ignores LinkedTxn entries with no TxnId (defensive)", () => {
    const payment = {
      Line: [{ LinkedTxn: [{ TxnType: "Invoice" }] }],
    };
    expect(extractInvoiceIdsFromPayment(payment)).toEqual([]);
  });

  it("coerces numeric TxnIds to strings (QB sometimes sends numbers)", () => {
    const payment = {
      Line: [{ LinkedTxn: [{ TxnType: "Invoice", TxnId: 1042 }] }],
    };
    expect(extractInvoiceIdsFromPayment(payment)).toEqual(["1042"]);
  });

  it("handles a Line with empty LinkedTxn array", () => {
    const payment = { Line: [{ LinkedTxn: [] }, { LinkedTxn: [{ TxnType: "Invoice", TxnId: "x" }] }] };
    expect(extractInvoiceIdsFromPayment(payment)).toEqual(["x"]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// isInvoiceFullyPaid — Balance interpretation
// ════════════════════════════════════════════════════════════════════════════

describe("isInvoiceFullyPaid", () => {
  it("returns true when TotalAmt > 0 AND Balance is exactly 0", () => {
    expect(isInvoiceFullyPaid({ TotalAmt: 100, Balance: 0 })).toBe(true);
  });

  it("returns true when Balance is the string '0' (QB sometimes serializes as string)", () => {
    expect(isInvoiceFullyPaid({ TotalAmt: 100, Balance: "0" })).toBe(true);
    expect(isInvoiceFullyPaid({ TotalAmt: "100", Balance: "0.00" })).toBe(true);
  });

  it("returns false when Balance > 0 (still owes)", () => {
    expect(isInvoiceFullyPaid({ TotalAmt: 100, Balance: 1 })).toBe(false);
    expect(isInvoiceFullyPaid({ TotalAmt: 200, Balance: "108.75" })).toBe(false);
  });

  it("returns false when Balance is missing — conservative default", () => {
    expect(isInvoiceFullyPaid({})).toBe(false);
    expect(isInvoiceFullyPaid({ Balance: undefined })).toBe(false);
    expect(isInvoiceFullyPaid({ Balance: null })).toBe(false);
  });

  it("returns false for null/undefined invoice", () => {
    expect(isInvoiceFullyPaid(null)).toBe(false);
    expect(isInvoiceFullyPaid(undefined)).toBe(false);
  });

  it("returns false when Balance is non-numeric (refuses to silently treat as paid)", () => {
    expect(isInvoiceFullyPaid({ Balance: "abc" })).toBe(false);
    expect(isInvoiceFullyPaid({ Balance: NaN })).toBe(false);
  });

  it("returns false when TotalAmt is 0 (draft invoice with no lines) even if Balance is 0", () => {
    // Stray Update webhooks on a blank draft would otherwise trigger
    // conversion. Same guard isQbInvoicePaid applies on the write side.
    expect(isInvoiceFullyPaid({ TotalAmt: 0, Balance: 0 })).toBe(false);
    expect(isInvoiceFullyPaid({ Balance: 0 })).toBe(false); // missing TotalAmt → not paid
  });

  it("treats negative Balance (overpayment / credit) as NOT fully paid", () => {
    // Negative balance means QB has more from the customer than owed —
    // typically a credit on file. We don't auto-convert in that case.
    expect(isInvoiceFullyPaid({ Balance: -1 })).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// buildPaidInvoiceQueryFromInvoices — second-pass lookup for orders that
// don't have a quote (runOrderCompletion created invoice independently)
// ════════════════════════════════════════════════════════════════════════════

describe("buildPaidInvoiceQueryFromInvoices — tenant-scoped invoice lookup", () => {
  it("queries the INVOICES table (not quotes)", async () => {
    const sb = mockSupabase([{ id: "inv1", qb_invoice_id: "1042", shop_owner: "shopA@example.com" }]);
    await buildPaidInvoiceQueryFromInvoices(sb, "1042", "shopA@example.com");
    expect(sb._calls.from).toContain("invoices");
    expect(sb._calls.from).not.toContain("quotes");
  });

  it("scopes by both qb_invoice_id AND shop_owner (cross-tenant safety)", async () => {
    const sb = mockSupabase([
      { id: "shopB-inv", qb_invoice_id: "1042", shop_owner: "shopB@example.com" },
      { id: "shopA-inv", qb_invoice_id: "1042", shop_owner: "shopA@example.com" },
    ]);
    const { data } = await buildPaidInvoiceQueryFromInvoices(sb, "1042", "shopA@example.com");
    expect(data?.id).toBe("shopA-inv");
  });

  it("returns null when no invoice matches", async () => {
    const sb = mockSupabase([]);
    const { data } = await buildPaidInvoiceQueryFromInvoices(sb, "1042", "shopA@example.com");
    expect(data).toBeNull();
  });

  it("throws on missing qbInvoiceId", () => {
    expect(() => buildPaidInvoiceQueryFromInvoices(mockSupabase(), "", "x@y.com")).toThrow(/qbInvoiceId required/);
  });

  it("throws on missing shopOwner — tenant-scope bypass guard", () => {
    expect(() => buildPaidInvoiceQueryFromInvoices(mockSupabase(), "1042", "")).toThrow(/shopOwner required/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// cascadeMarkLinkedPaid / cascadeMarkInvoicePaid — payment cascade logic
//
// Richer mock that simulates a multi-table database with maybeSingle()
// reads + update() writes. Records every shop_owner filter so tests can
// pin cross-tenant safety on EVERY write.
// ════════════════════════════════════════════════════════════════════════════

function mockDb(initial = {}) {
  // initial: { quotes: [...], orders: [...], invoices: [...] }
  const tables = {
    quotes:   [...(initial.quotes   || [])],
    orders:   [...(initial.orders   || [])],
    invoices: [...(initial.invoices || [])],
  };
  const writes = []; // every update — for cross-tenant assertions

  function chain(tableName, op, filters = [], patch = null) {
    return {
      eq(col, val) {
        return chain(tableName, op, [...filters, [col, val]], patch);
      },
      async maybeSingle() {
        const row = tables[tableName].find((r) =>
          filters.every(([c, v]) => r?.[c] === v),
        );
        return { data: row ?? null, error: null };
      },
      // .update().eq().eq()... returns a Promise that yields { error: null }
      // when awaited at the end of the chain. We model this by giving the
      // chain a .then so await works without an explicit terminator.
      then(resolve) {
        if (op !== "update") {
          resolve({ error: null });
          return;
        }
        // Apply patch to all matching rows
        let touched = 0;
        for (const r of tables[tableName]) {
          if (filters.every(([c, v]) => r?.[c] === v)) {
            Object.assign(r, patch);
            touched += 1;
          }
        }
        writes.push({ table: tableName, filters, patch, touched });
        resolve({ error: null });
      },
    };
  }

  return {
    from(tableName) {
      return {
        select() { return chain(tableName, "select", []); },
        update(patch) { return chain(tableName, "update", [], patch); },
      };
    },
    _tables: tables,
    _writes: writes,
  };
}

describe("cascadeMarkLinkedPaid — quote → order → invoice walk", () => {
  it("flips quote.paid, then order.paid, then invoice.paid — full chain", async () => {
    const db = mockDb({
      quotes:   [{ id: "q1", shop_owner: "shopA@example.com", paid: false, converted_order_id: "ORD-001", quote_id: "Q-001" }],
      orders:   [{ id: "o1", shop_owner: "shopA@example.com", paid: false, order_id: "ORD-001" }],
      invoices: [{ id: "inv1", shop_owner: "shopA@example.com", paid: false, order_id: "ORD-001" }],
    });
    const quote = db._tables.quotes[0];
    const updates = await cascadeMarkLinkedPaid(db, quote, "2026-06-01");
    expect(updates).toEqual({ quoteUpdated: true, orderUpdated: true, invoiceUpdated: true });
    expect(db._tables.quotes[0].paid).toBe(true);
    expect(db._tables.orders[0].paid).toBe(true);
    expect(db._tables.invoices[0].paid).toBe(true);
    // paid_date stamped on all three
    expect(db._tables.quotes[0].paid_date).toBe("2026-06-01");
    expect(db._tables.orders[0].paid_date).toBe("2026-06-01");
    expect(db._tables.invoices[0].paid_date).toBe("2026-06-01");
  });

  it("is idempotent — already-paid rows are not re-touched (eq paid:false guard)", async () => {
    const db = mockDb({
      quotes:   [{ id: "q1", shop_owner: "shopA@example.com", paid: true, paid_date: "2026-05-01", converted_order_id: "ORD-001", quote_id: "Q-001" }],
      orders:   [{ id: "o1", shop_owner: "shopA@example.com", paid: true, paid_date: "2026-05-01", order_id: "ORD-001" }],
      invoices: [{ id: "inv1", shop_owner: "shopA@example.com", paid: true, paid_date: "2026-05-01", order_id: "ORD-001" }],
    });
    const quote = db._tables.quotes[0];
    const updates = await cascadeMarkLinkedPaid(db, quote, "2026-06-01");
    expect(updates).toEqual({ quoteUpdated: false, orderUpdated: false, invoiceUpdated: false });
    // paid_date NOT overwritten
    expect(db._tables.quotes[0].paid_date).toBe("2026-05-01");
  });

  it("CROSS-TENANT: every update carries the shop_owner filter (defense in depth)", async () => {
    const db = mockDb({
      quotes:   [{ id: "q1", shop_owner: "shopA@example.com", paid: false, converted_order_id: "ORD-001" }],
      orders:   [{ id: "o1", shop_owner: "shopA@example.com", paid: false, order_id: "ORD-001" }],
      invoices: [{ id: "inv1", shop_owner: "shopA@example.com", paid: false, order_id: "ORD-001" }],
    });
    await cascadeMarkLinkedPaid(db, db._tables.quotes[0], "2026-06-01");
    for (const w of db._writes) {
      const filterCols = w.filters.map(([c]) => c);
      expect(filterCols).toContain("shop_owner");
      expect(filterCols).toContain("paid"); // the eq paid:false race guard
    }
  });

  it("skips order + invoice when converted_order_id is null (legacy / orphan)", async () => {
    const db = mockDb({
      quotes: [{ id: "q1", shop_owner: "shopA@example.com", paid: false, converted_order_id: null }],
    });
    const updates = await cascadeMarkLinkedPaid(db, db._tables.quotes[0], "2026-06-01");
    expect(updates.quoteUpdated).toBe(true);
    expect(updates.orderUpdated).toBe(false);
    expect(updates.invoiceUpdated).toBe(false);
  });

  it("skips invoice when no invoice row exists for the order", async () => {
    const db = mockDb({
      quotes: [{ id: "q1", shop_owner: "shopA@example.com", paid: false, converted_order_id: "ORD-001" }],
      orders: [{ id: "o1", shop_owner: "shopA@example.com", paid: false, order_id: "ORD-001" }],
    });
    const updates = await cascadeMarkLinkedPaid(db, db._tables.quotes[0], "2026-06-01");
    expect(updates).toEqual({ quoteUpdated: true, orderUpdated: true, invoiceUpdated: false });
  });

  it("throws on missing required arguments — defensive", async () => {
    const db = mockDb({});
    await expect(cascadeMarkLinkedPaid(null, {}, "2026-06-01")).rejects.toThrow(/supabase required/);
    await expect(cascadeMarkLinkedPaid(db, null, "2026-06-01")).rejects.toThrow(/quote.id \+ shop_owner required/);
    await expect(cascadeMarkLinkedPaid(db, { id: "q1", shop_owner: "x@y.com", paid: false, converted_order_id: null }, "")).rejects.toThrow(/today/);
  });
});

describe("cascadeMarkInvoicePaid — invoice → order walk (no quote)", () => {
  it("flips invoice.paid then order.paid", async () => {
    const db = mockDb({
      orders:   [{ id: "o1", shop_owner: "shopA@example.com", paid: false, order_id: "ORD-001" }],
      invoices: [{ id: "inv1", shop_owner: "shopA@example.com", paid: false, order_id: "ORD-001" }],
    });
    const updates = await cascadeMarkInvoicePaid(db, db._tables.invoices[0], "2026-06-01");
    expect(updates).toEqual({ invoiceUpdated: true, orderUpdated: true });
    expect(db._tables.invoices[0].paid).toBe(true);
    expect(db._tables.orders[0].paid).toBe(true);
  });

  it("is idempotent on already-paid invoice + order", async () => {
    const db = mockDb({
      orders:   [{ id: "o1", shop_owner: "shopA@example.com", paid: true, order_id: "ORD-001" }],
      invoices: [{ id: "inv1", shop_owner: "shopA@example.com", paid: true, order_id: "ORD-001" }],
    });
    const updates = await cascadeMarkInvoicePaid(db, db._tables.invoices[0], "2026-06-01");
    expect(updates).toEqual({ invoiceUpdated: false, orderUpdated: false });
  });

  it("no-ops when order doesn't exist (orphan invoice)", async () => {
    const db = mockDb({
      invoices: [{ id: "inv1", shop_owner: "shopA@example.com", paid: false, order_id: "ORD-001" }],
    });
    const updates = await cascadeMarkInvoicePaid(db, db._tables.invoices[0], "2026-06-01");
    expect(updates).toEqual({ invoiceUpdated: true, orderUpdated: false });
  });

  it("CROSS-TENANT: every update carries shop_owner filter", async () => {
    const db = mockDb({
      orders:   [{ id: "o1", shop_owner: "shopA@example.com", paid: false, order_id: "ORD-001" }],
      invoices: [{ id: "inv1", shop_owner: "shopA@example.com", paid: false, order_id: "ORD-001" }],
    });
    await cascadeMarkInvoicePaid(db, db._tables.invoices[0], "2026-06-01");
    for (const w of db._writes) {
      const filterCols = w.filters.map(([c]) => c);
      expect(filterCols).toContain("shop_owner");
    }
  });

  it("throws on missing args", async () => {
    const db = mockDb({});
    await expect(cascadeMarkInvoicePaid(null, {}, "2026-06-01")).rejects.toThrow(/supabase required/);
    await expect(cascadeMarkInvoicePaid(db, null, "2026-06-01")).rejects.toThrow(/invoice.id \+ shop_owner required/);
  });
});
