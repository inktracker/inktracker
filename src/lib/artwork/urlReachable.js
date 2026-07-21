// Preflight for remote artwork URLs before they're handed to an <object>,
// <iframe>, or full-page embed. Browsers render whatever body a dead storage
// URL returns — for Supabase that's a raw `{"statusCode":"404","error":
// "Bucket not found"}` JSON page, which is exactly what a customer saw on
// their art proof (#681). Probing first lets the caller swap in a friendly
// "couldn't load" state instead.
//
// HEAD keeps it cheap: no body download, and (with no custom headers) no CORS
// preflight. Both URL forms we embed — the artworkProof proxy (302 → signed
// URL) and direct signed storage URLs — answer HEAD with the same status as
// GET. Network/CORS failures count as unreachable: if we can't verify it,
// embedding it risks rendering a raw error body.
export async function probeUrl(url) {
  if (!url) return false;
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}
