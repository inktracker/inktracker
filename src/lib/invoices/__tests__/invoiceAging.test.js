import { describe, it, expect } from "vitest";
import { invoiceAging, AGING_TONE_CLASS } from "../invoiceAging";

const DAY = 86400000;
const NOW = new Date("2026-09-09T12:00:00Z").getTime();
const iso = (offsetDays) => new Date(NOW - offsetDays * DAY).toISOString().slice(0, 10);

describe("invoiceAging", () => {
  it("returns null for paid or dateless invoices", () => {
    expect(invoiceAging({ paid: true, date: iso(10) }, NOW)).toBeNull();
    expect(invoiceAging({ paid: false, date: "" }, NOW)).toBeNull();
    expect(invoiceAging(null, NOW)).toBeNull();
  });

  it("recent unpaid, no due date → slate 'N days outstanding'", () => {
    const a = invoiceAging({ paid: false, date: iso(5) }, NOW);
    expect(a).toMatchObject({ overdue: false, tone: "slate", label: "5 days outstanding" });
  });

  it("aging past 30 days, no due date → amber", () => {
    const a = invoiceAging({ paid: false, date: iso(42) }, NOW);
    expect(a).toMatchObject({ tone: "amber", label: "42 days outstanding", overdue: false });
  });

  it("past its due date → red overdue with day count", () => {
    const a = invoiceAging({ paid: false, date: iso(20), due: iso(5) }, NOW);
    expect(a).toMatchObject({ overdue: true, overdueDays: 5, tone: "red", label: "5 days overdue" });
  });

  it("due today → amber 'Due today', not overdue", () => {
    const a = invoiceAging({ paid: false, date: iso(30), due: iso(0) }, NOW);
    expect(a).toMatchObject({ overdue: false, tone: "amber", label: "Due today" });
  });

  it("due in the future → not overdue (age-based tone)", () => {
    const future = new Date(NOW + 10 * DAY).toISOString().slice(0, 10);
    const a = invoiceAging({ paid: false, date: iso(3), due: future }, NOW);
    expect(a.overdue).toBe(false);
    expect(a.tone).toBe("slate");
  });

  it("singular day wording", () => {
    expect(invoiceAging({ paid: false, date: iso(1) }, NOW).label).toBe("1 day outstanding");
    expect(invoiceAging({ paid: false, date: iso(11), due: iso(1) }, NOW).label).toBe("1 day overdue");
  });

  it("every tone has a class", () => {
    for (const tone of ["red", "amber", "slate"]) {
      expect(AGING_TONE_CLASS[tone]).toBeTruthy();
    }
  });
});
