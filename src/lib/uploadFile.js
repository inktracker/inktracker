import { supabase } from "@/api/supabaseClient";

const BUCKET = "artwork";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
// Default expiry for short-lived signed URLs (used when an authenticated
// user opens an artwork file inline). One hour is plenty for a viewing
// session; long enough to survive a slow PDF load.
const DEFAULT_SIGNED_TTL = 60 * 60;

export async function uploadFile(file) {
  const ext = file.name?.split(".").pop() || "bin";
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false });

  if (error) throw error;

  // We return BOTH the bucket-relative path and the legacy public URL.
  //   - `path` is the new canonical reference; callers that store it can
  //     ask for a fresh signed URL on demand via `signArtworkUrl(path)`.
  //   - `file_url` is the public URL the bucket currently serves. Kept
  //     for backward compatibility with the dozens of consumers that
  //     read `file_url` directly off the upload result.
  const file_url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
  return { path, file_url };
}

// Convert a storage path OR a legacy public/signed URL into a freshly
// signed URL. Older artwork records only have the public URL; this
// helper parses the path out of those URLs so we can sign uniformly.
// Returns `null` if it can't resolve a path or signing fails — callers
// should fall back to whatever URL they already have.
export async function signArtworkUrl(pathOrUrl, expiresInSec = DEFAULT_SIGNED_TTL) {
  if (!pathOrUrl) return null;
  const path = resolveArtworkPath(pathOrUrl);
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, expiresInSec);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

// Extract the bucket-relative storage path from any form we've stored.
// Handles three cases:
//   1. bare path:           "1738282838-x1y2z3.pdf"
//   2. public URL:          ".../storage/v1/object/public/artwork/<path>"
//   3. existing signed URL: ".../storage/v1/object/sign/artwork/<path>?token=..."
// Anything else returns null.
export function resolveArtworkPath(input) {
  if (!input) return null;
  const s = String(input);
  // Bare path — no scheme, no slashes that look like a URL
  if (!/^https?:\/\//i.test(s)) return s;
  // Match the bucket segment in both public and signed Supabase URLs.
  const m = s.match(/\/storage\/v1\/object\/(?:public|sign)\/artwork\/([^?]+)/);
  if (m && m[1]) {
    try { return decodeURIComponent(m[1]); }
    catch { return m[1]; }
  }
  return null;
}
