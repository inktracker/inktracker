// Drift guard: the dashboard_stats RPC mirrors status semantics that live in
// JS (normalizeQuoteStatus, isConvertedToOrder, Dashboard's TERMINAL set).
// The two can't share code — one is SQL — so this test pins that every
// status literal the JS relies on appears in the effective RPC migration.
// Rename a status in JS without updating the SQL (or vice versa) and the
// dashboard chips silently drift from the page lists again.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../migrations/", import.meta.url));

const FILES = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ name: f, sql: readFileSync(MIGRATIONS_DIR + f, "utf8") }));

function lastFileDefining(fn) {
  let found = null;
  for (const f of FILES) {
    if (new RegExp(`function\\s+public\\.${fn}\\b`, "i").test(f.sql)) found = f;
  }
  return found;
}

describe("dashboard_stats RPC — status literals stay in lockstep with JS", () => {
  const last = lastFileDefining("dashboard_stats");

  it("has an effective migration", () => {
    expect(last, "no migration defines dashboard_stats").toBeTruthy();
  });

  it("quote bucketing mirrors normalizeQuoteStatus + isConvertedToOrder", () => {
    // normalizeQuoteStatus: Approved / Approved and Paid → approved;
    // Sent / Pending → pending. isConvertedToOrder: 'Converted to Order'
    // OR converted_order_id.
    for (const status of ["Approved", "Approved and Paid", "Sent", "Pending", "Converted to Order"]) {
      expect(last.sql, `missing quote status '${status}'`).toContain(`'${status}'`);
    }
    expect(last.sql).toContain("converted_order_id");
  });

  it("order terminal set mirrors Dashboard TERMINAL_STATUSES", () => {
    for (const status of ["Completed", "Cancelled", "Voided"]) {
      expect(last.sql, `missing terminal status '${status}'`).toContain(`'${status}'`);
    }
  });

  it("is RLS-scoped (SECURITY INVOKER — no SECURITY DEFINER, no shop param)", () => {
    const body = last.sql.match(/function\s+public\.dashboard_stats[\s\S]*?\$\$;/i)?.[0] || "";
    expect(body).toBeTruthy();
    expect(body, "dashboard_stats must NOT be SECURITY DEFINER — RLS is the tenant scope").not.toMatch(/security\s+definer/i);
    expect(body, "dashboard_stats takes no arguments — nothing to spoof").toMatch(/dashboard_stats\s*\(\s*\)/i);
  });

  it("only authenticated may execute", () => {
    expect(last.sql).toMatch(/grant\s+execute[^;]*dashboard_stats[^;]*authenticated/i);
    expect(last.sql).toMatch(/revoke\s+all[^;]*dashboard_stats[^;]*from\s+public/i);
  });
});

describe("performance_stats RPC — status literals stay in lockstep with Performance.jsx", () => {
  const last = lastFileDefining("performance_stats");

  it("has an effective migration", () => {
    expect(last, "no migration defines performance_stats").toBeTruthy();
  });

  it("mirrors COMPLETED_STATUSES and CANCELLED_STATUSES", () => {
    // Performance.jsx line ~14: Completed/Shipped/Delivered/Picked Up and
    // Cancelled/Canceled/Voided — note the one-L 'Canceled' variant.
    for (const status of ["Completed", "Shipped", "Delivered", "Picked Up", "Cancelled", "Canceled", "Voided"]) {
      expect(last.sql, `missing status '${status}'`).toContain(`'${status}'`);
    }
  });

  it("sources period stats from completed ORDERS, not shop_performance (v2)", () => {
    // v1 read the shop_performance archive, which only runOrderCompletion
    // wrote — completions via other paths were invisible (Biota showed 2 of
    // 8 July orders, 2026-07-18). v2 reads orders.completed_date directly;
    // deleted orders drop out by definition, so no orphan cross-reference.
    expect(last.sql).toMatch(/completed_date/i);
    expect(last.sql).toMatch(/from\s+public\.orders\s+o/i);
    expect(last.sql, "period stats must not read shop_performance").not.toMatch(/from\s+public\.shop_performance/i);
  });

  it("v3: Total Volume unions QB-only invoices with the quote-born dedup", () => {
    // The dedup MUST check quotes.converted_order_id — quote-born invoices
    // carry order_id NULL with the linkage on the quote; dropping this
    // clause double-counts every quoted job. See docs/total-volume-scope.md.
    expect(last.sql).toMatch(/period_total_volume/);
    expect(last.sql).toMatch(/converted_order_id/);
    expect(last.sql).toMatch(/period_qb_only_invoice_count/);
  });

  it("is RLS-scoped (SECURITY INVOKER) and authenticated-only", () => {
    const body = last.sql.match(/function\s+public\.performance_stats[\s\S]*?\$\$;/i)?.[0] || "";
    expect(body).toBeTruthy();
    expect(body).not.toMatch(/security\s+definer/i);
    expect(last.sql).toMatch(/grant\s+execute[^;]*performance_stats[^;]*authenticated/i);
    expect(last.sql).toMatch(/revoke\s+all[^;]*performance_stats[^;]*from\s+public/i);
  });
});
