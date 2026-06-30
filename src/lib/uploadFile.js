import { supabase } from "@/api/supabaseClient";
import { resolveArtworkPath } from "./artworkPath";
import {
  validateUploadCandidate,
  rejectDangerousSvg,
  ALLOWED_UPLOAD_EXTS,
  MAX_UPLOAD_BYTES,
} from "./uploadValidation";

export { resolveArtworkPath };
// Re-export so existing call sites keep working without churn — the
// validation helpers moved to a separate file so tests can import them
// without transitively loading supabaseClient (which createClient()s at
// init and throws in CI).
export {
  validateUploadCandidate,
  ALLOWED_UPLOAD_EXTS,
  MAX_UPLOAD_BYTES,
};

const BUCKET = "artwork";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
// Default expiry for short-lived signed URLs (used when an authenticated
// user opens an artwork file inline). One hour is plenty for a viewing
// session; long enough to survive a slow PDF load.
const DEFAULT_SIGNED_TTL = 60 * 60;

export async function uploadFile(file) {
  const ext = validateUploadCandidate(file);
  await rejectDangerousSvg(file, ext);
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    // Filenames are unique (timestamp + random) and never overwritten, so the
    // content at a path is immutable — cache it for a year instead of
    // Supabase's 1-hour default, so repeat viewers don't re-download artwork
    // (the "short cache lifetime" Lighthouse flagged).
    .upload(path, file, { upsert: false, cacheControl: "31536000" });

  if (error) throw error;

  // `path` is the canonical reference — new callers should store it and call
  // signArtworkUrl(path) (the artwork bucket is now PRIVATE; M-1).
  //
  // `file_url` is a legacy public-FORM URL. The bucket no longer serves it
  // (private), but it's retained because every reader resolves the bucket path
  // back out of it (resolveArtworkPath) and the artworkProof proxy authorizes
  // the path from this `/artwork/<path>` form — so it still works as a path-
  // carrier for the dozens of consumers that read `file_url` off the result.
  // It is NOT a live URL; never render it directly without signing.
  const file_url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
  return { path, file_url };
}

// Shop / broker LOGOS are public branding (not customer artwork), and they're
// embedded in emails where they can't be signed — so they live in the public
// `public` bucket, NOT the artwork bucket (which is going private — M-1). Same
// validation as uploadFile (extension/size + scriptable-SVG rejection) so this
// path is no less safe than the artwork one. `ownerId` namespaces the key and
// is sanitized — never trust it raw in a storage path.
const LOGO_BUCKET = "logos";
export async function uploadLogo(file, ownerId = "") {
  const ext = validateUploadCandidate(file);
  await rejectDangerousSvg(file, ext);
  const safeId = String(ownerId || "logo").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "logo";
  const path = `logos/${safeId}_${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, file, { upsert: false, cacheControl: "31536000" });
  if (error) throw error;
  const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
  return { path, file_url: data.publicUrl };
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

// Open an artwork file in a new tab via a freshly-signed URL (M-1: authenticated
// "open artwork" / download links, so they keep working once the bucket is
// private). Falls back to the passed url if signing fails (works while the
// bucket is still public).
export async function openSignedArtwork(pathOrUrl) {
  if (!pathOrUrl) return;
  const signed = await signArtworkUrl(pathOrUrl);
  window.open(signed || pathOrUrl, "_blank", "noopener,noreferrer");
}

