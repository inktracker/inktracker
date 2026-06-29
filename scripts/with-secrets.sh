#!/usr/bin/env bash
#
# with-secrets.sh — run an ops script with the Supabase service-role key pulled
# JUST-IN-TIME from the macOS Keychain, so the master key never sits in a
# plaintext .env file. (SEC-05 hygiene — see project_inktracker_full_audit.)
#
# One-time setup (paste the key from Supabase → Project Settings → API):
#   security add-generic-password -a "$USER" -s inktracker_service_role -w 'PASTE_KEY_HERE'
#   # to update later: add -U
#   security add-generic-password -U -a "$USER" -s inktracker_service_role -w 'NEW_KEY'
#
# Usage:
#   ./scripts/with-secrets.sh node scripts/diff-quotes.mjs Q-2026-A Q-2026-B
#   ./scripts/with-secrets.sh npm run audit:wizard
#
# What it exports for the wrapped command:
#   SUPABASE_SERVICE_ROLE_KEY  ← from Keychain (the secret)
#   SUPABASE_URL / VITE_SUPABASE_URL  ← from .env.local (non-secret) if present
#
# The secret is only ever in the environment of the child process; nothing is
# written to disk.

set -euo pipefail

KEYCHAIN_ACCOUNT="${KEYCHAIN_ACCOUNT:-$USER}"
KEYCHAIN_SERVICE="${KEYCHAIN_SERVICE:-inktracker_service_role}"

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command> [args...]" >&2
  echo "example: $0 node scripts/diff-quotes.mjs Q-2026-A Q-2026-B" >&2
  exit 64
fi

# Pull the service-role key from the Keychain.
if ! SERVICE_ROLE_KEY="$(security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null)"; then
  cat >&2 <<EOF
error: no Keychain entry "$KEYCHAIN_SERVICE" for account "$KEYCHAIN_ACCOUNT".

Store the service-role key once (from Supabase → Project Settings → API):
  security add-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$KEYCHAIN_SERVICE" -w 'PASTE_KEY_HERE'
EOF
  exit 1
fi

# Project URL is not a secret — read it from .env.local if present so scripts
# that expect SUPABASE_URL / VITE_SUPABASE_URL keep working.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env.local"
SUPABASE_URL_VALUE="${SUPABASE_URL:-${VITE_SUPABASE_URL:-}}"
if [ -z "$SUPABASE_URL_VALUE" ] && [ -f "$ENV_FILE" ]; then
  SUPABASE_URL_VALUE="$(grep -E '^(VITE_)?SUPABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"'' | xargs || true)"
fi

export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
[ -n "$SUPABASE_URL_VALUE" ] && export SUPABASE_URL="$SUPABASE_URL_VALUE" VITE_SUPABASE_URL="$SUPABASE_URL_VALUE"

exec "$@"
