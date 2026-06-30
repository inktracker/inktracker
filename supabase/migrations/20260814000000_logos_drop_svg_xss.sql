-- NEW-07 (Medium): the public `logos` bucket (20260812) allowed image/svg+xml.
-- A scripted SVG (with <script> / on* handlers) served INLINE from a public
-- storage origin executes as the storage domain — stored XSS. The client-side
-- rejectDangerousSvg check in uploadLogo is bypassable: any logged-in shop/
-- broker can POST straight to the bucket with the bundled anon key. The bucket's
-- allowed_mime_types is the only SERVER-SIDE gate, so SVG must be dropped there —
-- exactly what the artwork bucket already does (20260710030000).
--
-- Logos are raster branding; PNG/JPEG/WebP/GIF cover every real case.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
WHERE id = 'logos';
