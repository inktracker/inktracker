import { resolveArtworkPath } from "@/lib/artworkPath";

// Build a token-gated artworkProof proxy URL so an ANONYMOUS surface
// (QuotePayment / ArtApproval) can render private-bucket artwork without being
// able to sign it itself. The proxy (supabase/functions/artworkProof) validates
// the quote/order token + that the path belongs to that row, then 302-redirects
// to a fresh signed URL — so this URL is safe to put in an <img src>.
//
// Returns null when it can't resolve a path or is missing id/token, so callers
// fall back to whatever URL they already have (M-1; safe while the bucket is
// still public).
// `width` (optional) requests a server-side thumbnail from the proxy
// (Supabase Image Transformations, PRO). Must be one of the proxy's
// whitelisted widths (320 / 640 / 1024) — anything else is ignored
// server-side and the original is served. Use for grid/thumb contexts
// only; enlarge/download surfaces omit it so the customer approves the
// full-quality original.
export function artworkProxyUrl({ type, id, token, pathOrUrl, width }) {
  // MUST be the bare `import.meta.env.X` form — optional chaining
  // (`import.meta?.env?.X`) defeats Vite's build-time replacement, so the
  // production bundle reads import.meta.env at runtime, gets undefined, and
  // this returns null for EVERY caller (customers then fall back to the dead
  // public-bucket URL → "Bucket not found").
  const base = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const path = resolveArtworkPath(pathOrUrl);
  if (!base || !id || !token || !path) return null;
  const w = Number.isFinite(Number(width)) && Number(width) > 0
    ? `&w=${encodeURIComponent(Number(width))}`
    : "";
  return `${base}/functions/v1/artworkProof?type=${encodeURIComponent(type)}` +
    `&id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}` +
    `&path=${encodeURIComponent(path)}${w}`;
}
