#!/usr/bin/env node
// verify-service-role-key.mjs — confirm the SUPABASE_SERVICE_ROLE_KEY currently
// in the environment actually has service-role privileges, BEFORE you revoke the
// old key during a rotation (see docs/service-role-key-rotation.md).
//
// It performs an operation only the service_role can do (auth admin listUsers).
// An anon/publishable key fails it; the service_role / sb_secret key passes.
//
// Env: SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY.
// Usage: ./scripts/with-secrets.sh npm run verify:service-role

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error("[verify] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}

// Non-secret hint about which key generation is in use — never prints the value.
const kind = KEY.startsWith("sb_secret_")
  ? "new secret key (sb_secret_…)"
  : KEY.startsWith("ey")
    ? "legacy service_role JWT (ey…)"
    : "unrecognized format";
console.log(`[verify] key kind: ${kind}`);

const admin = createClient(URL, KEY, { auth: { persistSession: false } });

try {
  // Service-role-only: listing auth users is denied to anon/publishable keys.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) throw error;
  console.log(`[verify] ✓ service-role confirmed — auth admin reachable (${data?.users?.length ?? 0} user row read).`);
  process.exit(0);
} catch (e) {
  console.error(`[verify] ✗ FAILED — this key does NOT have service-role access: ${e.message}`);
  console.error("[verify] Do NOT revoke the old key. Roll the env/secret back and re-check.");
  process.exit(1);
}
