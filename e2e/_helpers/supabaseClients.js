// Supabase clients for e2e specs.
//
// - admin: service role (bypasses RLS) — set up + tear down fixtures.
// - anonClient(): the same anon key the browser ships with — used to prove
//   that RLS / storage policies actually deny, exactly as a real client hits
//   them. The service-role key NEVER reaches these.
// - authedClient(email, password): an anon-key client signed in AS a specific
//   user, so queries run under that user's RLS context. This is how the
//   tenant-isolation + subscription-gate specs assert the real security
//   boundary deterministically (no UI scraping).
//
// Spec files only (Node) — never imported into the browser bundle.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  throw new Error(
    "e2e supabaseClients needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + " +
    "VITE_SUPABASE_ANON_KEY in env (.env.local).",
  );
}

export const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export function anonClient() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function authedClient(email, password) {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`authedClient sign-in failed for ${email}: ${error.message}`);
  return c;
}
