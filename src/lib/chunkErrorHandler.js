// Detects when a dynamic import() fails because the chunk hash changed
// (typical after a Vercel deploy: the user's open tab still has the OLD
// index-XYZ.js shell that references chunks named jspdf-OLDHASH.js, but the
// server now only has jspdf-NEWHASH.js, so fetching returns 404).
//
// We watch unhandled promise rejections — that's how dynamic imports surface
// errors when the calling code awaits them but doesn't catch.
//
// Usage:
//   installChunkErrorHandler((err) => setShowUpdateBanner(true));

const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,   // Vite production
  /Importing a module script failed/i,              // Safari variant
  /error loading dynamically imported module/i,     // Vite dev variant
  /ChunkLoadError/i,                                // webpack-style fallback
  /Loading chunk \d+ failed/i,                      // older webpack variant
];

function looksLikeChunkError(reason) {
  if (!reason) return false;
  const message = String(reason?.message || reason);
  return CHUNK_ERROR_PATTERNS.some((re) => re.test(message));
}

let installed = false;

export function installChunkErrorHandler(onChunkError) {
  if (installed) return;
  installed = true;

  // Promise rejections from awaited dynamic imports.
  window.addEventListener("unhandledrejection", (event) => {
    if (looksLikeChunkError(event.reason)) {
      // Don't spam the console with the noisy stack — it's a known/handled case.
      event.preventDefault();
      // eslint-disable-next-line no-console
      console.warn("[chunkErrorHandler] stale chunk detected — prompting reload");
      try { onChunkError(event.reason); } catch {}
    }
  });

  // Synchronous-looking script load errors (rare with Vite, but cheap to add).
  window.addEventListener("error", (event) => {
    if (looksLikeChunkError(event.error || event.message)) {
      // eslint-disable-next-line no-console
      console.warn("[chunkErrorHandler] script error detected — prompting reload");
      try { onChunkError(event.error || event.message); } catch {}
    }
  });
}
