import { describe, it, expect } from "vitest";
import { invoiceAging, AGING_TONE_CLASS } from "../invoiceAging";

// todayStr is the shop-tz calendar date the caller passes in.
const TODAY = "2026-09-09";
const daysAgo = (n) => {
  const d = new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86400000);
  return d.toISOString().slice(0, 10);
};
const daysAhead = (n) => {
  const d = new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86400000);
  return d.toISOString().slice(0, 10);
};

describe("invoiceAging", () => {
  it("returns null for paid, dateless, or bad-today invoices", () => {
    expect(invoiceAging({ paid: true, date: daysAgo(10) }, TODAY)).toBeNull();
    expect(invoiceAging({ paid: false, date: "" }, TODAY)).toBeNull();
    expect(invoiceAging(null, TODAY)).toBeNull();
    expect(invoiceAging({ paid: false, date: daysAgo(5) }, "")).toBeNull();
  });

  it("recent unpaid, no due date → slate 'N days outstanding'", () => {
    expect(invoiceAging({ paid: false, date: daysAgo(5) }, TODAY))
      .toMatchObject({ overdue: false, tone: "slate", label: "5 days outstanding" });
  });

  it("aging past 30 days with NO due date → amber", () => {
    expect(invoiceAging({ paid: false, date: daysAgo(42) }, TODAY))
      .toMatchObject({ tone: "amber", label: "42 days outstanding", overdue: false });
  });

  it("past its due date → red overdue with day count", () => {
    expect(invoiceAging({ paid: false, date: daysAgo(20), due: daysAgo(5) }, TODAY))
      .toMatchObject({ overdue: true, overdueDays: 5, tone: "red", label: "5 days overdue" });
  });

  it("due today → amber 'Due today', not overdue", () => {
    expect(invoiceAging({ paid: false, date: daysAgo(30), due: TODAY }, TODAY))
      .toMatchObject({ overdue: false, tone: "amber", label: "Due today" });
  });

  it("aged >30 but NOT yet due (net-60) → slate, not amber", () => {
    // 40 days old, due 20 days out — on time, must not read as attention.
    const a = invoiceAging({ paid: false, date: daysAgo(40), due: daysAhead(20) }, TODAY);
    expect(a.overdue).toBe(false);
    expect(a.tone).toBe("slate");
    expect(a.label).toBe("40 days outstanding");
  });

  it("singular day wording", () => {
    expect(invoiceAging({ paid: false, date: daysAgo(1) }, TODAY).label).toBe("1 day outstanding");
    expect(invoiceAging({ paid: false, date: daysAgo(11), due: daysAgo(1) }, TODAY).label).toBe("1 day overdue");
  });

  it("timezone-safe: no off-by-one — a due date equal to today is never 'overdue'", () => {
    // The whole point of the fix: date-only compared to shop-tz today as
    // calendar days, so due == today is "Due today", never "1 day overdue".
    const a = invoiceAging({ paid: false, date: daysAgo(10), due: TODAY }, TODAY);
    expect(a.overdue).toBe(false);
    expect(a.label).toBe("Due today");
  });

  it("ages from an ISO created_at timestamp when date is absent", () => {
    expect(invoiceAging({ paid: false, created_at: `${daysAgo(3)}T14:30:00Z` }, TODAY).label)
      .toBe("3 days outstanding");
  });

  it("every tone has a class", () => {
    for (const tone of ["red", "amber", "slate"]) expect(AGING_TONE_CLASS[tone]).toBeTruthy();
  });
});
