-- Private storage bucket for tax-exemption certificates (Phase 2 of multi-state
-- tax). A resale/exemption certificate contains a tax ID — it must NOT live in
-- the public `artwork` bucket, where /object/public/<path> bypasses RLS and the
-- file is world-readable to anyone who learns the path. This bucket is
-- public=false: there is no public URL; reads require a short-lived signed URL,
-- and only authenticated (signed-in) users — never the anon/public wizard role
-- — can upload or sign. See src/lib/tax/certificateStorage.js.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tax-certificates',
  'tax-certificates',
  false,
  26214400,  -- 25 MB, matching the client cap
  ARRAY['application/pdf', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO NOTHING;

-- Authenticated-only INSERT/SELECT scoped to this bucket. Objects are unlisted
-- (no list grant) with unguessable UUID filenames, so without listing a path is
-- effectively unguessable. A future pass can add per-tenant path scoping for
-- defense-in-depth; the priority here is closing the public/anon exposure.
DROP POLICY IF EXISTS "tax_cert_insert" ON storage.objects;
CREATE POLICY "tax_cert_insert" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'tax-certificates');

DROP POLICY IF EXISTS "tax_cert_select" ON storage.objects;
CREATE POLICY "tax_cert_select" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'tax-certificates');
