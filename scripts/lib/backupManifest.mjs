// Backup manifest + previous-run comparison (T3). Each nightly backup writes
// a manifest (per-table row counts for the DB export; per-bucket object
// count + bytes for storage). The workflow feeds the PREVIOUS run's manifest
// back in, and a backup that silently collapsed — a previously non-empty
// table now empty, or a drastic shrink — FAILS the job instead of uploading
// a hollow artifact that nobody discovers until restore day.
//
// Pure logic, unit-tested in scripts/__tests__/backupManifest.test.js.

// A table/bucket that legitimately shrinks a little (purges, deletes) must
// not page anyone. "Drastic" = lost more than half, measured only above a
// floor where percentages are meaningful.
export const SHRINK_RATIO = 0.5;
export const SHRINK_FLOOR = 20;

export function buildDbManifest(tableCounts, authCount) {
  return {
    kind: "db",
    tables: { ...tableCounts },
    auth_users: authCount ?? null,
    total_rows: Object.values(tableCounts).reduce((s, n) => s + n, 0),
  };
}

export function buildStorageManifest(buckets) {
  // buckets: { name: { count, bytes } }
  return {
    kind: "storage",
    buckets: { ...buckets },
    total_objects: Object.values(buckets).reduce((s, b) => s + b.count, 0),
    total_bytes: Object.values(buckets).reduce((s, b) => s + b.bytes, 0),
  };
}

export function compareManifests(prev, cur) {
  const problems = [];
  if (!prev) return { ok: true, problems, note: "no previous manifest — first run, nothing to compare" };
  if (prev.kind !== cur.kind) return { ok: true, problems, note: `kind mismatch (${prev.kind} vs ${cur.kind}) — skipping compare` };

  const pairs = cur.kind === "db"
    ? Object.entries(prev.tables ?? {}).map(([k, v]) => [k, v, cur.tables?.[k]])
    : Object.entries(prev.buckets ?? {}).map(([k, v]) => [k, v.count, cur.buckets?.[k]?.count]);

  for (const [name, prevN, curN] of pairs) {
    if (curN === undefined) {
      problems.push(`${name}: present in previous backup, MISSING from this one`);
      continue;
    }
    if (prevN > 0 && curN === 0) {
      problems.push(`${name}: was ${prevN}, now EMPTY`);
      continue;
    }
    if (prevN >= SHRINK_FLOOR && curN < prevN * SHRINK_RATIO) {
      problems.push(`${name}: shrank ${prevN} → ${curN} (>${Math.round((1 - SHRINK_RATIO) * 100)}% loss)`);
    }
  }

  if (cur.kind === "db" && (prev.auth_users ?? 0) > 0 && (cur.auth_users ?? 0) === 0) {
    problems.push(`auth_users: was ${prev.auth_users}, now EMPTY`);
  }
  return { ok: problems.length === 0, problems };
}
