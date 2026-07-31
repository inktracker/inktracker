// Pure validation helpers for artwork uploads. Lives separate from
// uploadFile.js so tests + other importers can use these without
// transitively loading supabaseClient (which calls createClient at
// module init and throws "supabaseUrl is required" in CI without
// VITE_SUPABASE_URL set).
//
// Re-exported from uploadFile.js so the existing public surface stays
// stable for callers.

// Whitelist mirrors the file input's `accept` attribute on the wizard
// + quote editor. Centralizing here so a bypass through the upload
// helper (e.g. via DevTools or a custom embed) can't sneak through.
//
// SVG is intentionally EXCLUDED: an SVG served inline from the public storage
// origin can execute embedded scripts (stored XSS). The real guard is the
// bucket's server-side allowed_mime_types (migration 20260710030000), which
// rejects image/svg+xml regardless of the client; dropping it here just gives
// the user a clean "not allowed" message instead of a storage error.
export const ALLOWED_UPLOAD_EXTS = Object.freeze(new Set([
  "ai", "eps", "pdf", "png", "jpg", "jpeg", "psd",
]));

// 25 MB ceiling. Real-world artwork rarely exceeds 10 MB; this caps
// the worst case while leaving headroom for high-res PSDs.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// Logos render at ~50px in email headers and 14mm in PDF headers, so 512px
// covers 3x-retina display with headroom. The cap exists because jsPDF embeds
// images at NATIVE resolution regardless of draw size — a shop's 4200×4200
// print-res logo produced a 70 MB quote PDF whose base64 payload OOM-killed
// the sendQuoteEmail edge function (546 WORKER_LIMIT) on every send.
export const MAX_LOGO_DIMENSION = 512;

// Only formats the canvas can decode + re-encode get downscaled; vector /
// design formats (ai, eps, pdf, psd) pass through untouched.
const RASTER_LOGO_EXTS = new Set(["png", "jpg", "jpeg"]);

/**
 * Decide whether (and to what size) an uploaded logo needs downscaling.
 * Pure: returns null when the file should upload as-is, else the target
 * {width, height} preserving aspect ratio with max dimension capped.
 */
export function getLogoDownscaleDims(ext, width, height, maxDim = MAX_LOGO_DIMENSION) {
  if (!RASTER_LOGO_EXTS.has(String(ext || "").toLowerCase())) return null;
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  if (w <= maxDim && h <= maxDim) return null;
  const scale = maxDim / Math.max(w, h);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

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
      `File type ".${ext}" isn't allowed. Use AI, EPS, PDF, PNG, JPG, or PSD.`
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
export async function rejectDangerousSvg(file, ext) {
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

// ── Image-transform eligibility (PRO, 2026-07-31) ───────────────────────────
// Raster formats Supabase Image Transformations can resize. SVG/BMP/PDF
// (and anything else) must be signed plain — requesting a transform on
// them errors at fetch time. Pure so it's testable without supabaseClient;
// signArtworkUrl (uploadFile.js) and the artworkProof proxy both apply
// this rule. Keep in lockstep with RASTER_RE in
// supabase/functions/artworkProof/index.ts.
export function isTransformableArtworkPath(path) {
  return /\.(jpe?g|png|gif|webp)$/i.test(String(path ?? ""));
}
