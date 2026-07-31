import { supabase } from "@/api/supabaseClient";
import { resolveArtworkPath } from "./artworkPath";
import {
  validateUploadCandidate,
  rejectDangerousSvg,
  getLogoDownscaleDims,
  isTransformableArtworkPath,
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

  // Ownership mapping — the artwork read policy resolves tenancy through
  // artwork_objects by equality (20260827) instead of LIKE-scanning six
  // tables per read. A BEFORE INSERT trigger stamps uploader + shop_owner
  // server-side from the caller's profile; we send only the name.
  // Best-effort: on failure the transitional reference-based fallback
  // policy still grants reads once the quote/order row is saved.
  try {
    const { error: mapErr } = await supabase.from("artwork_objects").insert({ name: path });
    if (mapErr) console.warn("[uploadFile] artwork_objects mapping insert failed:", mapErr.message);
  } catch (mapErr) {
    console.warn("[uploadFile] artwork_objects mapping insert threw:", mapErr?.message || mapErr);
  }

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

// Downscale a raster logo to MAX_LOGO_DIMENSION before upload. jsPDF embeds
// images at native resolution regardless of draw size, so an oversized logo
// inflates every quote/invoice PDF — a 4200×4200 upload produced a 70 MB PDF
// that OOM-killed sendQuoteEmail (546) on every send from that shop. Fail-open:
// any decode/encode error returns the original file so uploads never break on
// an exotic-but-valid image. No crossOrigin involved — the source is a local
// File via object URL, so the canvas stays untainted.
async function downscaleLogoIfNeeded(file, ext) {
  let objectUrl = null;
  try {
    objectUrl = URL.createObjectURL(file);
    const img = await new Promise((resolve, reject) => {
      const i = new window.Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = objectUrl;
    });
    const dims = getLogoDownscaleDims(ext, img.naturalWidth, img.naturalHeight);
    if (!dims) return file;
    const canvas = document.createElement("canvas");
    canvas.width = dims.width;
    canvas.height = dims.height;
    canvas.getContext("2d").drawImage(img, 0, 0, dims.width, dims.height);
    // PNG keeps transparency; JPEGs re-encode as JPEG so the stored
    // extension stays truthful.
    const mime = ext === "png" ? "image/png" : "image/jpeg";
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.9));
    if (!blob) return file;
    return new File([blob], file.name, { type: mime });
  } catch {
    return file;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export async function uploadLogo(file, ownerId = "") {
  const ext = validateUploadCandidate(file);
  await rejectDangerousSvg(file, ext);
  file = await downscaleLogoIfNeeded(file, ext);
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

export async function signArtworkUrl(pathOrUrl, expiresInSec = DEFAULT_SIGNED_TTL, { width } = {}) {
  if (!pathOrUrl) return null;
  const path = resolveArtworkPath(pathOrUrl);
  if (!path) return null;
  // Optional server-side thumbnail (PRO image transforms, 2026-07-31).
  // Grid/thumb surfaces pass `width` so a 200px tile stops downloading a
  // print-res original; the guard is centralized HERE so callers don't
  // each have to know which formats the transformer supports. Falls back
  // to a plain signed URL if transform signing fails for any reason.
  const wantTransform = Number.isFinite(Number(width)) && Number(width) > 0 && isTransformableArtworkPath(path);
  try {
    if (wantTransform) {
      const { data } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, expiresInSec, { transform: { width: Number(width), quality: 80 } });
      if (data?.signedUrl) return data.signedUrl;
    }
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

