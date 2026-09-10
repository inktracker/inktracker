// Page past PostgREST's per-response cap (db-max-rows = 1000) inside edge
// functions. A .limit(N) with N > 1000 is clamped server-side to the cap, so
// any query that needs the FULL set (books-drift scans, deposit skip-sets)
// must page with .range() instead.
//
// `buildQuery` MUST return a FRESH query builder on every call — .range() is
// applied to whatever it returns, so a reused builder would stack ranges.
// Give the query a deterministic .order() or pages can overlap/skip rows.

export const EDGE_PAGE = 1000;

export async function fetchAllRows(buildQuery, page = EDGE_PAGE) {
  const out = [];
  for (let n = 0; ; n++) {
    const { data, error } = await buildQuery().range(n * page, n * page + page - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows) out.push(r);
    if (rows.length < page) break;
  }
  return out;
}
