// change_log RLS guard — the audit trail's WHO must not be forgeable.
//
// `actor` is the only record of who touched a document (team members act
// under the owner's shop_owner). Both authenticated INSERT policies must
// pin actor to the caller's own JWT email (or null); a future migration
// that re-sets either WITH CHECK without the pin would quietly reopen
// attribution forgery. Same read-the-migration-SQL pattern as the NEW-05
// manager-gate guard: the chronologically LAST migration touching a
// policy reflects the effective live shape.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../migrations/", import.meta.url));

const FILES = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ name: f, sql: readFileSync(MIGRATIONS_DIR + f, "utf8") }));

const ACTOR_PIN = /actor\s+IS\s+NULL\s+OR\s+actor\s*=\s*\(\(SELECT auth\.jwt\(\)\)\s*->>\s*'email'\)/i;

function lastFileSettingPolicy(policy) {
  let found = null;
  for (const f of FILES) {
    if (f.sql.includes(policy) && /with\s+check/i.test(f.sql)) found = f;
  }
  return found;
}

describe("change_log insert policies pin actor to the caller (anti-forgery)", () => {
  for (const policy of ["change_log_insert_own", "change_log_insert_team"]) {
    it(`${policy}: latest WITH CHECK keeps the actor pin`, () => {
      const f = lastFileSettingPolicy(policy);
      expect(f, `no migration sets ${policy}`).toBeTruthy();
      expect(f.sql, `${f.name} dropped the actor pin from ${policy}`).toMatch(ACTOR_PIN);
    });
  }

  it("no UPDATE or DELETE policy exists for authenticated users (append-only)", () => {
    const all = FILES.map((f) => f.sql).join("\n");
    // An audit trail the shop can rewrite isn't one. Match any policy
    // granting UPDATE/DELETE on change_log.
    expect(all).not.toMatch(/CREATE POLICY\s+\S*\s+ON\s+public\.change_log\s+FOR\s+(UPDATE|DELETE)/i);
  });
});
