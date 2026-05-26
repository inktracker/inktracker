import { describe, it, expect } from "vitest";
import { summarizeInvoicesForDashboard } from "../qbDashboardMetrics.js";

const NOW = Date.parse("2026-05-26T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

// Helper: build a QB Invoice with sensible defaults.
function inv({ id = "1", date = "2026-05-26", total = 100, balance = 0 }) {
  return { Id: id, DocNumber: id, TxnDate: date, TotalAmt: total, Balance: balance };
}

describe("summarizeInvoicesForDashboard", () => {
  it("returns zeros for empty / null / non-array input", () => {
    expect(summarizeInvoicesForDashboard([], NOW)).toMatchObject({
      revenueLast30Days: 0,
      revenueOrderCount: 0,
      openInvoicesCount: 0,
      openInvoicesTotal: 0,
    });
    expect(summarizeInvoicesForDashboard(null, NOW).revenueLast30Days).toBe(0);
    expect(summarizeInvoicesForDashboard(undefined, NOW).openInvoicesCount).toBe(0);
    expect(summarizeInvoicesForDashboard("nope", NOW).openInvoicesTotal).toBe(0);
  });

  it("sums TotalAmt for invoices inside the 30-day window", () => {
    const r = summarizeInvoicesForDashboard([
      inv({ id: "a", date: "2026-05-26", total: 100 }),
      inv({ id: "b", date: "2026-05-10", total: 250 }),
      inv({ id: "c", date: "2026-04-30", total: 500 }), // just inside
    ], NOW);
    expect(r.revenueLast30Days).toBe(850);
    expect(r.revenueOrderCount).toBe(3);
  });

  it("excludes invoices older than the 30-day window", () => {
    const r = summarizeInvoicesForDashboard([
      inv({ id: "old", date: "2026-04-01", total: 999 }),
      inv({ id: "new", date: "2026-05-25", total: 100 }),
    ], NOW);
    expect(r.revenueLast30Days).toBe(100);
    expect(r.revenueOrderCount).toBe(1);
  });

  it("excludes invoices whose TxnDate is in the future (data error guard)", () => {
    const r = summarizeInvoicesForDashboard([
      inv({ id: "future", date: "2026-06-15", total: 999 }),
      inv({ id: "today",  date: "2026-05-26", total: 100 }),
    ], NOW);
    expect(r.revenueLast30Days).toBe(100);
  });

  it("counts AR as Balance > 0, sums to openInvoicesTotal", () => {
    const r = summarizeInvoicesForDashboard([
      inv({ id: "paid",        total: 500, balance: 0    }),
      inv({ id: "open-a",      total: 300, balance: 300  }),
      inv({ id: "open-partial",total: 800, balance: 250  }),
    ], NOW);
    expect(r.openInvoicesCount).toBe(2);
    expect(r.openInvoicesTotal).toBe(550);
  });

  it("a single invoice can contribute to BOTH revenue and AR", () => {
    // Invoice billed today, unpaid → counts as recent revenue AND as open AR.
    const r = summarizeInvoicesForDashboard([
      inv({ id: "x", date: "2026-05-26", total: 400, balance: 400 }),
    ], NOW);
    expect(r.revenueLast30Days).toBe(400);
    expect(r.openInvoicesTotal).toBe(400);
  });

  it("rounds to cents to avoid float drift on long sums", () => {
    // Each row adds 0.1; classic 0.1 + 0.2 = 0.30000000000000004 case.
    const r = summarizeInvoicesForDashboard(
      Array.from({ length: 10 }, (_, i) => inv({ id: String(i), total: 0.1 })),
      NOW
    );
    expect(r.revenueLast30Days).toBe(1);
  });

  it("ignores invoices with malformed TotalAmt / Balance (non-numeric)", () => {
    const r = summarizeInvoicesForDashboard([
      { Id: "a", TxnDate: "2026-05-26", TotalAmt: "abc", Balance: "xyz" },
      { Id: "b", TxnDate: "2026-05-26" /* missing both */ },
      inv({ id: "c", total: 50, balance: 50 }),
    ], NOW);
    expect(r.revenueLast30Days).toBe(50);
    expect(r.openInvoicesTotal).toBe(50);
  });

  it("ignores invoices with malformed TxnDate (excludes from revenue, AR still counts)", () => {
    const r = summarizeInvoicesForDashboard([
      { Id: "a", TxnDate: "not-a-date", TotalAmt: 500, Balance: 500 },
    ], NOW);
    expect(r.revenueLast30Days).toBe(0);   // dropped — no valid date
    expect(r.openInvoicesTotal).toBe(500); // AR doesn't need a date
  });

  it("respects a custom windowDays parameter (e.g. last 7 days)", () => {
    const r = summarizeInvoicesForDashboard([
      inv({ id: "a", date: "2026-05-26", total: 100 }),
      inv({ id: "b", date: "2026-05-22", total: 100 }), // 4 days ago
      inv({ id: "c", date: "2026-05-15", total: 100 }), // 11 days ago — out
    ], NOW, /* windowDays */ 7);
    expect(r.revenueLast30Days).toBe(200);
    expect(r.windowDays).toBe(7);
  });
});
