-- Finding (2026-06 anon-surface sweep): the `artwork` storage bucket granted
-- the anon role a SELECT policy of `USING (bucket_id = 'artwork')` with no
-- per-tenant path scoping. Because that policy governs the authenticated
-- storage API (incl. /object/list), any holder of the bundled anon key could
-- ENUMERATE every shop's uploaded artwork (confirmed: listed all 82 objects
-- cross-tenant) and download them.
--
-- Nothing in the app lists the bucket as anon (every .list() call is a DB
-- entity query, not storage). And the bucket is public:true, so legitimate
-- reads happen over /object/public/<path> (which bypasses RLS) — the public
-- ArtApproval page and proof emails use those durable URLs, and the signed-URL
-- helper (signArtworkUrl) already falls back to the public URL when signing
-- fails. So dropping anon SELECT closes the enumeration vector with no loss of
-- function:
--   * public-URL reads          -> still work (public bucket, no RLS)
--   * anon createSignedUrl       -> returns null -> caller falls back to public URL
--   * anon upload (wizard)       -> unaffected (separate INSERT policy)
--
-- Filenames are UUID + timestamp + random, so without listing they are
-- effectively unguessable. A future hardening pass may move to a private
-- bucket + signed URLs everywhere (tracked on the security roadmap).

-- NOTE: there were TWO SELECT policies exposing the bucket. `anon_read_artwork`
-- targeted the anon role; `Public read artwork` targeted the PUBLIC pseudo-role
-- (which includes anon). The latter is the one that actually enabled anon
-- listing — dropping only the anon-named one left enumeration open. Both are
-- removed here. Public-URL reads (/object/public/<path>) bypass RLS on a
-- public bucket, so legitimate proof/email/ArtApproval rendering is unaffected.

DROP POLICY IF EXISTS "anon_read_artwork" ON storage.objects;
DROP POLICY IF EXISTS "Public read artwork" ON storage.objects;
