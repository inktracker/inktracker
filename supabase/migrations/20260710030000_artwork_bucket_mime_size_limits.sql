-- ============================================================================
-- SECURITY (MEDIUM): enforce artwork-bucket MIME allowlist + size limit at the
-- STORAGE layer (server-side), closing the SVG stored-XSS vector.
-- ============================================================================
-- The `artwork` bucket is public with no allowed_mime_types and no
-- file_size_limit. Upload type/size validation was CLIENT-SIDE only
-- (uploadValidation.js), which a caller bypasses by uploading directly with the
-- bundled anon key. SVG was an allowed type; an SVG served inline from the
-- public storage origin executes its embedded <script>/on*/foreignObject — a
-- stored XSS.
--
-- Fix: constrain the bucket to legitimate print-artwork MIME types. Crucially,
-- `image/svg+xml`, `text/html`, and `application/xhtml+xml` are NOT in the list,
-- so the storage API rejects any upload declaring those types regardless of the
-- client. `application/octet-stream` is allowed because browser file inputs
-- send it for AI/PSD binaries — but content stored as octet-stream is DOWNLOADED
-- by the browser, never rendered/executed, so it carries no script-execution
-- risk. The only inline-renderable-and-scriptable types are excluded.
--
-- Also sets a 25 MB file_size_limit (matching the client cap) so the anon key
-- can't push arbitrarily large objects.
-- ============================================================================

UPDATE storage.buckets
SET
  file_size_limit = 26214400, -- 25 MB
  allowed_mime_types = ARRAY[
    'image/png',
    'image/jpeg',
    'application/pdf',
    'application/postscript',          -- .ai / .eps
    'application/illustrator',         -- some .ai exports
    'image/vnd.adobe.photoshop',       -- .psd
    'application/x-photoshop',         -- .psd (alt)
    'application/octet-stream'         -- browser fallback for AI/PSD binaries (downloaded, not rendered)
  ]
WHERE id = 'artwork';
