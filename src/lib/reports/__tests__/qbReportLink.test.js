import { describe, it, expect } from "vitest";
import { qbReportUrl, QB_REPORTS } from "../qbReportLink";

describe("qbReportUrl", () => {
  it("returns the deep-link URL for each known report", () => {
    expect(qbReportUrl("profitAndLoss")).toBe("https://app.qbo.intuit.com/app/profitandlossreport");
    expect(qbReportUrl("balanceSheet")).toBe("https://app.qbo.intuit.com/app/balancesheetreport");
    expect(qbReportUrl("cashFlow")).toBe("https://app.qbo.intuit.com/app/cashflowreport");
    expect(qbReportUrl("arAging")).toBe("https://app.qbo.intuit.com/app/aragingdetailreport");
    expect(qbReportUrl("salesByCustomer")).toBe("https://app.qbo.intuit.com/app/salesbycustomersummary");
  });

  it("returns null for an unknown report key", () => {
    expect(qbReportUrl("notARealReport")).toBeNull();
  });

  it("returns null for null/undefined/empty key", () => {
    expect(qbReportUrl(null)).toBeNull();
    expect(qbReportUrl(undefined)).toBeNull();
    expect(qbReportUrl("")).toBeNull();
  });
});

describe("QB_REPORTS catalog", () => {
  it("every entry has a non-empty key, label, and slug", () => {
    for (const r of QB_REPORTS) {
      expect(typeof r.key).toBe("string");
      expect(r.key.length).toBeGreaterThan(0);
      expect(typeof r.label).toBe("string");
      expect(r.label.length).toBeGreaterThan(0);
      expect(typeof r.slug).toBe("string");
      expect(r.slug.length).toBeGreaterThan(0);
    }
  });

  it("every report URL points at the QBO host (no rogue domains)", () => {
    for (const r of QB_REPORTS) {
      const url = qbReportUrl(r.key);
      expect(url).toMatch(/^https:\/\/app\.qbo\.intuit\.com\/app\/[a-z]+$/);
    }
  });

  it("report keys are unique (no dupes that would shadow each other in the lookup)", () => {
    const keys = QB_REPORTS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is frozen — accidental mutation throws", () => {
    expect(Object.isFrozen(QB_REPORTS)).toBe(true);
  });
});
