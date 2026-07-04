#!/usr/bin/env node
// Nightly logical DATA backup of every public table (2026-07-03). The
// Supabase org is on the free plan, which has NO automated database
// backups — until the Pro upgrade (planned at 5 paying shops), a bad
// migration or fat-fingered delete would be unrecoverable. Schema is
// reproducible from supabase/migrations/; this exports the DATA as
// one JSONL file per table so the nightly GitHub Action can archive it
// off-platform, same pattern as backup-storage.mjs.
//
// NOT covered: auth.users (identities/password hashes live in the auth
// schema, unreachable over PostgREST) and storage objects (that's
// backup-storage.mjs). profiles carries the app-level user data, so a
// restore means: replay migrations → re-insert JSONL → users re-verify
// via email. Documented in docs/disaster-recovery.md.
//
// Env: SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY.
// Local use: ./scripts/with-secrets.sh node scripts/backup-database.mjs
// Writes to ./db-backup/<table>.jsonl. Prints a per-table row count.

import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile, appendFile } from "node:fs/promises";

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const OUT = "db-backup";
const PAGE = 1000;
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

// Enumerate tables from PostgREST's OpenAPI root so newly-created tables are
// picked up automatically — a hardcoded list would silently stop covering the
// schema the day a migration adds a table.
async function listTables() {
  const res = await fetch(`${URL}/rest/v1/`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`OpenAPI root: ${res.status}`);
  const spec = await res.json();
  return Object.keys(spec.definitions || {}).sort();
}

// Stable pagination needs an ORDER BY; most tables have an `id` PK. For the
// few that don't, retry unordered — acceptable for small tables, and a
// repeated/skipped row in a backup beats a failed one.
async function dumpTable(table) {
  const path = `${OUT}/${table}.jsonl`;
  await writeFile(path, "");
  let offset = 0;
  let rows = 0;
  let orderById = true;
  for (;;) {
    let q = sb.from(table).select("*").range(offset, offset + PAGE - 1);
    if (orderById) q = q.order("id", { ascending: true });
    let { data, error } = await q;
    if (error && orderById && /column .*id.* does not exist|42703/.test(error.message + (error.code || ""))) {
      orderById = false;
      ({ data, error } = await sb.from(table).select("*").range(offset, offset + PAGE - 1));
    }
    if (error) throw new Error(`${table} @${offset}: ${error.message}`);
    if (!data || data.length === 0) break;
    await appendFile(path, data.map((r) => JSON.stringify(r)).join("\n") + "\n");
    rows += data.length;
    if (data.length < PAGE) break;
    offset += data.length;
  }
  return rows;
}

// ── auth identities (T4) ────────────────────────────────────────────
// The auth schema is unreachable over PostgREST, but the GoTrue Admin API
// (service role) lists users. Export the RECOVERABLE identity fields —
// id, email, timestamps, app/user metadata, and identity providers — into
// auth_users.jsonl. Deliberately NOT exported: password hashes, tokens,
// TOTP secrets (the Admin API doesn't return them, and a backup that
// widens the attack surface is worse than one that doesn't). After a
// restore, users on email/password re-verify; the re-link procedure is in
// docs/disaster-recovery.md.
async function dumpAuthUsers() {
  const path = `${OUT}/auth_users.jsonl`;
  await writeFile(path, "");
  let page = 1;
  let rows = 0;
  for (;;) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`auth.admin.listUsers p${page}: ${error.message}`);
    const users = data?.users ?? [];
    if (!users.length) break;
    const slim = users.map((u) => ({
      id: u.id,
      email: u.email,
      email_confirmed_at: u.email_confirmed_at ?? null,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      app_metadata: u.app_metadata ?? {},
      user_metadata: u.user_metadata ?? {},
      identities: (u.identities ?? []).map((i) => ({
        provider: i.provider,
        identity_id: i.identity_id ?? i.id,
        created_at: i.created_at,
      })),
    }));
    await appendFile(path, slim.map((r) => JSON.stringify(r)).join("\n") + "\n");
    rows += users.length;
    if (users.length < 200) break;
    page++;
  }
  return rows;
}

await mkdir(OUT, { recursive: true });

const tables = await listTables();
if (!tables.length) {
  console.error("[db-backup] OpenAPI root returned zero tables — aborting.");
  process.exit(1);
}

let failed = 0;
let grandTotal = 0;
for (const table of tables) {
  try {
    const rows = await dumpTable(table);
    grandTotal += rows;
    console.log(`[db-backup] ${table}: ${rows} rows`);
  } catch (e) {
    failed++;
    console.error(`[db-backup] ${table} FAILED: ${e.message}`);
  }
}

// auth identities ride in the same backup set (T4) — a restore without
// them strands every profiles.auth_id reference.
try {
  const authRows = await dumpAuthUsers();
  grandTotal += authRows;
  console.log(`[db-backup] auth_users: ${authRows} identities`);
} catch (e) {
  failed++;
  console.error(`[db-backup] auth_users FAILED: ${e.message}`);
}

console.log(`[db-backup] ${tables.length - failed}/${tables.length} tables, ${grandTotal} rows total`);
if (failed > 0) {
  // Fail the job loudly — a partial backup that looks green is how you find
  // out at restore time that the one table you needed wasn't in it.
  process.exit(1);
}
