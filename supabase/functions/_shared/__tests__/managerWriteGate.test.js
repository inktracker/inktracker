// NEW-05 regression guard: the manager-permission write gate must survive on
// the order / purchase-order policies.
//
// BILL-02 stage 3 (20260805) appended has_active_subscription() to these
// policies with `ALTER POLICY ... WITH CHECK (<expr>)`, which REPLACES the whole
// WITH CHECK. It dropped the manager_section_allowed() clause that 20260706
// added — silently re-opening writes for a manager whose Production/Inventory
// permission was revoked. Tests passed because nothing covered it.
//
// This guard reads the migration SQL directly (no live DB needed) and asserts
// that, for each affected policy, the CHRONOLOGICALLY LAST migration which sets
// its WITH CHECK keeps BOTH guards. A future ALTER POLICY that clobbers either
// one becomes the new "last" file and fails here.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../migrations/", import.meta.url));

// Policies that ride the manager_section_allowed() gate AND the subscription
// gate on their write check.
const GUARDED_POLICIES = ["orders_employee", "purchase_orders_insert", "purchase_orders_update"];

// Sorted chronologically — the timestamp filename prefix is the order migrations
// apply in, so the last matching file reflects the effective live policy.
const FILES = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ name: f, sql: readFileSync(MIGRATIONS_DIR + f, "utf8") }));

// A file "sets the WITH CHECK" for a policy when it both names the policy and
// contains a `with check` clause (covers direct ALTER/CREATE and the dynamic
// `format(... with check ...)` blocks where the name is a string-literal arg).
function lastFileSettingWriteCheck(policy) {
  let found = null;
  for (const f of FILES) {
    if (f.sql.includes(policy) && /with\s+check/i.test(f.sql)) found = f;
  }
  return found;
}

describe("manager write gate survives on order/PO policies (NEW-05)", () => {
  for (const policy of GUARDED_POLICIES) {
    it(`${policy}: latest WITH CHECK keeps manager_section_allowed + has_active_subscription`, () => {
      const f = lastFileSettingWriteCheck(policy);
      expect(f, `no migration sets WITH CHECK for ${policy}`).toBeTruthy();
      expect(f.sql, `${f.name} dropped the manager gate from ${policy}`).toMatch(/manager_section_allowed\(/);
      expect(f.sql, `${f.name} dropped the subscription gate from ${policy}`).toMatch(/has_active_subscription\(/);
    });
  }
});
