-- Tenant-scope the tax-certificate bucket (audit SEC-01).
--
-- The original policies (20260722) let ANY authenticated user of ANY shop
-- SELECT/INSERT in the tax-certificates bucket — only the unguessable UUID
-- filename + no-list grant stood between one shop and another shop's
-- exemption cert (which contains a tax ID). That's obscurity, not authz.
--
-- Fix: objects are now stored under a "<shop_owner_email>/" path prefix
-- (see src/lib/tax/certificateStorage.js), and the policies require the first
-- path segment to be a shop the caller belongs to — their own shop
-- (current_user_email) or a shop assigned to them (broker/manager via
-- assigned_shop_emails_for). A path from another tenant no longer matches.
--
-- Safe to switch the path scheme outright: verified 0 existing objects in the
-- bucket and 0 customers with an exemption_certificate_path at deploy time.

DROP POLICY IF EXISTS "tax_cert_insert" ON storage.objects;
CREATE POLICY "tax_cert_insert" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'tax-certificates'
    AND (
      (storage.foldername(name))[1] = public.current_user_email()
      OR (storage.foldername(name))[1] IN (SELECT public.assigned_shop_emails_for(auth.uid()))
    )
  );

DROP POLICY IF EXISTS "tax_cert_select" ON storage.objects;
CREATE POLICY "tax_cert_select" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'tax-certificates'
    AND (
      (storage.foldername(name))[1] = public.current_user_email()
      OR (storage.foldername(name))[1] IN (SELECT public.assigned_shop_emails_for(auth.uid()))
    )
  );
