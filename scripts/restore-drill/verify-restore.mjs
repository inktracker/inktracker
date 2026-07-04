#!/usr/bin/env node
// Restore-drill assertions. Fails loudly (exit 1) unless ALL hold:
//   1. every public table the baseline defines exists in the drill DB
//   2. every fixture table's row count EQUALS the fixture's line count
//   3. data_integrity_violations() reports zero violations
// Prints a machine-greppable DRILL-ASSERT line per check for the CI log.
import { readdir, readFile } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = process.argv[2] || join(here, "fixture");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

let ok = true;
const fail = (msg) => { ok = false; console.error(`DRILL-ASSERT FAIL: ${msg}`); };
const pass = (msg) => console.log(`DRILL-ASSERT ok: ${msg}`);

// 1. Every table named in the baseline exists
const baseline = await readFile(join(here, "..", "..", "supabase", "migrations", "20260430000000_baseline_schema.sql"), "utf8");
const expected = [...baseline.matchAll(/CREATE TABLE IF NOT EXISTS "public"\."(\w+)"/g)].map((m) => m[1]);
const { rows: present } = await client.query(
  `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
const presentSet = new Set(present.map((r) => r.tablename));
const missing = expected.filter((t) => !presentSet.has(t));
if (missing.length) fail(`baseline tables missing after replay: ${missing.join(", ")}`);
else pass(`all ${expected.length} baseline tables exist (${presentSet.size} total in schema)`);

// 2. Fixture row-count equality — plus HARD FLOORS so a silently-truncated
// committed fixture (restore and verify agreeing on too-few rows) still
// fails. Update floors consciously when the fixture legitimately changes.
const FLOORS = { profiles: 2, shops: 2, customers: 3, quotes: 4, orders: 2, invoices: 2 };
for (const f of (await readdir(fixtureDir)).filter((f) => f.endsWith(".jsonl"))) {
  const table = basename(f, ".jsonl");
  if (table === "auth_users") continue;
  const want = (await readFile(join(fixtureDir, f), "utf8")).split("\n").filter(Boolean).length;
  const floor = FLOORS[table] ?? 1;
  if (want < floor) fail(`${table}: fixture itself has only ${want} rows (floor ${floor}) — was it truncated?`);
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM "${table}"`);
  if (rows[0].n !== want) fail(`${table}: restored ${rows[0].n} rows, fixture has ${want}`);
  else pass(`${table}: ${rows[0].n}/${want} rows restored`);
}

// 3. Integrity oracle — the same function the nightly cron uses in prod
const { rows: viol } = await client.query(`SELECT * FROM data_integrity_violations()`);
const totalViolations = viol.reduce((s, r) => s + Number(r.missing_link) + Number(r.dangling_link), 0);
if (totalViolations !== 0) fail(`data_integrity_violations() reports ${totalViolations}: ${JSON.stringify(viol)}`);
else pass(`data_integrity_violations() clean: ${JSON.stringify(viol.map((r) => `${r.tbl}:0/0`))}`);

await client.end();
if (!ok) process.exit(1);
console.log("DRILL-ASSERT ALL PASSED");
