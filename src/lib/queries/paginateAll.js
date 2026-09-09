// Fetch every row past PostgREST's per-response cap (db-max-rows = 1000).
// A requested .limit(100000) is clamped to that cap server-side, so anything
// needing the FULL set (data export, import dedup) must page with .range().
//
// Pure loop: given a function that fetches page `n` (0-based), accumulate
// until a page comes back shorter than PAGE — that short page is the last.
// Extracted so the boundary logic is unit-tested without a live database.

export const PAGE = 1000;

export async function paginateAll(fetchPage, page = PAGE) {
  const out = [];
  for (let n = 0; ; n++) {
    const batch = await fetchPage(n);
    const rows = Array.isArray(batch) ? batch : [];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}
