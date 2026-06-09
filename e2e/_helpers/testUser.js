// Test-user lifecycle for Playwright e2e specs.
//
// Each test that needs auth creates a brand-new test user via the
// Supabase admin API (service role from env), confirms them up front
// so signup → confirm flow doesn't block, and tears them down
// afterwards. This guarantees a clean MFA state for every run — no
// leftover factors from a previous attempt to debug.
//
// The service-role key MUST NOT ship to the browser. This module is
// only imported from spec files, which run in Node land.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  // Eager error so the spec file fails immediately instead of mid-run.
  throw new Error(
    "e2e helpers need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env. " +
    "Set them in .env.local (which dotenv/config in playwright.config.js loads) " +
    "before running `npm run e2e`."
  );
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Create a confirmed test user with a unique email + known password.
 * Returns { email, password, id } — the spec uses email/password to
 * sign in via the LoginModal, and id for cleanup.
 *
 * @returns {Promise<{ email: string, password: string, id: string }>}
 */
export async function createTestUser() {
  const email = `playwright+${randomUUID()}@inktracker.test`;
  const password = `Pw!${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // skip the email confirmation step
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  return { email, password, id: data.user.id };
}

/**
 * Delete the user + everything cascade-tied to them (profiles,
 * mfa_recovery_codes, mfa_audit_log, mfa_trusted_devices all have
 * ON DELETE CASCADE on user_id, so the admin delete is enough).
 *
 * @param {string} userId
 */
export async function deleteTestUser(userId) {
  if (!userId) return;
  await admin.auth.admin.deleteUser(userId).catch(() => { /* best effort */ });
}
