-- HOTFIX (M-1 regression): authenticated in-app artwork views are broken in
-- production — the full-screen proof viewer, AttachmentGallery thumbnails,
-- "open artwork" links, and the PDF export all show
--   {"statusCode":"404","error":"Bucket not found","message":"Bucket not found"}
--
-- ROOT CAUSE: a chain of two correct-in-isolation migrations that compose into
-- a break:
--   1. 20260705 dropped "anon_read_artwork" (SELECT) to close an anon-key
--      cross-tenant ENUMERATION vector. That policy was granted to BOTH
--      `anon` AND `authenticated`, so dropping it removed SELECT for logged-in
--      users too. Harmless at the time — the bucket was still public, so reads
--      went over /object/public/<path> (RLS-free) and client signing just fell
--      back to the public URL.
--   2. 20260813 (M-1) flipped the bucket PRIVATE, on the stated assumption that
--      an "anon_read_artwork (SELECT, anon+authenticated)" policy still existed
--      so authenticated users could createSignedUrl client-side. It did not —
--      it had been gone since step 1.
--
-- Net effect once private: NO role has SELECT on artwork objects, so every
-- client-side signArtworkUrl() returns null and every authenticated reader
-- falls back to the public URL — which on a private bucket returns the
-- "Bucket not found" error above. (Anonymous customer-facing reads are
-- unaffected: the token-gated artworkProof proxy signs via the service-role
-- key, which bypasses RLS.)
--
-- FIX: re-grant SELECT, but ONLY to `authenticated` — NOT `anon`. Logged-in
-- shop/manager/employee/broker users sign artwork client-side; anonymous
-- customers go through the proxy and never need direct SELECT. This restores
-- in-app function without reopening the anon-key enumeration vector that
-- 20260705 closed (that vector required the bundled anon key; real accounts
-- carry an audit trail). Artwork paths remain flat + unguessable
-- (timestamp+random); a future hardening pass can path-scope authenticated
-- reads or route them through the proxy too.
--
-- ROLLBACK: DROP POLICY IF EXISTS "authenticated_read_artwork" ON storage.objects;

DROP POLICY IF EXISTS "authenticated_read_artwork" ON storage.objects;

CREATE POLICY "authenticated_read_artwork"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'artwork');
