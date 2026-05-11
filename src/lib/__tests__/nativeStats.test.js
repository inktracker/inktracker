import { describe, it, expect } from "vitest";
import { computeNativeStats } from "../nativeStats";

// ── Fixture builders ────────────────────────────────────────────────────────
// All take an `overrides` object so each test only specifies the fields it
// cares about.

const order = (overrides = {}) => ({
  id: "o1",
  order_id: "ORD-1",
  status: "Completed",
  total: 100,
  date: "2026-05-01",
  completed_date: "2026-05-15",
  customer_id: "c1",
  customer_name: "Acme",
  ...overrides,
});

const quote = (overrides = {}) => ({
  id: "q1",
  status: "Sent",
  total: 200,
  date: "2026-05-01",
  sent_date: "2026-05-01",
  ...overrides,
});

const invoice = (overrides = {}) => ({
  id: "i1",
  paid: false,
  status: "Sent",
  total: 100,
  ...overrides,
});

const customer = (overrides = {}) => ({
  id: "c1",
  created_date: "2026-05-01",
  ...overrides,
});

const archived = (overrides = {}) => ({
  id: "a1",
  order_id: "ORD-A1",
  date: "2026-05-15",
  total: 100,
  customer_id: "c1",
  customer_name: "Acme",
  ...overrides,
});

const RANGE = { dateFrom: "2026-05-01", dateTo: "2026-05-31" };

// ── Empty input handling ────────────────────────────────────────────────────

describe("computeNativeStats — empty / default inputs", () => {
  it("returns zero-state when called with nothing", () => {
    const r = computeNativeStats();
    expect(r.revenue).toBe(0);
    expect(r.activePipeline).toBe(0);
    expect(r.activePipelineCount).toBe(0);
    expect(r.quotePipelineValue).toBe(0);
    expect(r.outstanding).toBe(0);
    expect(r.aov).toBe(0);
    expect(r.completedCount).toBe(0);
    expect(r.newCustomers).toBe(0);
    expect(r.topCustomers).toEqual([]);
    expect(r.activeStatusList).toEqual([]);
  });

  it("returns null conversionRate / repeatRate when there's nothing to divide by", () => {
    const r = computeNativeStats();
    expect(r.conversionRate).toBeNull();
    expect(r.repeatRate).toBeNull();
  });

  it("echoes the period bounds in the result", () => {
    const r = computeNativeStats({ dateFrom: "2026-05-01", dateTo: "2026-05-31" });
    expect(r.period).toEqual({ from: "2026-05-01", to: "2026-05-31" });
  });
});

// ── Revenue ─────────────────────────────────────────────────────────────────

describe("computeNativeStats — revenue", () => {
  it("sums totals of completed orders within the period", () => {
    const r = computeNativeStats({
      orders: [
        order({ id: "1", status: "Completed", total: 100 }),
        order({ id: "2", status: "Shipped",   total: 200 }),
        order({ id: "3", status: "Delivered", total: 50 }),
        order({ id: "4", status: "Picked Up", total: 25 }),
      ],
      ...RANGE,
    });
    expect(r.revenue).toBe(375);
    expect(r.completedCount).toBe(4);
  });

  it("excludes non-completed orders from revenue", () => {
    const r = computeNativeStats({
      orders: [
        order({ id: "1", status: "Completed",  total: 100 }),
        order({ id: "2", status: "On Press",   total: 999 }),  // active, not done
        order({ id: "3", status: "Cancelled",  total: 999 }),
      ],
      ...RANGE,
    });
    expect(r.revenue).toBe(100);
  });

  it("filters by completed_date when present, falls back to date", () => {
    const r = computeNativeStats({
      orders: [
        order({ id: "1", status: "Completed", date: "2026-05-15", completed_date: "2026-06-01", total: 100 }), // out
        order({ id: "2", status: "Completed", date: "2026-05-15", completed_date: undefined,    total: 200 }), // in (uses date)
      ],
      dateFrom: "2026-05-01", dateTo: "2026-05-31",
    });
    expect(r.revenue).toBe(200);
  });

  it("includes archived (ShopPerformance) rows that aren't in orders", () => {
    const r = computeNativeStats({
      orders:   [order({ order_id: "ORD-1", total: 100 })],
      archived: [archived({ order_id: "ORD-X", total: 50 })],
      ...RANGE,
    });
    expect(r.revenue).toBe(150);
    expect(r.completedCount).toBe(2);
  });

  it("dedupes archived rows whose order_id already shows up in orders", () => {
    const r = computeNativeStats({
      orders:   [order({ order_id: "ORD-1", total: 100 })],
      archived: [archived({ order_id: "ORD-1", total: 100 })], // duplicate — must NOT double-count
      ...RANGE,
    });
    expect(r.revenue).toBe(100);
    expect(r.completedCount).toBe(1);
  });

  it("treats non-numeric totals as zero", () => {
    const r = computeNativeStats({
      orders: [
        order({ id: "1", total: "abc" }),
        order({ id: "2", total: null }),
        order({ id: "3", total: 75 }),
      ],
      ...RANGE,
    });
    expect(r.revenue).toBe(75);
  });
});

// ── Active pipeline ─────────────────────────────────────────────────────────

describe("computeNativeStats — active pipeline (current state, not date-bound)", () => {
  it("sums totals of orders in active statuses", () => {
    const r = computeNativeStats({
      orders: [
        order({ status: "Art Approval",   total: 100 }),
        order({ status: "On Press",       total: 200 }),
        order({ status: "Completed",      total: 999 }),  // excluded
        order({ status: "Cancelled",      total: 999 }),  // excluded
      ],
    });
    expect(r.activePipeline).toBe(300);
    expect(r.activePipelineCount).toBe(2);
  });

  it("ignores the date range entirely (current state)", () => {
    const r = computeNativeStats({
      orders: [order({ status: "On Press", total: 500, date: "2020-01-01" })],
      dateFrom: "2026-05-01", dateTo: "2026-05-31",
    });
    expect(r.activePipeline).toBe(500);
  });

  it("treats unrecognized statuses as active (anything not Completed/Cancelled)", () => {
    // The function uses isActiveOrder = !completed && !cancelled — so a typo
    // in status keeps the order in the pipeline rather than disappearing it.
    const r = computeNativeStats({
      orders: [order({ status: "WeirdNewStatus", total: 100 })],
    });
    expect(r.activePipelineCount).toBe(1);
  });
});

// ── Quote pipeline ──────────────────────────────────────────────────────────

describe("computeNativeStats — quote pipeline", () => {
  it("only counts quotes with status='Sent'", () => {
    const r = computeNativeStats({
      quotes: [
        quote({ status: "Sent",      total: 100 }),
        quote({ status: "Draft",     total: 999 }),
        quote({ status: "Approved",  total: 999 }),
        quote({ status: "Sent",      total: 50  }),
      ],
    });
    expect(r.quotePipelineValue).toBe(150);
    expect(r.quotePipelineCount).toBe(2);
  });
});

// ── Outstanding invoices ────────────────────────────────────────────────────

describe("computeNativeStats — outstanding", () => {
  it("sums totals of unpaid, non-Voided invoices", () => {
    const r = computeNativeStats({
      invoices: [
        invoice({ id: "1", paid: false, status: "Sent",   total: 100 }),
        invoice({ id: "2", paid: true,  status: "Sent",   total: 999 }), // excluded — paid
        invoice({ id: "3", paid: false, status: "Voided", total: 999 }), // excluded — voided
        invoice({ id: "4", paid: false, status: "Sent",   total: 50  }),
      ],
    });
    expect(r.outstanding).toBe(150);
    expect(r.outstandingCount).toBe(2);
  });

  it("ignores date range (current state)", () => {
    const r = computeNativeStats({
      invoices: [invoice({ paid: false, total: 500 })],
      dateFrom: "2026-05-01", dateTo: "2026-05-31",
    });
    expect(r.outstanding).toBe(500);
  });
});

// ── Conversion rate ─────────────────────────────────────────────────────────

describe("computeNativeStats — quote conversion", () => {
  it("rate = converted / sent (in period, ignoring Drafts)", () => {
    const r = computeNativeStats({
      quotes: [
        quote({ id: "1", status: "Sent",                  sent_date: "2026-05-05" }),
        quote({ id: "2", status: "Approved",              sent_date: "2026-05-10" }),
        quote({ id: "3", status: "Converted to Order",    sent_date: "2026-05-15" }),
        quote({ id: "4", status: "Approved and Paid",     sent_date: "2026-05-20" }),
        quote({ id: "5", status: "Client Approved",       sent_date: "2026-05-22" }),
        quote({ id: "6", status: "Draft",                 sent_date: "2026-05-25" }), // excluded
      ],
      ...RANGE,
    });
    expect(r.conversionSentCount).toBe(5);          // 6 minus 1 Draft
    expect(r.conversionConvertedCount).toBe(4);     // Approved/Converted/A&P/Client Approved
    expect(r.conversionRate).toBeCloseTo(4 / 5);
  });

  it("falls back to `date` when sent_date is missing", () => {
    const r = computeNativeStats({
      quotes: [quote({ status: "Sent", sent_date: null, date: "2026-05-15" })],
      ...RANGE,
    });
    expect(r.conversionSentCount).toBe(1);
  });

  it("returns null conversionRate when no quotes were sent in period", () => {
    const r = computeNativeStats({
      quotes: [quote({ status: "Draft" })],
      ...RANGE,
    });
    expect(r.conversionRate).toBeNull();
  });
});

// ── AOV ─────────────────────────────────────────────────────────────────────

describe("computeNativeStats — average order value", () => {
  it("aov = revenue / completedCount", () => {
    const r = computeNativeStats({
      orders: [
        order({ id: "1", total: 100 }),
        order({ id: "2", total: 200 }),
        order({ id: "3", total: 300 }),
      ],
      ...RANGE,
    });
    expect(r.aov).toBe(200);
  });

  it("returns 0 when no completed orders (avoids divide-by-zero)", () => {
    const r = computeNativeStats({ ...RANGE });
    expect(r.aov).toBe(0);
  });
});

// ── New customers ───────────────────────────────────────────────────────────

describe("computeNativeStats — new customers (in period)", () => {
  it("counts customers whose created_date is in range", () => {
    const r = computeNativeStats({
      customers: [
        customer({ id: "1", created_date: "2026-04-15" }), // before range
        customer({ id: "2", created_date: "2026-05-10" }), // in range
        customer({ id: "3", created_date: "2026-05-20" }), // in range
        customer({ id: "4", created_date: "2026-06-01" }), // after range
      ],
      ...RANGE,
    });
    expect(r.newCustomers).toBe(2);
  });

  it("falls back to created_at when created_date missing", () => {
    const r = computeNativeStats({
      customers: [customer({ created_date: undefined, created_at: "2026-05-15" })],
      ...RANGE,
    });
    expect(r.newCustomers).toBe(1);
  });

  it("ignores customers with no created date at all", () => {
    const r = computeNativeStats({
      customers: [customer({ created_date: undefined, created_at: undefined })],
      ...RANGE,
    });
    expect(r.newCustomers).toBe(0);
  });
});

// ── Repeat customer rate (lifetime, not period-bound) ───────────────────────

describe("computeNativeStats — repeat customer rate", () => {
  it("rate = customersWithMultiple / customersWithAnyOrder", () => {
    const r = computeNativeStats({
      orders: [
        order({ customer_id: "c1", status: "Completed" }),
        order({ customer_id: "c1", status: "Completed" }),  // c1 has 2
        order({ customer_id: "c2", status: "On Press" }),   // c2 has 1
        order({ customer_id: "c3", status: "Completed" }),
        order({ customer_id: "c3", status: "Shipped" }),    // c3 has 2
        order({ customer_id: "c4", status: "Cancelled" }),  // ignored
      ],
    });
    expect(r.customersWithAnyOrder).toBe(3);
    expect(r.repeatCustomersCount).toBe(2);
    expect(r.repeatRate).toBeCloseTo(2 / 3);
  });

  it("counts archived (ShopPerformance) rows toward the lifetime tally", () => {
    const r = computeNativeStats({
      orders:   [order({ customer_id: "c1" })],
      archived: [
        archived({ customer_id: "c1" }),  // c1 has 2 (one in orders, one archived)
        archived({ customer_id: "c2" }),  // c2 has 1
      ],
    });
    expect(r.customersWithAnyOrder).toBe(2);
    expect(r.repeatCustomersCount).toBe(1);
  });

  it("falls back to customer_name when customer_id is missing", () => {
    const r = computeNativeStats({
      orders: [
        order({ customer_id: null, customer_name: "Acme" }),
        order({ customer_id: null, customer_name: "Acme" }), // counted as same customer
      ],
    });
    expect(r.customersWithAnyOrder).toBe(1);
    expect(r.repeatCustomersCount).toBe(1);
  });

  it("returns null repeatRate when there are no customers with any order", () => {
    const r = computeNativeStats({});
    expect(r.repeatRate).toBeNull();
  });

  it("ignores cancelled orders when tallying", () => {
    const r = computeNativeStats({
      orders: [
        order({ customer_id: "c1", status: "Cancelled" }),
        order({ customer_id: "c1", status: "Cancelled" }),
      ],
    });
    expect(r.customersWithAnyOrder).toBe(0);
  });
});

// ── Top customers ──────────────────────────────────────────────────────────

describe("computeNativeStats — top customers (in period)", () => {
  it("sorts customers by total revenue, top 5", () => {
    const r = computeNativeStats({
      orders: [
        order({ customer_name: "Big",    total: 500 }),
        order({ customer_name: "Mid",    total: 200 }),
        order({ customer_name: "Small",  total: 50  }),
        order({ customer_name: "Big",    total: 300 }),  // Big totals 800
      ],
      ...RANGE,
    });
    expect(r.topCustomers[0]).toEqual({ name: "Big", total: 800 });
    expect(r.topCustomers[1]).toEqual({ name: "Mid", total: 200 });
    expect(r.topCustomers[2]).toEqual({ name: "Small", total: 50 });
  });

  it("merges archived (ShopPerformance) revenue into top customers", () => {
    const r = computeNativeStats({
      orders:   [order({ order_id: "ORD-1", customer_name: "Acme", total: 100 })],
      archived: [archived({ order_id: "ORD-X", customer_name: "Acme", total: 200 })],
      ...RANGE,
    });
    expect(r.topCustomers[0]).toEqual({ name: "Acme", total: 300 });
  });

  it("caps result at 5 customers", () => {
    const orders = Array.from({ length: 10 }).map((_, i) =>
      order({ id: `o${i}`, order_id: `ORD-${i}`, customer_name: `Cust ${i}`, total: i + 1 })
    );
    const r = computeNativeStats({ orders, ...RANGE });
    expect(r.topCustomers).toHaveLength(5);
  });

  it("ignores entries with no customer name", () => {
    const r = computeNativeStats({
      orders: [
        order({ customer_name: null, total: 999 }),
        order({ customer_name: "",   total: 999 }),
        order({ customer_name: "Acme", total: 100 }),
      ],
      ...RANGE,
    });
    expect(r.topCustomers).toEqual([{ name: "Acme", total: 100 }]);
  });
});

// ── Active orders by status ────────────────────────────────────────────────

describe("computeNativeStats — active status grouping", () => {
  it("groups active orders by status, descending count", () => {
    const r = computeNativeStats({
      orders: [
        order({ status: "On Press" }),
        order({ status: "On Press" }),
        order({ status: "Art Approval" }),
        order({ status: "Completed" }),  // excluded — done
      ],
    });
    expect(r.activeStatusList).toEqual([
      { status: "On Press",     count: 2 },
      { status: "Art Approval", count: 1 },
    ]);
  });

  it("treats missing status as 'Unknown'", () => {
    const r = computeNativeStats({
      orders: [order({ status: undefined })],
    });
    expect(r.activeStatusList).toEqual([{ status: "Unknown", count: 1 }]);
  });
});

// ── Date range edge cases ──────────────────────────────────────────────────

describe("computeNativeStats — date range edge cases", () => {
  it("null dateFrom/dateTo means everything is in-period", () => {
    const r = computeNativeStats({
      orders: [
        order({ id: "1", completed_date: "2020-01-01", total: 100 }),
        order({ id: "2", completed_date: "2050-01-01", total: 200 }),
      ],
      dateFrom: null, dateTo: null,
    });
    // With both bounds null, inRange still returns false for missing date —
    // but a date in 2020 and 2050 are both present, so both included.
    expect(r.revenue).toBe(300);
  });

  it("excludes orders without any usable date when a range is set", () => {
    const r = computeNativeStats({
      orders: [
        order({ id: "1", date: null, completed_date: null, total: 999 }),
        order({ id: "2", completed_date: "2026-05-15", total: 100 }),
      ],
      ...RANGE,
    });
    expect(r.revenue).toBe(100);
  });
});
