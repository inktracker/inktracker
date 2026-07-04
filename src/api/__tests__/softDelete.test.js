// T5 source-contract test for the soft-delete choke point.
//
// The entity wrapper (src/api/supabaseClient.js) is the ONLY client
// read/delete path (cachedEntity routes through it), so the soft-delete
// guarantees hold exactly as long as its source keeps three properties:
//   1. the four protected tables are declared
//   2. delete() soft-deletes them (writes deleted_at, no .delete() branch
//      reachable for them)
//   3. every read (list/filter/get) appends the deleted_at IS NULL filter
// The wrapper instantiates a real Supabase client at import time, so this
// asserts on SOURCE (like the blogPosts guard) rather than importing it.
// The BEHAVIORAL proof runs in the restore drill against real RLS:
// scripts/restore-drill/verify-soft-delete.mjs.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src", "api", "supabaseClient.js"), "utf8");
const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260901000000_soft_delete_safety_net.sql"), "utf8");

describe("soft-delete wrapper contract", () => {
  it("declares exactly the four protected tables", () => {
    const m = src.match(/SOFT_DELETE_TABLES = new Set\(\[([^\]]+)\]\)/);
    expect(m, "SOFT_DELETE_TABLES declaration missing").toBeTruthy();
    const tables = [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]).sort();
    expect(tables).toEqual(["customers", "invoices", "orders", "quotes"]);
  });

  it("delete() soft-deletes protected tables (update deleted_at, early return)", () => {
    const deleteBlock = src.slice(src.indexOf("async delete(id)"));
    expect(deleteBlock).toMatch(/SOFT_DELETE_TABLES\.has\(tableName\)/);
    expect(deleteBlock).toMatch(/\.update\(\{ deleted_at: new Date\(\)\.toISOString\(\) \}\)/);
    // the soft path must return before the hard .delete() call
    const softIdx = deleteBlock.indexOf("update({ deleted_at");
    const returnIdx = deleteBlock.indexOf("return;", softIdx);
    const hardIdx = deleteBlock.indexOf(".delete()");
    expect(returnIdx).toBeGreaterThan(softIdx);
    expect(returnIdx).toBeLessThan(hardIdx);
  });

  it("every read path filters soft-deleted rows", () => {
    for (const method of ["async list(", "async filter(", "async get("]) {
      const start = src.indexOf(method);
      expect(start, `${method} not found`).toBeGreaterThan(-1);
      const block = src.slice(start, src.indexOf("},", start));
      expect(block, `${method} missing the deleted_at IS NULL filter`)
        .toMatch(/q = q\.is\("deleted_at", null\)/);
    }
  });
});

describe("soft-delete migration contract", () => {
  it("adds deleted_at + write-protection policies for all four tables", () => {
    expect(migration).toMatch(/ARRAY\['quotes','orders','invoices','customers'\]/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS deleted_at timestamptz/);
    expect(migration).toMatch(/_no_edit_soft_deleted/);
    expect(migration).toMatch(/_no_client_hard_delete/);
    expect(migration).toMatch(/AS RESTRICTIVE FOR DELETE TO anon, authenticated USING \(false\)/);
  });

  it("never touches a permissive/tenancy policy (restrictive-only, no ALTER POLICY)", () => {
    expect(migration).not.toMatch(/ALTER POLICY/);
    // every CREATE POLICY in this migration is RESTRICTIVE
    const creates = migration.match(/CREATE POLICY [^;]+/g) ?? [];
    for (const c of creates) expect(c).toMatch(/AS RESTRICTIVE/);
  });

  it("keeps the Completed-order guard parity and live-only integrity oracle", () => {
    expect(migration).toMatch(/refuse_completed_order_soft_delete/);
    expect(migration).toMatch(/WHERE q\.deleted_at IS NULL/);
    expect(migration).toMatch(/WHERE o\.deleted_at IS NULL/);
    expect(migration).toMatch(/WHERE i\.deleted_at IS NULL/);
  });
});
