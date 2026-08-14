// Regression guards for the line-level split hardening (audit 2026-08-14).
// These invariants are SQL/edge-fn behaviors with no pure-JS unit surface, so
// — like managerWriteGate.test.js — we assert them against the source text so
// a future edit that reintroduces a HIGH finding fails here.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migration = readFileSync(
  fileURLToPath(new URL("../../../migrations/20261004000000_partner_handoff_split.sql", import.meta.url)), "utf8");
const edgeFn = readFileSync(
  fileURLToPath(new URL("../../partnerHandoff/index.ts", import.meta.url)), "utf8");

describe("line-split: overlap atomicity (HIGH-2)", () => {
  it("the per-order unique index is dropped", () => {
    expect(migration).toMatch(/drop index if exists partner_handoffs_one_live_per_order/i);
  });
  it("offers insert through an advisory-locked function, not a bare read-then-insert", () => {
    expect(migration).toMatch(/function public\.offer_partner_handoff/);
    expect(migration).toMatch(/pg_advisory_xact_lock/);
    // The overlap re-check lives INSIDE that function (same txn as the insert).
    expect(migration).toMatch(/x = any\(h\.source_line_ids\)/);
  });
  it("the edge fn routes offers through the RPC (never a direct table insert)", () => {
    expect(edgeFn).toMatch(/db\.rpc\("offer_partner_handoff"/);
    expect(edgeFn).not.toMatch(/from\("partner_handoffs"\)\.insert/);
  });
});

describe("line-split: stored line ids (HIGH-1)", () => {
  it("records the RESOLVED line ids (null = all), never an empty array", () => {
    // The stored set IS what the overlap guard reads; a whole-order hand-off
    // must list every line. Guard against the `params.lineIds ?? []` regression.
    expect(edgeFn).toMatch(/params\.lineIds \?\? allLineIds/);
    expect(edgeFn).not.toMatch(/source_line_ids:\s*\(params\.lineIds \?\? \[\]\)/);
  });
});

describe("line-split: rollup correctness", () => {
  it("partner_cost sums only accepted/in_production/completed legs", () => {
    expect(migration).toMatch(/sum\(agreed_trade_total\)\s*filter\s*\(where status in \('accepted','in_production','completed'\)\)/);
  });
  it("a cancelled leg among completed ones never shows 'completed' (MEDIUM-1)", () => {
    expect(migration).toMatch(/when v_rank = 3 and v_has_cancelled then 'cancelled'/);
  });
});
