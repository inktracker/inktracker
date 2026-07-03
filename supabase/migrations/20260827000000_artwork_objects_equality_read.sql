-- Artwork read RLS: equality join instead of six LIKE scans (pre-scale
-- audit, 2026-07-02).
--
-- 20260820 closed the cross-tenant artwork read by granting SELECT only
-- when the object is REFERENCED by a row in the caller's scope — six
-- EXISTS subqueries per object, each `col::text LIKE '%/artwork/'||name||'%'`.
-- Leading-wildcard LIKE can't use any index, and quotes/orders match
-- against line_items::text (large JSONB detoasted per row). Cost is
-- O(objects_listed × rows_in_6_tables) and grows on BOTH axes as shops
-- accumulate history — the fastest-biting DB item in the audit. Every
-- gallery thumbnail and signed-URL call pays it.
--
-- New design: an ownership mapping written AT UPLOAD TIME.
--
--   artwork_objects(name PK, shop_owner, uploader_email)
--
--   * uploadFile.js inserts { name } after a successful upload; a
--     SECURITY DEFINER trigger stamps uploader_email + shop_owner from
--     the caller's profile (client can suggest a shop_owner but it's
--     validated against their scope — nothing spoofable).
--   * The storage SELECT policy becomes ONE indexed lookup via
--     artwork_read_allowed(name) — SECURITY DEFINER so it doesn't nest
--     RLS evaluation inside the storage policy.
--   * Existing objects are backfilled below by extracting /artwork/<name>
--     references from the same six tables the old policy scanned — the
--     LIKE matching runs ONCE here instead of on every read.
--   * A bonus over the old design: artwork is readable by its uploader
--     the moment it's uploaded — under 20260820 an object couldn't be
--     signed until the quote/order row referencing it was SAVED.
--
-- TRANSITION SAFETY: the reference-based policies survive as fallbacks
-- ("authenticated_read_artwork_ref_fallback" + the 20260822 broker
-- policy, untouched). Permissive policies OR together, and the planner
-- orders the cheap function-call qual before the expensive subplans, so
-- granted reads take the fast path and anything the backfill somehow
-- missed still resolves through the old logic instead of breaking.
-- Once prod shows the fallback matching nothing, a follow-up migration
-- drops both fallbacks (that's when the full perf win lands for denies).
--
-- ROLLBACK: drop the two new policies below, recreate
-- "authenticated_read_artwork" with the 20260820 body (the fallback here
-- is byte-identical — rename it back).

-- ── 1. Mapping table ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.artwork_objects (
  name           TEXT PRIMARY KEY,                    -- storage.objects.name in bucket 'artwork'
  shop_owner     TEXT NOT NULL,                       -- tenant key, same semantics as every shop-scoped table
  uploader_email TEXT,                                -- retains read for the member/broker who uploaded it
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS artwork_objects_shop_owner_idx ON public.artwork_objects (shop_owner);
CREATE INDEX IF NOT EXISTS artwork_objects_uploader_idx   ON public.artwork_objects (uploader_email);

-- ── 2. Server-side tenant stamping ───────────────────────────────────
-- Clients insert only { name }. The trigger derives uploader + tenant
-- from the caller's profile; a caller-supplied shop_owner is honored
-- ONLY if it's within their scope (broker/manager uploading for an
-- assigned shop), otherwise overwritten. Service-role / migration
-- inserts (auth.uid() IS NULL) pass through untouched so the backfill
-- below can set shop_owner directly.

CREATE OR REPLACE FUNCTION public.artwork_objects_stamp_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text;
  v_shop  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;  -- service role / migration: trust the row as written
  END IF;
  SELECT email, COALESCE(NULLIF(shop_owner, ''), email)
    INTO v_email, v_shop
    FROM public.profiles WHERE auth_id = auth.uid() LIMIT 1;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'artwork_objects: no profile for caller' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.uploader_email := v_email;
  IF NEW.shop_owner IS NOT NULL AND NEW.shop_owner <> '' AND (
       NEW.shop_owner = v_email
       OR NEW.shop_owner = v_shop
       OR NEW.shop_owner IN (SELECT public.assigned_shop_emails_for(auth.uid()))
     ) THEN
    NULL;  -- caller-specified tenant, verified in scope — keep it
  ELSE
    NEW.shop_owner := v_shop;
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS artwork_objects_stamp_owner_trg ON public.artwork_objects;
CREATE TRIGGER artwork_objects_stamp_owner_trg
  BEFORE INSERT ON public.artwork_objects
  FOR EACH ROW EXECUTE FUNCTION public.artwork_objects_stamp_owner();

-- ── 3. RLS on the mapping table ──────────────────────────────────────
-- Rows are immutable from the client (no UPDATE/DELETE policies —
-- service role bypasses for purge). WITH CHECK re-asserts what the
-- trigger stamped, belt and suspenders.

ALTER TABLE public.artwork_objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS artwork_objects_insert ON public.artwork_objects;
CREATE POLICY artwork_objects_insert ON public.artwork_objects
  FOR INSERT TO authenticated
  WITH CHECK (uploader_email = public.current_user_email());

DROP POLICY IF EXISTS artwork_objects_select ON public.artwork_objects;
CREATE POLICY artwork_objects_select ON public.artwork_objects
  FOR SELECT TO authenticated
  USING (
    shop_owner = public.current_user_email()
    OR uploader_email = public.current_user_email()
    OR shop_owner IN (SELECT public.assigned_shop_emails_for(auth.uid()))
  );

-- ── 4. The read gate the storage policy calls ────────────────────────

CREATE OR REPLACE FUNCTION public.artwork_read_allowed(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.artwork_objects ao
    WHERE ao.name = p_name
      AND (
        ao.shop_owner = public.current_user_email()
        OR ao.uploader_email = public.current_user_email()
        OR ao.shop_owner IN (SELECT public.assigned_shop_emails_for(auth.uid()))
      )
  );
$$;

REVOKE ALL ON FUNCTION public.artwork_read_allowed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.artwork_read_allowed(text) TO authenticated;

-- ── 5. Backfill from the same references the old policy scanned ──────
-- Object names are `${Date.now()}-${random}.${ext}` (uploadFile.js), so
-- the charset-limited regex can't overmatch into surrounding JSON/text.
-- shop_owner comes from the referencing row — identical tenant semantics
-- to the old policy. ON CONFLICT keeps the first (oldest reference) row.

INSERT INTO public.artwork_objects (name, shop_owner)
SELECT DISTINCT m.name, src.shop_owner
FROM (
  SELECT shop_owner, (COALESCE(selected_artwork::text, '') || ' ' || COALESCE(line_items::text, '')) AS blob FROM public.quotes
  UNION ALL
  SELECT shop_owner, (COALESCE(selected_artwork::text, '') || ' ' || COALESCE(line_items::text, '')) FROM public.orders
  UNION ALL
  SELECT shop_owner, COALESCE(attachment_url, '') FROM public.messages
  UNION ALL
  SELECT shop_owner, COALESCE(file_url, '') FROM public.broker_documents
  UNION ALL
  SELECT shop_owner, COALESCE(file_url, '') FROM public.broker_files
  UNION ALL
  SELECT shop_owner, COALESCE(attachment_url, '') FROM public.expenses
  UNION ALL
  -- Broker credential files live on the broker's own profile; the broker
  -- IS the tenant for those (matches the 20260822 policy's semantics).
  SELECT email, COALESCE(broker_credentials::text, '') FROM public.profiles WHERE broker_credentials IS NOT NULL
) src,
LATERAL (
  SELECT (regexp_matches(src.blob, '/artwork/([A-Za-z0-9._-]+)', 'g'))[1] AS name
) m
WHERE src.shop_owner IS NOT NULL AND src.shop_owner <> ''
ON CONFLICT (name) DO NOTHING;

-- ── 5b. Self-healing map on quote/order writes ───────────────────────
-- The anonymous public wizard uploads artwork too (OrderWizard →
-- uploadFile), and anon can't insert into artwork_objects. Its artwork
-- becomes referenced when submit_wizard_quote inserts the quotes row —
-- so map references at row-write time. This also self-heals any authed
-- upload whose best-effort mapping insert failed. Regex on writes is
-- cheap; writes are rare next to reads. SECURITY DEFINER so the insert
-- clears artwork_objects RLS regardless of caller.

CREATE OR REPLACE FUNCTION public.artwork_objects_map_from_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_blob text;
BEGIN
  v_blob := COALESCE(NEW.selected_artwork::text, '') || ' ' || COALESCE(NEW.line_items::text, '');
  IF NEW.shop_owner IS NOT NULL AND NEW.shop_owner <> '' AND v_blob LIKE '%/artwork/%' THEN
    -- Never let mapping failure abort the quote/order write itself — the
    -- transitional fallback policy still serves reads for referenced art.
    BEGIN
      INSERT INTO public.artwork_objects (name, shop_owner)
      SELECT DISTINCT m[1], NEW.shop_owner
      FROM regexp_matches(v_blob, '/artwork/([A-Za-z0-9._-]+)', 'g') AS m
      ON CONFLICT (name) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'artwork_objects map skipped for %: %', TG_TABLE_NAME, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS artwork_objects_map_from_quote_trg ON public.quotes;
CREATE TRIGGER artwork_objects_map_from_quote_trg
  AFTER INSERT OR UPDATE OF selected_artwork, line_items ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.artwork_objects_map_from_row();

DROP TRIGGER IF EXISTS artwork_objects_map_from_order_trg ON public.orders;
CREATE TRIGGER artwork_objects_map_from_order_trg
  AFTER INSERT OR UPDATE OF selected_artwork, line_items ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.artwork_objects_map_from_row();

-- ── 6. Swap the primary storage policy to the equality path ──────────
-- The 20260820 reference-based body survives under a new name as the
-- transitional fallback; the 20260822 broker policy is left untouched.

DROP POLICY IF EXISTS "authenticated_read_artwork" ON storage.objects;
CREATE POLICY "authenticated_read_artwork"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'artwork'
    AND public.artwork_read_allowed(name)
  );

DROP POLICY IF EXISTS "authenticated_read_artwork_ref_fallback" ON storage.objects;
CREATE POLICY "authenticated_read_artwork_ref_fallback"
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
