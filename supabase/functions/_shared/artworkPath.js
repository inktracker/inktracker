// Deno port of src/lib/artworkPath.js — resolve a bucket-relative storage
// path out of whatever shape an artwork reference takes (bare path, public
// URL, signed URL). Kept in lockstep with the frontend helper; the
// partnerHandoff edge function uses it to find the real object key behind
// an imprint's `artwork_url` before copying it into the receiver's tenant.
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
    try { return decodeURIComponent(m[1]); } catch { return m[1]; }
  }
  return null;
}
