-- Public `logos` bucket for shop/broker branding (M-1 stage 3a).
--
-- Logos are public branding embedded in emails (where they can't be signed), so
-- they must NOT live in the `artwork` bucket that's going private. There was no
-- real public bucket — the onboarding upload targeted a non-existent `public`
-- bucket and silently fell back to `artwork`, which is why every logo ended up
-- there. Create a proper public, image-only bucket so logos render anywhere
-- (incl. emails) without auth, independent of the artwork bucket's privacy.
--
-- public=true: served at /object/public/logos/<path> with no auth (branding is
-- meant to be world-readable). Uploads are authenticated-only (shop/broker in
-- Account / BrokerProfile / OnboardingWizard) — never the anon wizard role.
-- Scriptable-SVG rejection is enforced client-side in uploadLogo (rejectDangerousSvg).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'logos',
  'logos',
  true,
  26214400,  -- 25 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- Authenticated upload; public read (it's a public bucket).
DROP POLICY IF EXISTS "logos_insert" ON storage.objects;
CREATE POLICY "logos_insert" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'logos');

DROP POLICY IF EXISTS "logos_read" ON storage.objects;
CREATE POLICY "logos_read" ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'logos');
