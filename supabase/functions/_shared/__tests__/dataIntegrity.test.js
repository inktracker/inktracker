// The integrity alert exists because the beloved's orphans (3 invoices,
// customer_id NULL, "(deleted)" name stamps) stayed invisible for ~9
// months — nothing alerted on the broken invariant. These tests pin the
// alert's trigger condition and message content.

import { describe, it, expect } from "vitest";
import {
  totalIntegrityViolations,
  shouldSendIntegrityAlert,
  buildIntegrityAlertText,
} from "../dataIntegrity.js";

const CLEAN = [
  { tbl: "invoices", missing_link: 0, dangling_link: 0 },
  { tbl: "quotes", missing_link: 0, dangling_link: 0 },
  { tbl: "orders", missing_link: 0, dangling_link: 0 },
];

describe("data integrity alert", () => {
  it("stays quiet when the invariant holds", () => {
    expect(totalIntegrityViolations(CLEAN)).toBe(0);
    expect(shouldSendIntegrityAlert(CLEAN)).toBe(false);
  });

  it("fires on a single missing link (the beloved's shape)", () => {
    const rows = [
      { tbl: "invoices", missing_link: 3, dangling_link: 0 },
      { tbl: "quotes", missing_link: 0, dangling_link: 0 },
    ];
    expect(shouldSendIntegrityAlert(rows)).toBe(true);
    expect(totalIntegrityViolations(rows)).toBe(3);
  });

  it("fires on dangling links too (deleted customer, id left behind)", () => {
    const rows = [{ tbl: "orders", missing_link: 0, dangling_link: 1 }];
    expect(shouldSendIntegrityAlert(rows)).toBe(true);
  });

  it("handles string counts from the SQL layer", () => {
    const rows = [{ tbl: "invoices", missing_link: "2", dangling_link: "0" }];
    expect(totalIntegrityViolations(rows)).toBe(2);
  });

  it("handles null/empty input without firing", () => {
    expect(shouldSendIntegrityAlert(null)).toBe(false);
    expect(shouldSendIntegrityAlert([])).toBe(false);
  });

  it("alert text names only the violating tables with both counts", () => {
    const rows = [
      { tbl: "invoices", missing_link: 3, dangling_link: 0 },
      { tbl: "quotes", missing_link: 0, dangling_link: 0 },
      { tbl: "orders", missing_link: 0, dangling_link: 2 },
    ];
    const text = buildIntegrityAlertText(rows);
    expect(text).toContain("invoices: 3 missing");
    expect(text).toContain("orders: 0 missing customer_id, 2 dangling");
    expect(text).not.toContain("quotes:");
    expect(text).toContain("data_integrity_violations()");
  });
});
