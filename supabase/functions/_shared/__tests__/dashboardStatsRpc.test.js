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
