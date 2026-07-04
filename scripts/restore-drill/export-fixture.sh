#!/usr/bin/env bash
# Exports the drill database's fixture tables to committed JSONL in the SAME
# format scripts/backup-database.mjs produces (one JSON object per line), so
# the drill's restore step exercises the real backup file format.
# Run after replay-migrations.sh + make-fixture.sql against the drill DB.
set -euo pipefail
: "${DRILL_PSQL:?set DRILL_PSQL to a psql command for the drill database}"

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/fixture"
mkdir -p "$OUT"

# auth identities first — the same shape backup-database.mjs exports (T4)
$DRILL_PSQL -At -c "SELECT row_to_json(x) FROM (SELECT id, email, raw_app_meta_data AS app_metadata, raw_user_meta_data AS user_metadata, created_at, '[]'::json AS identities FROM auth.users ORDER BY id) x" > "$OUT/auth_users.jsonl"
echo "auth_users: $(wc -l < "$OUT/auth_users.jsonl" | tr -d ' ') rows"

TABLES="profiles shops customers quotes orders invoices expenses notification_log qb_event_log"
for t in $TABLES; do
  # shellcheck disable=SC2086
  $DRILL_PSQL -At -c "SELECT row_to_json(x) FROM (SELECT * FROM $t ORDER BY id) x" > "$OUT/$t.jsonl"
  echo "$t: $(wc -l < "$OUT/$t.jsonl" | tr -d ' ') rows"
done
