-- TASK 1 (NEW-08): close the authenticated cross-tenant artwork read.
--
-- 20260815 re-granted artwork SELECT to ALL authenticated users with
-- `USING (bucket_id = 'artwork')` — so any logged-in user could sign + read
-- any shop's artwork if they knew the (flat, timestamp+random) path. The
-- anonymous/public leak is already closed (bucket is private; anon has no
-- SELECT; the token-gated artworkProof proxy serves anon via service-role).
-- This closes the AUTHENTICATED residual.
--
-- Approach (B, realized at the RLS layer — no object migration, no reader
-- changes, no new edge function): grant SELECT only when the object's
-- `/artwork/<name>` path is REFERENCED BY A ROW the caller's shop owns, using
-- the SAME tenant predicate every other shop-scoped table uses
-- (current_user_email() OR assigned_shop_emails_for(auth.uid())) and the SAME
-- artwork-bearing source tables the purge enumeration uses
-- (_shared/shopPurge.js ARTWORK_SOURCE_TABLES). Net effect: a user who can
-- read the quote/order/message/broker-doc that references an artwork object can
-- sign it; a path from another tenant matches no row in their scope → denied.
--
--   * Owners match via current_user_email() (their rows are shop_owner = email).
--   * Managers/brokers match via assigned_shop_emails_for() (assigned_shops).
--   * The proxy + any service-role signer bypass RLS, so anonymous proof pages
--     are unaffected.
--
-- The `/artwork/<name>` form is present in every stored reference's url/file_url
-- (the M-1 path-carrier), so this matches exactly what extractArtworkPaths
-- matches. Names are unique (timestamp+random) so a substring collision is
-- not a practical concern.
--
-- ROLLBACK (re-open, do NOT leave long-term):
--   DROP POLICY IF EXISTS "authenticated_read_artwork" ON storage.objects;
--   CREATE POLICY "authenticated_read_artwork" ON storage.objects FOR SELECT
--     TO authenticated USING (bucket_id = 'artwork');
--
-- DEPLOY NOTE: this migration only TIGHTENS an existing policy; no function or
-- frontend deploy is required first. After applying, verify a real in-app
-- artwork view (proof overlay / AttachmentGallery thumbnail) still renders for
-- the owning shop before considering it done.

DROP POLICY IF EXISTS "authenticated_read_artwork" ON storage.objects;

CREATE POLICY "authenticated_read_artwork"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'artwork'
    AND (
      EXISTS (
        SELECT 1 FROM public.quotes q
        WHERE (q.shop_owner = public.current_user_email()
               OR q.shop_owner IN (SELECT public.assigned_shop_emails_for(auth.uid())))
          AND (q.selected_artwork::text LIKE '%/artwork/' || storage.objects.name || '%'
               OR q.line_items::text     LIKE '%/artwork/' || storage.objects.name || '%')
      )
      OR EXISTS (
        SELECT 1 FROM public.orders o
        WHERE (o.shop_owner = public.current_user_email()
               OR o.shop_owner IN (SELECT public.assigned_shop_emails_for(auth.uid())))
          AND (o.selected_artwork::text LIKE '%/artwork/' || storage.objects.name || '%'
               OR o.line_items::text     LIKE '%/artwork/' || storage.objects.name || '%')
      )
      OR EXISTS (
        SELECT 1 FROM public.messages m
        WHERE (m.shop_owner = public.current_user_email()
               OR m.shop_owner IN (SELECT public.assigned_shop_emails_for(auth.uid())))
          AND m.attachment_url LIKE '%/artwork/' || storage.objects.name || '%'
      )
      OR EXISTS (
        SELECT 1 FROM public.broker_documents d
        WHERE (d.shop_owner = public.current_user_email()
               OR d.shop_owner IN (SELECT public.assigned_shop_emails_for(auth.uid())))
          AND d.file_url LIKE '%/artwork/' || storage.objects.name || '%'
      )
      OR EXISTS (
        SELECT 1 FROM public.broker_files f
        WHERE (f.shop_owner = public.current_user_email()
               OR f.shop_owner IN (SELECT public.assigned_shop_emails_for(auth.uid())))
          AND f.file_url LIKE '%/artwork/' || storage.objects.name || '%'
      )
      OR EXISTS (
        SELECT 1 FROM public.expenses e
        WHERE (e.shop_owner = public.current_user_email()
               OR e.shop_owner IN (SELECT public.assigned_shop_emails_for(auth.uid())))
          AND e.attachment_url LIKE '%/artwork/' || storage.objects.name || '%'
      )
    )
  );
