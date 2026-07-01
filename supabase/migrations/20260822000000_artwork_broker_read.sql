-- Broker artwork read (closes a latent gap in 20260820).
--
-- 20260820 scoped artwork SELECT by shop_owner ∈ {current_user_email(),
-- assigned_shop_emails_for()}. That correctly covers a broker's assigned-shop
-- work and message attachments, but it MISSES broker-owned artwork whose source
-- row isn't keyed by a matching shop_owner:
--   * a broker's own quotes/orders (matched by broker_id, not shop_owner);
--   * a broker's credential files, stored on their OWN profile row
--     (profiles.broker_credentials) — the profiles table isn't in 20260820.
-- Today 0 objects are affected (no broker has uploaded credentials / client or
-- broker-quote artwork yet), so nothing is broken — but the moment a broker
-- does, openSignedArtwork() would be denied. This closes that before it bites.
--
-- ADDITIVE: a SEPARATE permissive SELECT policy (OR'd with 20260820's), so the
-- verified tenant policy is untouched. It only ever GRANTS a broker access to
-- artwork they own (their broker_id rows, their own profile) — it can't widen
-- anyone else's access.
--
-- ROLLBACK: DROP POLICY IF EXISTS "authenticated_read_artwork_broker" ON storage.objects;

DROP POLICY IF EXISTS "authenticated_read_artwork_broker" ON storage.objects;

CREATE POLICY "authenticated_read_artwork_broker"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'artwork'
    AND (
      -- The broker's own quotes (they are the broker_id), any shop_owner.
      EXISTS (
        SELECT 1 FROM public.quotes q
        WHERE q.broker_id = public.current_user_email()
          AND (q.selected_artwork::text LIKE '%/artwork/' || storage.objects.name || '%'
               OR q.line_items::text     LIKE '%/artwork/' || storage.objects.name || '%')
      )
      -- The broker's own orders.
      OR EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.broker_id = public.current_user_email()
          AND (o.selected_artwork::text LIKE '%/artwork/' || storage.objects.name || '%'
               OR o.line_items::text     LIKE '%/artwork/' || storage.objects.name || '%')
      )
      -- The broker's own credential files (stored on their profile).
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.auth_id = auth.uid()
          AND p.broker_credentials::text LIKE '%/artwork/' || storage.objects.name || '%'
      )
    )
  );
