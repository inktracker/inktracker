# Service-role key rotation runbook

The service-role key **bypasses every RLS policy** — it is the master key. Rotate
it (a) on a schedule as hygiene, and (b) immediately if it's ever exposed (leaked
backup, wrong paste, ex-contributor). This runbook makes rotation **zero-downtime
with no user logout**, if you follow the path below.

_Prepared 2026-07-23. Verified against the live project + Supabase docs._

---

## 1. Where the key actually lives (the whole map)

| Consumer | How it gets the key | Update on rotation? |
|---|---|---|
| **GitHub repo secret** `SUPABASE_SERVICE_ROLE_KEY` — used by `db-backup.yml`, `storage-backup.yml` | repo secret | **YES — manual** |
| **Local macOS Keychain** `inktracker_service_role` — used by every `scripts/*.mjs` via `scripts/with-secrets.sh` (incl. `npm run audit:wizard`, so also `npm run predeploy` / `npm run deploy`) | Keychain | **YES — manual** |
| **Supabase Edge Functions** — read `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` | **platform-injected** (Supabase auto-provides it; it never leaves Supabase) | **NO — auto** (just verify) |
| **Vercel / frontend** | — | **N/A** — confirmed absent; the browser only ever gets the *anon* key |
| **Local `.env*` files** | — | **N/A** — confirmed the key value is Keychain-only, never in a plaintext file |

**So the entire external attack surface is two places:** the GitHub secret and your
Keychain. Everything else is internal to Supabase or doesn't hold the key at all.

---

## 2. Pick the path

This project already has the **new API-key system + asymmetric JWT signing keys**
enabled (`SUPABASE_JWKS` / `SUPABASE_SECRET_KEYS` / `SUPABASE_PUBLISHABLE_KEYS` are
present). That unlocks the safe paths.

### Path A — Migrate the two external copies to a dedicated `sb_secret_` key  ✅ RECOMMENDED
This is the right default for **hygiene rotation**. It's zero-downtime, logs nobody
out, and gives you a key you can revoke independently the instant it leaks — without
ever touching edge functions or user sessions. It also *shrinks* the blast radius:
the powerful legacy key stays internal to Supabase; the copies that actually travel
(CI, your laptop) become a scoped, independently-revocable key.

### Path B — Rotate the asymmetric JWT signing key
Use if the **legacy `service_role` JWT itself** is compromised. Supabase moves the
current signing key to "previously used" (still trusted for verification) and
promotes a standby — **"No users get signed out."** After all outstanding tokens
expire (wait **≥ 1h15m** past your token TTL), revoke the old key.

### Path C — Rotate the legacy JWT secret  ⚠️ EMERGENCY ONLY
**"Currently active users get immediately signed out,"** and it rotates the anon key
too. Only do this if you need to invalidate everything *right now* and accept a mass
logout. Expect to also update the Vercel `VITE_SUPABASE_ANON_KEY`.

---

## 3. Path A — step by step (add-new-before-remove-old = no downtime)

**Golden rule: never have a moment with no valid key. Add the new key everywhere and
verify BEFORE revoking the old one.**

1. **Create the new key.** Supabase Dashboard → **Project Settings → API Keys** →
   create a new **secret key** (`sb_secret_…`). Name it something like `ci-and-ops`.
   Copy it once (you won't see it again).

2. **Update the GitHub secret:**
   ```bash
   gh secret set SUPABASE_SERVICE_ROLE_KEY -R inktracker/inktracker --body 'sb_secret_…'
   ```

3. **Update the local Keychain** (the `-U` updates in place):
   ```bash
   security add-generic-password -U -a "$USER" -s inktracker_service_role -w 'sb_secret_…'
   ```

4. **Verify the new key works — BEFORE revoking anything:**
   ```bash
   ./scripts/with-secrets.sh npm run verify:service-role   # local Keychain copy
   gh workflow run db-backup.yml --ref main -R inktracker/inktracker   # CI copy → must go green + ping healthchecks
   ```
   Both must succeed. (Backups + `audit:wizard` exercise the exact same key path.)

5. **Confirm edge functions are unaffected** (they use the internal platform key, so
   they should already be fine): trigger one that needs service-role, e.g.
   `gh workflow run qb-reconcile.yml --ref main -R inktracker/inktracker` → HTTP 200.

6. **Only now, revoke the old key.** In the Dashboard, delete the previous secret /
   old `service_role` exposure you're rotating away from. Deletion is irreversible —
   which is why step 4 comes first.

### Rollback (if step 4 fails)
Re-set the GitHub secret and Keychain back to the **old** value (you still have it
until step 6), re-run the verify. Nothing was revoked, so there's no outage.

---

## 4. What does NOT change
- **No code changes.** Every consumer reads the key from `process.env` /
  `Deno.env` / a GitHub `secrets.*` reference — rotation is pure config.
- **Vercel / the frontend** — untouched (never held the key).
- **User sessions** — untouched on Path A and Path B.

## 5. Cadence
- **Scheduled:** rotate via Path A every 6–12 months.
- **On exposure:** immediately. If the *legacy* key leaked, do Path B (or Path C if
  you must force-logout everyone). If only the CI/Keychain copy leaked, Path A +
  revoke the old `sb_secret_` key is enough.
