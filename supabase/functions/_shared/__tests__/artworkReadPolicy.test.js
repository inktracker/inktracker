// Regression guard for the artwork read RLS design (20260827).
//
// The PRIMARY "authenticated_read_artwork" policy must stay on the
// equality path (artwork_read_allowed → artwork_objects PK lookup). The
// six leading-wildcard LIKE subqueries are allowed to exist ONLY in the
// transitional fallback policies — if a future migration reintroduces
// LIKE matching into the primary policy (the pre-20260827 design), reads
// go back to O(objects × 6 tables) and this fails.
//
// Same no-live-DB approach as managerWriteGate/wizardRpcGrant: the
// chronologically LAST migration defining a policy is its effective state.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../migrations/", import.meta.url));

const FILES = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ name: f, sql: readFileSync(MIGRATIONS_DIR + f, "utf8") }));

// The last migration that CREATEs the named policy is the effective one.
function lastFileCreatingPolicy(policy) {
  let found = null;
  for (const f of FILES) {
    if (new RegExp(`create\\s+policy\\s+"?${policy}"?`, "i").test(f.sql)) found = f;
  }
  return found;
}

// Extract just this policy's CREATE body (up to the closing `;` before the
// next statement) so fallback policies in the same file don't false-fail it.
function policyBody(sql, policy) {
  const re = new RegExp(`create\\s+policy\\s+"?${policy}"?[\\s\\S]*?;`, "i");
  const m = sql.match(re);
  return m ? m[0] : null;
}

describe("artwork read RLS — primary policy stays on the equality path", () => {
  const last = lastFileCreatingPolicy("authenticated_read_artwork");

  it("has an effective migration for the primary policy", () => {
    expect(last, "no migration creates authenticated_read_artwork").toBeTruthy();
  });

  it("primary policy uses artwork_read_allowed and contains no LIKE scans", () => {
    const body = policyBody(last.sql, "authenticated_read_artwork");
    expect(body, `couldn't extract policy body from ${last.name}`).toBeTruthy();
    expect(body).toMatch(/artwork_read_allowed/i);
    expect(body, `${last.name}: LIKE scan back in the primary policy`).not.toMatch(/\blike\b/i);
  });

  it("artwork_read_allowed is SECURITY DEFINER (no nested-RLS evaluation)", () => {
    const defs = FILES.filter((f) => /function\s+public\.artwork_read_allowed/i.test(f.sql));
    expect(defs.length).toBeGreaterThan(0);
    const effective = defs[defs.length - 1].sql;
    expect(effective).toMatch(/artwork_read_allowed[\s\S]*?security definer/i);
  });

  it("the mapping table has its stamping trigger (tenant is server-derived)", () => {
    const withTrigger = FILES.filter((f) => /artwork_objects_stamp_owner_trg/i.test(f.sql));
    expect(withTrigger.length).toBeGreaterThan(0);
  });
});
