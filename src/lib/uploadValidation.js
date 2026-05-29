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
