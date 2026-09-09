// Pure merge for GlobalSearch: fold content-search RPC hits (job_title /
// line-item matches from search_docs_content) into the column-search result
// lists, without duplicating rows both searches found. Column matches keep
// their position (they matched the visible name/id, so they read as more
// direct); content hits append after, capped so the panel stays scannable.

const CAP = 7;

export function mergeContentHits(baseRows, rpcRows, kind, idField) {
  const base = Array.isArray(baseRows) ? baseRows : [];
  const extras = (Array.isArray(rpcRows) ? rpcRows : [])
    .filter((r) => r && r.kind === kind)
    .filter((r) => !base.some((b) => b.id === r.id))
    .map((r) => ({
      id: r.id,
      [idField]: r.doc_id,
      job_title: r.job_title,
      customer_name: r.customer_name,
      _contentHit: true,
    }));
  return [...base, ...extras].slice(0, CAP);
}
