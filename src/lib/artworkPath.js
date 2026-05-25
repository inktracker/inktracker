// Pure helper for resolving a bucket-relative storage path out of
// whatever shape an artwork reference takes (bare path, public URL,
// signed URL). Kept dependency-free so tests can import it without
// pulling in the Supabase client (which throws at module-load time
// when env vars aren't set — e.g. in CI).
//
//   1. bare path:           "1738282838-x1y2z3.pdf"
//   2. public URL:          ".../storage/v1/object/public/artwork/<path>"
//   3. existing signed URL: ".../storage/v1/object/sign/artwork/<path>?token=..."
//
// Anything else returns null.

export function resolveArtworkPath(input) {
  if (!input) return null;
  const s = String(input);
  if (!/^https?:\/\//i.test(s)) return s;
  const m = s.match(/\/storage\/v1\/object\/(?:public|sign)\/artwork\/([^?]+)/);
  if (m && m[1]) {
    try { return decodeURIComponent(m[1]); }
    catch { return m[1]; }
  }
  return null;
}
