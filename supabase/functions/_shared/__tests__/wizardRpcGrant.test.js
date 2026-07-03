// Regression guard: submit_wizard_quote must stay service-role-only.
//
// The reCAPTCHA check for the public wizard lives in the wizardSubmit edge
// function, NOT in the RPC — any migration that grants EXECUTE on
// submit_wizard_quote back to anon/authenticated silently reopens the
// reCAPTCHA bypass that 20260824000000 closed (a client with the public anon
// key could call the RPC directly). This already drifted once: 20260823
// restored the bot guards and re-granted anon along the way.
//
// Same no-live-DB approach as managerWriteGate.test.js: the chronologically
// LAST migration that sets grants for the function is the effective state.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../migrations/", import.meta.url));

const FILES = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ name: f, sql: readFileSync(MIGRATIONS_DIR + f, "utf8") }));

// A file "sets the grants" when it GRANTs or REVOKEs on the function.
function lastFileSettingGrants() {
  let found = null;
  for (const f of FILES) {
    if (/(grant|revoke)[^;]*submit_wizard_quote/is.test(f.sql)) found = f;
  }
  return found;
}

describe("submit_wizard_quote grants — service-role only", () => {
  const last = lastFileSettingGrants();

  it("has a migration setting grants at all", () => {
    expect(last, "no migration GRANTs/REVOKEs submit_wizard_quote").toBeTruthy();
  });

  it("the effective (last) grant migration does not grant anon or authenticated", () => {
    // Strip REVOKE statements first — 'FROM anon, authenticated' in a REVOKE
    // is exactly what we want; only GRANT ... TO anon/authenticated is drift.
    const grantsOnly = last.sql
      .split(";")
      .filter((stmt) => /grant[^;]*submit_wizard_quote|submit_wizard_quote[^;]*\bto\b/is.test(stmt) && /\bgrant\b/i.test(stmt));
    for (const stmt of grantsOnly) {
      expect(stmt, `${last.name} grants browser roles:\n${stmt}`).not.toMatch(/\bto\b[^;]*\b(anon|authenticated)\b/is);
    }
  });

  it("keeps service_role EXECUTE so the wizardSubmit edge function still works", () => {
    expect(last.sql).toMatch(/grant\s+execute[^;]*submit_wizard_quote[^;]*service_role/is);
  });
});
