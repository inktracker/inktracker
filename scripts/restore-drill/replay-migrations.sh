#!/usr/bin/env bash
# Replays the Supabase environment shim + every migration, in version order,
# against the Postgres given by DRILL_PSQL (e.g. "psql -h localhost -U postgres
# -d drill"). Stops loudly on the first error — an un-replayable schema is the
# failure this drill exists to catch.
set -euo pipefail

: "${DRILL_PSQL:?set DRILL_PSQL to a psql command for the drill database}"

DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS_DIR="$DIR/../../supabase/migrations"

run() {
  # shellcheck disable=SC2086
  $DRILL_PSQL -v ON_ERROR_STOP=1 -q -f "$1"
}

echo "── shim"
run "$DIR/supabase-shim.sql"

# Version-order = leading digit run, then full name (matches supabase CLI
# ordering; lexical sort alone mis-orders 20260501_x.sql vs 20260501000000_y.sql).
count=0
while IFS= read -r f; do
  echo "── $(basename "$f")"
  run "$f"
  count=$((count + 1))
done < <(ls "$MIGRATIONS_DIR"/*.sql | awk -F/ '{
    name = $NF
    digits = name
    sub(/[^0-9].*$/, "", digits)
    printf "%-14s %s %s\n", digits, name, $0
  }' | sort | awk "{print \$3}")

echo "✓ replayed $count migrations cleanly"
