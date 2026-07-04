#!/usr/bin/env node
// T5 RLS behavior proof, run inside the restore drill against the REAL
// replayed policies (not a mock). Simulates an authenticated shop owner the
// way PostgREST does (SET ROLE + request.jwt.claims GUC) and asserts the
// soft-delete contract end to end:
//   1. owner sees their live quote
//   2. owner can soft-delete it (UPDATE deleted_at)
//   3. the wrapper-shaped read (deleted_at IS NULL) filters it out
//   4. …and untouchable (UPDATE matches 0 rows — no undelete)
//   5. …and client hard-DELETE is refused (0 rows)
//   6. the service role (superuser here) still sees it — recoverable
//   7. soft-deleting a Completed order raises (historical-record parity)
//   8. a soft-deleted row with a dangling customer does NOT trip the
//      integrity oracle (live-rows-only semantics)
// Leaves the fixture in its original state (undeletes at the end) so it can
// run after verify-restore.mjs without disturbing its row counts.
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

let ok = true;
const fail = (m) => { ok = false; console.error(`SOFT-DELETE-ASSERT FAIL: ${m}`); };
const pass = (m) => console.log(`SOFT-DELETE-ASSERT ok: ${m}`);

const QUOTE = "40000000-0000-4000-8000-000000000001"; // owner1's Sent quote
const COMPLETED_ORDER = "50000000-0000-4000-8000-000000000002"; // owner2's Completed order

const asOwner = async (email, sub, fn) => {
  await client.query("BEGIN");
  await client.query(`SET LOCAL ROLE authenticated`);
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ email, sub, role: "authenticated" })]);
  await client.query(`SELECT set_config('request.jwt.claim.email', $1, true)`, [email]);
  await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [sub]);
  await client.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`);
  try { return await fn(); } finally { await client.query("COMMIT").catch(() => client.query("ROLLBACK")); }
};
const OWNER1 = ["owner1@drill.example", "00000000-0000-4000-8000-000000000001"];
const OWNER2 = ["owner2@drill.example", "00000000-0000-4000-8000-000000000002"];

// 1. owner sees the live quote
await asOwner(...OWNER1, async () => {
  const { rows } = await client.query(`SELECT id FROM quotes WHERE id = $1`, [QUOTE]);
  rows.length === 1 ? pass("owner sees their live quote") : fail("owner cannot see their live quote");
});

// 2. owner soft-deletes it
await asOwner(...OWNER1, async () => {
  const r = await client.query(`UPDATE quotes SET deleted_at = now() WHERE id = $1`, [QUOTE]);
  r.rowCount === 1 ? pass("owner can soft-delete (deleted_at set)") : fail(`soft-delete matched ${r.rowCount} rows`);
});

// 3–5. filtered from app-shaped reads, un-editable, un-hard-deletable.
// Read-filtering lives in the entity wrapper (every app read appends
// deleted_at IS NULL — enforced by the source-contract test in
// src/api/__tests__/softDelete.test.js); here we assert the DB honors that
// query shape, and that the WRITE protections are pure RLS.
await asOwner(...OWNER1, async () => {
  const sel = await client.query(`SELECT id FROM quotes WHERE id = $1 AND deleted_at IS NULL`, [QUOTE]);
  sel.rows.length === 0 ? pass("wrapper-shaped read filters the soft-deleted row") : fail("wrapper-shaped read still returns the row");
  const upd = await client.query(`UPDATE quotes SET deleted_at = NULL WHERE id = $1`, [QUOTE]);
  upd.rowCount === 0 ? pass("client cannot undelete (UPDATE matches 0)") : fail("client UN-deleted a soft-deleted row");
  const del = await client.query(`DELETE FROM quotes WHERE id = $1`, [QUOTE]);
  del.rowCount === 0 ? pass("client hard-DELETE refused (0 rows)") : fail("client hard-deleted a row");
});

// 6. service role still sees it (recoverable)
{
  const { rows } = await client.query(`SELECT deleted_at FROM quotes WHERE id = $1`, [QUOTE]);
  rows.length === 1 && rows[0].deleted_at
    ? pass("service role sees the soft-deleted row (recoverable)")
    : fail("soft-deleted row not recoverable via service role");
}

// 7. Completed orders refuse soft-delete (parity with the DELETE guard)
await asOwner(...OWNER2, async () => {
  try {
    await client.query(`UPDATE orders SET deleted_at = now() WHERE id = $1`, [COMPLETED_ORDER]);
    fail("soft-deleting a Completed order was allowed");
  } catch (e) {
    /Cannot delete a Completed order/.test(e.message)
      ? pass("Completed order refuses soft-delete (historical-record parity)")
      : fail(`unexpected error soft-deleting Completed order: ${e.message}`);
  }
});

// 8. integrity oracle ignores soft-deleted rows (live-only semantics)
{
  await client.query(`UPDATE quotes SET customer_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff' WHERE id = $1`, [QUOTE]);
  const { rows } = await client.query(`SELECT * FROM data_integrity_violations()`);
  const total = rows.reduce((s, r) => s + Number(r.missing_link) + Number(r.dangling_link), 0);
  total === 0
    ? pass("integrity oracle ignores soft-deleted rows (dangling link on deleted row → 0)")
    : fail(`integrity oracle counted soft-deleted rows: ${JSON.stringify(rows)}`);
}

// restore fixture state
await client.query(
  `UPDATE quotes SET deleted_at = NULL, customer_id = '30000000-0000-4000-8000-000000000001' WHERE id = $1`, [QUOTE]);

await client.end();
if (!ok) process.exit(1);
console.log("SOFT-DELETE-ASSERT ALL PASSED");
