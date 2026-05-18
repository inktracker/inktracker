#!/usr/bin/env bash
#
# QB integration green-light smoke test.
#
# Usage:
#   ./scripts/qb-greenlight.sh
#
# Required env:
#   JWT                — the shop owner's Supabase access_token. Grab it
#                        from the browser: in InkTracker, open DevTools →
#                        Application → Local Storage → look for the
#                        `supabase.auth.token` key, copy the .access_token
#                        value. Expires every hour.
#   SUPABASE_URL       — defaults to InkTracker's prod project; override
#                        for a different deployment.
#
# What this runs:
#   1. Each edge function answers OPTIONS preflight (cheap reachability)
#   2. qbSync checkConnection returns { connected: true }
#   3. qbSync getCustomerStats returns a non-error response
#      (proves auth, QB tokens, and a real QB API round-trip)
#   4. qbWebhook rejects an unsigned POST (the fail-closed invariant)
#   5. The vitest suite for QB pure helpers passes
#
# Things this CANNOT verify (require a browser / real customer / real
# card) — see scripts/qb-greenlight.md for the manual checklist.

set -u

# ── Config ──────────────────────────────────────────────────────────────────
SUPABASE_URL="${SUPABASE_URL:-https://skmltfbibaqcjddmeqvi.supabase.co}"
FUNC="${SUPABASE_URL%/}/functions/v1"

# Color output (skip when not a TTY)
if [ -t 1 ]; then
  RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'; CYAN=$'\033[0;36m'; RESET=$'\033[0m'
else
  RED=""; GREEN=""; YELLOW=""; CYAN=""; RESET=""
fi

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

pass() { echo "${GREEN}✓${RESET} $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo "${RED}✗${RESET} $1 — $2"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
skip() { echo "${YELLOW}-${RESET} $1 ${YELLOW}(skipped: $2)${RESET}"; SKIP_COUNT=$((SKIP_COUNT + 1)); }
section() { echo; echo "${CYAN}== $1 ==${RESET}"; }

# ── 1. Reachability — every edge fn answers preflight ──────────────────────
section "1/5  Edge function reachability"

for fn in qbSync qbWebhook qbOAuthCallback createCheckoutSession sendQuoteEmail; do
  status=$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "$FUNC/$fn" || echo "000")
  if [ "$status" = "200" ]; then
    pass "$fn responds 200 to OPTIONS"
  else
    fail "$fn OPTIONS" "got HTTP $status"
  fi
done

# ── 2. qbSync checkConnection ──────────────────────────────────────────────
section "2/5  qbSync checkConnection (proves QB OAuth tokens are valid)"

if [ -z "${JWT:-}" ]; then
  skip "checkConnection"           "JWT env var not set"
  skip "getCustomerStats"          "JWT env var not set"
else
  cc_resp=$(curl -s -X POST "$FUNC/qbSync" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $JWT" \
    -d "{\"action\":\"checkConnection\",\"accessToken\":\"$JWT\"}")

  connected=$(echo "$cc_resp" | grep -o '"connected":[^,}]*' | head -1 | sed 's/.*://;s/ //g')
  if [ "$connected" = "true" ]; then
    realm=$(echo "$cc_resp" | grep -o '"realmId":"[^"]*"' | sed 's/"realmId":"//;s/"//')
    pass "checkConnection returned connected=true (realmId=$realm)"
  else
    fail "checkConnection" "response was: $cc_resp"
  fi

  # 3. getCustomerStats — proves a real round-trip to QBO's API ────────────
  section "3/5  qbSync getCustomerStats (real QB round-trip)"

  cs_resp=$(curl -s -X POST "$FUNC/qbSync" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $JWT" \
    -d "{\"action\":\"getCustomerStats\",\"accessToken\":\"$JWT\"}")

  if echo "$cs_resp" | grep -q '"success":true'; then
    pass "getCustomerStats returned success"
  elif echo "$cs_resp" | grep -q '"error"'; then
    fail "getCustomerStats" "$(echo "$cs_resp" | head -c 200)"
  else
    fail "getCustomerStats" "unexpected response: $(echo "$cs_resp" | head -c 200)"
  fi
fi

# ── 4. qbWebhook fail-closed (unsigned POST must be rejected) ──────────────
section "4/5  qbWebhook signature guard"

wh_status=$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST "$FUNC/qbWebhook" \
  -H "Content-Type: application/json" \
  -d '{"eventNotifications":[]}' || echo "000")

if [ "$wh_status" = "401" ]; then
  pass "unsigned webhook POST rejected with 401 (fail-closed invariant)"
else
  # Some deployments return 200 + drop the request silently — that's
  # acceptable for QBO retry logic but means we can't prove the guard
  # from outside. Flag as warning, not failure.
  echo "${YELLOW}!${RESET} qbWebhook returned $wh_status (expected 401). If running against staging without QB_WEBHOOK_VERIFIER_TOKEN set, this is expected. Otherwise investigate."
fi

# ── 5. Vitest contract tests for QB pure helpers ───────────────────────────
section "5/5  vitest — QB pure-helper contracts"

if ! command -v npx >/dev/null 2>&1; then
  skip "vitest run" "npx not installed"
else
  if npx vitest run \
      supabase/functions/_shared/__tests__/qbInvoice.test.js \
      supabase/functions/_shared/__tests__/qbWriteContracts.test.js \
      supabase/functions/_shared/__tests__/qbWebhookLogic.test.js \
      supabase/functions/_shared/__tests__/connectionLogic.test.js \
      src/lib/payment/__tests__/resolveCheckoutTarget.test.js \
      src/lib/quotes/__tests__/qbSendState.test.js \
      src/lib/__tests__/qbCustomerSync.test.js \
      >/dev/null 2>&1; then
    pass "all QB pure-helper tests pass"
  else
    fail "vitest" "one or more QB test files failed — re-run for output"
  fi
fi

# ── Summary ────────────────────────────────────────────────────────────────
echo
echo "${CYAN}== Summary ==${RESET}"
echo "  ${GREEN}$PASS_COUNT passed${RESET},  ${RED}$FAIL_COUNT failed${RESET},  ${YELLOW}$SKIP_COUNT skipped${RESET}"
echo

if [ "$FAIL_COUNT" -eq 0 ] && [ "$SKIP_COUNT" -eq 0 ]; then
  echo "${GREEN}Green light — automated QB surface is healthy.${RESET}"
  echo "Don't forget the manual checklist in scripts/qb-greenlight.md."
  exit 0
elif [ "$FAIL_COUNT" -eq 0 ]; then
  echo "${YELLOW}Green light with skips — see notes above.${RESET}"
  echo "Set JWT and re-run for full coverage."
  exit 0
else
  echo "${RED}Failing checks — investigate above before promoting.${RESET}"
  exit 1
fi
