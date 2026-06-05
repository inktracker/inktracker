-- The public quote wizard (QuoteRequest.jsx → uploadFile()) uploads
-- artwork before the customer is authenticated. After the 2026-05-01
-- RLS lockdown, anonymous INSERT/SELECT on storage.objects was lost
-- and these uploads started failing with:
--   "new row violates row-level security policy"
--
-- Re-grant exactly what the wizard needs, scoped to the `artwork`
-- bucket:
--   - INSERT for anon + authenticated: the wizard's `uploadFile()`
--     path uses the anon Supabase client.
--   - SELECT for anon + authenticated: so the generated public URL
--     (used to render the uploaded artwork preview in quotes /
--     emails / approvals) actually resolves.
--
-- Per-file size + MIME validation is enforced client-side in
-- src/lib/uploadValidation.js and by the bucket's storage limits, so
-- the RLS layer does not need to filter on file size or extension.

DROP POLICY IF EXISTS "anon_upload_artwork"  ON storage.objects;
DROP POLICY IF EXISTS "anon_read_artwork"    ON storage.objects;

CREATE POLICY "anon_upload_artwork"
  ON storage.objects
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'artwork');

CREATE POLICY "anon_read_artwork"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'artwork');
