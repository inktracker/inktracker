#!/usr/bin/env node
// Restores a JSONL database export (the output of scripts/backup-database.mjs)
// into a target database. THIS IS THE CANONICAL RESTORE PATH — the weekly
// restore drill (.github/workflows/restore-drill.yml) runs this exact script
// so a real disaster uses code that is exercised every week, not a runbook
// paragraph that was never executed.
//
// Two targets, same ordering/chunking logic:
//   DATABASE_URL=postgres://…   direct Postgres (drill container, scratch DB)
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY   PostgREST (real Supabase project)
//
// Usage:
//   node scripts/restore-database.mjs <backup-dir>
//   node scripts/restore-database.mjs db-backup --only quotes,orders
//
// Ordering: tables with FK/logical parents load first (RESTORE_FIRST), then
// everything else alphabetically. Any batch that fails on the first pass is
// retried after all other tables have loaded (handles FK dependencies the
// static order doesn't know about); persistent failures fail the run.

import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: restore-database.mjs <backup-dir> [--only t1,t2]");
  process.exit(2);
}
const onlyArg = process.argv.indexOf("--only");
const only = onlyArg > -1 ? new Set(process.argv[onlyArg + 1].split(",")) : null;

// Parents before children. Everything not listed loads after these,
// alphabetically. (The schema has few hard FKs — DB-03 — but logical
// parent-child order also keeps integrity checks meaningful mid-restore.)
const RESTORE_FIRST = [
  "profiles", "shops", "profile_secrets", "customers",
  "quotes", "orders", "invoices",
];

const CHUNK = 500;

// ── Target adapters ─────────────────────────────────────────────────
async function makeTarget() {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    // Column type map per table: JSON exports can't distinguish a jsonb []
    // from a text[] {} — the target schema can. json/jsonb values get
    // stringified; native Postgres arrays pass through as JS arrays (node-pg
    // serializes those correctly); everything else passes through.
    const typeCache = new Map();
    async function colTypes(table) {
      if (!typeCache.has(table)) {
        const { rows } = await client.query(
          `SELECT column_name, data_type FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1`, [table]);
        typeCache.set(table, Object.fromEntries(rows.map((r) => [r.column_name, r.data_type])));
      }
      return typeCache.get(table);
    }
    return {
      name: "postgres",
      async insert(table, rows) {
        const types = await colTypes(table);
        // Columns = union across the chunk; missing keys insert as DEFAULT/NULL.
        const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
        const values = [];
        const tuples = rows.map((r, i) => {
          const ph = cols.map((c, j) => {
            let v = r[c];
            if (v === undefined) v = null;
            else if (v !== null && typeof v === "object" && types[c] !== "ARRAY") v = JSON.stringify(v);
            values.push(v);
            return `$${i * cols.length + j + 1}`;
          });
          return `(${ph.join(",")})`;
        });
        // ON CONFLICT DO NOTHING = idempotent re-runs (matches backup's
        // possible duplicate rows from unordered pagination).
        await client.query(
          `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES ${tuples.join(",")} ON CONFLICT DO NOTHING`,
          values,
        );
      },
      async close() { await client.end(); },
    };
  }
  const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) {
    console.error("Set DATABASE_URL (direct) or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (PostgREST).");
    process.exit(2);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(URL, KEY, { auth: { persistSession: false } });
  return {
    name: "postgrest",
    async insert(table, rows) {
      const { error } = await sb.from(table).upsert(rows, { ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    },
    async close() {},
  };
}

// ── Load ────────────────────────────────────────────────────────────
const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
const tables = files
  .map((f) => basename(f, ".jsonl"))
  .filter((t) => !only || only.has(t))
  // auth_users.jsonl is identity reference material for the runbook's
  // re-link procedure, NOT a public table — never blind-insert it.
  .filter((t) => t !== "auth_users")
  .sort((a, b) => {
    const ia = RESTORE_FIRST.indexOf(a), ib = RESTORE_FIRST.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });

const target = await makeTarget();
console.log(`[restore] target=${target.name} dir=${dir} tables=${tables.length}`);

// ── auth identities (auth_users.jsonl, produced by the T4 export) ───
// Direct-Postgres targets (the drill, a scratch restore cluster) can insert
// them straight into auth.users so profiles.auth_id FKs resolve. A real
// Supabase project can't take auth-schema writes over PostgREST — there the
// runbook's re-link procedure (Admin API createUser per row, then profiles
// rejoin by email) applies, and we just say so.
if (files.includes("auth_users.jsonl") && (!only || only.has("auth_users"))) {
  const rows = (await readFile(join(dir, "auth_users.jsonl"), "utf8"))
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  if (target.name === "postgres") {
    const { default: pg } = await import("pg");
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    for (const u of rows) {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at)
         VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()))
         ON CONFLICT (id) DO NOTHING`,
        [u.id, u.email, JSON.stringify(u.app_metadata ?? {}), JSON.stringify(u.user_metadata ?? {}), u.created_at ?? null],
      );
    }
    await c.end();
    console.log(`[restore] auth.users: ${rows.length} identities re-established (direct)`);
  } else {
    console.warn(`[restore] auth_users.jsonl present (${rows.length} identities) — PostgREST target cannot write the auth schema. Follow the re-link procedure in docs/disaster-recovery.md (Admin API createUser per identity).`);
  }
}

const failed = [];
async function loadTable(table) {
  const raw = await readFile(join(dir, `${table}.jsonl`), "utf8");
  const rows = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  if (!rows.length) {
    console.log(`[restore] ${table}: 0 rows (skipped)`);
    return 0;
  }
  for (let i = 0; i < rows.length; i += CHUNK) {
    await target.insert(table, rows.slice(i, i + CHUNK));
  }
  console.log(`[restore] ${table}: ${rows.length} rows`);
  return rows.length;
}

let total = 0;
for (const t of tables) {
  try {
    total += await loadTable(t);
  } catch (e) {
    console.warn(`[restore] ${t} deferred (${e.message.slice(0, 120)})`);
    failed.push(t);
  }
}
// Second pass: FK-order stragglers, now that parents exist.
for (const t of [...failed]) {
  try {
    total += await loadTable(t);
    failed.splice(failed.indexOf(t), 1);
  } catch (e) {
    console.error(`[restore] ${t} FAILED on retry: ${e.message}`);
  }
}

await target.close();
console.log(`[restore] done: ${total} rows across ${tables.length - failed.length}/${tables.length} tables`);
if (failed.length) {
  console.error(`[restore] UNRECOVERED tables: ${failed.join(", ")}`);
  process.exit(1);
}
