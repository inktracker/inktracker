#!/usr/bin/env bash
#
# setup-ci-secrets.sh — wire the GitHub repo secrets the DR/monitoring
# workflows need (audit OPS-02/04/05), pulling the service-role key from the
# macOS Keychain so you never paste it. Idempotent: safe to re-run.
#
# Sets, on the GitHub repo this folder points at (inferred from `git remote`):
#   SUPABASE_URL                ← .env.local (non-secret project URL)   [storage-backup]
#   SUPABASE_SERVICE_ROLE_KEY   ← Keychain (the master key)             [storage-backup]
#   HEALTHCHECK_RECONCILE_URL   ← prompted (optional)                   [dead-man's-switch]
# and checks whether CRON_SECRET already exists (set earlier for qb-reconcile).
#
# Prereqs: `gh auth login` done once; the Keychain entry that with-secrets.sh uses.
# Run:  ./scripts/setup-ci-secrets.sh
#
# NOTE: values are piped to `gh secret set NAME` (no --body) so gh reads the
# secret from stdin. Do NOT use `--body -` — gh treats that as the literal
# value "-", not "read stdin" (that bug set every secret to "-" once).

set -euo pipefail

KEYCHAIN_ACCOUNT="${KEYCHAIN_ACCOUNT:-$USER}"
KEYCHAIN_SERVICE="${KEYCHAIN_SERVICE:-inktracker_service_role}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env.local"

bold(){ printf '\033[1m%s\033[0m\n' "$1"; }
ok(){ printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn(){ printf '  \033[33m!\033[0m %s\n' "$1"; }

# --- 0. gh authenticated + a repo to target -------------------------------
command -v gh >/dev/null || { echo "error: GitHub CLI 'gh' not installed (brew install gh)"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "error: run 'gh auth login' first."; exit 1; }
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
[ -n "$REPO" ] || { echo "error: not inside a GitHub repo (no git remote)."; exit 1; }
bold "Target repo: $REPO"

# --- 1. service-role key from Keychain (never printed) --------------------
if ! SERVICE_ROLE_KEY="$(security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null)"; then
  echo "error: no Keychain entry \"$KEYCHAIN_SERVICE\". Store it once:"
  echo "  security add-generic-password -a \"$USER\" -s $KEYCHAIN_SERVICE -w 'PASTE_KEY'"
  exit 1
fi

# --- 2. project URL from .env.local (non-secret) --------------------------
SUPABASE_URL_VALUE="$(grep -E '^(VITE_)?SUPABASE_URL=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"'' | xargs || true)"
[ -n "$SUPABASE_URL_VALUE" ] || { echo "error: SUPABASE_URL not found in .env.local"; exit 1; }

# --- 3. set the two storage-backup secrets --------------------------------
bold "Setting secrets…"
printf '%s' "$SUPABASE_URL_VALUE"  | gh secret set SUPABASE_URL              --repo "$REPO" ; ok "SUPABASE_URL"
printf '%s' "$SERVICE_ROLE_KEY"    | gh secret set SUPABASE_SERVICE_ROLE_KEY --repo "$REPO" ; ok "SUPABASE_SERVICE_ROLE_KEY (from Keychain)"
unset SERVICE_ROLE_KEY

# --- 4. CRON_SECRET: warn if missing (must match the Supabase function secret) ---
if gh secret list --repo "$REPO" | grep -q '^CRON_SECRET'; then
  ok "CRON_SECRET already set (qb-reconcile)"
else
  warn "CRON_SECRET is NOT set — qb-reconcile will fail until you add it."
  warn "It must MATCH the Supabase function secret. To view/set on Supabase:"
  warn "    supabase secrets list        # check if CRON_SECRET exists"
  warn "    gh secret set CRON_SECRET --repo $REPO   # paste the SAME value"
fi

# --- 5. dead-man's-switch ping URL (optional) -----------------------------
bold "Dead-man's-switch (OPS-05)"
echo "Create a free check at https://healthchecks.io (period 1 day, grace 2h),"
echo "copy its ping URL (https://hc-ping.com/<uuid>), and paste it here."
read -r -p "  HEALTHCHECK_RECONCILE_URL (blank to skip): " HC_URL || true
if [ -n "${HC_URL:-}" ]; then
  printf '%s' "$HC_URL" | gh secret set HEALTHCHECK_RECONCILE_URL --repo "$REPO" ; ok "HEALTHCHECK_RECONCILE_URL"
else
  warn "skipped — heartbeat step will no-op until this is set."
fi

# --- 6. summary -----------------------------------------------------------
bold "Current repo secrets:"
gh secret list --repo "$REPO"
cat <<EOF

Next (not done by this script):
  • Vercel env for /api/health: confirm VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
      are set on the Production environment (Vercel → Project → Settings → Env).
  • Smoke-test now via the Actions tab → "Run workflow" on:
      Storage backup · Uptime monitor · QB nightly reconcile
  • SECURITY (audit NEW-01): rotate the service-role key, then re-store the NEW
      value in Keychain and re-run this script — the old key sat in plaintext on
      disk and should be treated as compromised:
        security add-generic-password -U -a "$USER" -s $KEYCHAIN_SERVICE -w 'NEW_KEY'
EOF
bold "Done."
