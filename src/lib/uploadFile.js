import { supabase } from "@/api/supabaseClient";
import { resolveArtworkPath } from "./artworkPath";

export { resolveArtworkPath };

const BUCKET = "artwork";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
// Default expiry for short-lived signed URLs (used when an authenticated
// user opens an artwork file inline). One hour is plenty for a viewing
// session; long enough to survive a slow PDF load.
const DEFAULT_SIGNED_TTL = 60 * 60;

// Whitelist mirrors the file input's `accept` attribute on the wizard
// + quote editor. Centralizing here so a bypass through the upload
// helper (e.g. via DevTools or a custom embed) can't sneak through.
export const ALLOWED_UPLOAD_EXTS = Object.freeze(new Set([
  "ai", "eps", "pdf", "png", "jpg", "jpeg", "svg", "psd",
]));

// 25 MB ceiling. Real-world artwork rarely exceeds 10 MB; this caps
// the worst case while leaving headroom for high-res PSDs.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Validate the file shape BEFORE handing it to Supabase storage.
 * Throws a user-facing Error string callers can pass straight to
 * `notify.error`. Returns the lowercased extension so the caller
 * doesn't have to re-split.
 */
export function validateUploadCandidate(file) {
  if (!file) throw new Error("No file provided.");
  const ext = (file.name?.split(".").pop() || "").toLowerCase();
  if (!ALLOWED_UPLOAD_EXTS.has(ext)) {
    throw new Error(
      `File type ".${ext}" isn't allowed. Use AI, EPS, PDF, PNG, JPG, SVG, or PSD.`
    );
  }
  if (typeof file.size === "number" && file.size > MAX_UPLOAD_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    throw new Error(`File is ${mb} MB. Max upload size is 25 MB.`);
  }
  return ext;
}

/**
 * SVG can carry <script>, on* event handlers, xlink:href="javascript:…",
 * and foreignObject — all of which execute when the file is opened
 * inline in a browser tab. Reject anything containing those before
 * accepting the upload. Not bulletproof (CDATA, namespace tricks),
 * but catches every drive-by sample we'd realistically see. If a shop
 * later needs hardened SVG, swap in DOMPurify's SVG profile here.
 */
async function rejectDangerousSvg(file, ext) {
  if (ext !== "svg") return;
  let text;
  try { text = await file.text(); } catch { return; }
  if (
    /<script[\s>]/i.test(text) ||
    /\son[a-z]+\s*=/i.test(text) ||
    /(?:href|xlink:href)\s*=\s*["']?\s*javascript:/i.test(text) ||
    /<foreignObject/i.test(text) ||
    /<!ENTITY/i.test(text)
  ) {
    throw new Error(
      "This SVG contains scripts or event handlers and was rejected. " +
      "Re-export from your design tool as a plain SVG (no embedded scripts)."
    );
  }
}

export async function uploadFile(file) {
  const ext = validateUploadCandidate(file);
  await rejectDangerousSvg(file, ext);
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

