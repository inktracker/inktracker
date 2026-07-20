-- Heal bare-path artwork references (found 2026-07-03, during the #574
-- post-deploy gallery check).
--
-- OrderDetailModal had its own inline uploader that stored
--   { path: "<order-uuid>_<ts>_<rand>.jpg" }   — no /artwork/ url at all.
-- Those refs matched NOTHING: not the reference-based read policy (old or
-- fallback — both LIKE on '/artwork/'), not the 20260827 backfill/trigger
-- regex (same prefix), and not artworkProof's authorizedPaths (matches
-- /artwork/ urls + uploadFile's ts-rand names only). Net effect: every
-- artwork file uploaded through the ORDER modal has had broken shop-side
-- thumbnails AND a 404 customer approval page since the bucket was
-- tenant-scoped (20260820) — this predates #574; the gallery check just
-- surfaced it.
--
-- The frontend now uploads through the shared uploadFile() helper (which
-- maps ownership at upload and stores the /artwork/ url carrier). This
-- migration heals history and widens the safety nets:
--   1. map_from_row trigger also extracts explicit "path":"<name>" fields.
--   2. Backfill maps every existing bare-path ref from quotes + orders.

-- ── 1. Widen the write-time mapper ───────────────────────────────────

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
  IF NEW.shop_owner IS NOT NULL AND NEW.shop_owner <> '' THEN
    -- Never let mapping failure abort the quote/order write itself.
    BEGIN
      IF v_blob LIKE '%/artwork/%' THEN
        INSERT INTO public.artwork_objects (name, shop_owner)
        SELECT DISTINCT m[1], NEW.shop_owner
        FROM regexp_matches(v_blob, '/artwork/([A-Za-z0-9._-]+)', 'g') AS m
        ON CONFLICT (name) DO NOTHING;
      END IF;
      -- Bare "path" fields — the legacy order-modal ref shape carries the
      -- object name here with no /artwork/ url around it.
      IF v_blob LIKE '%"path"%' THEN
        INSERT INTO public.artwork_objects (name, shop_owner)
        SELECT DISTINCT m[1], NEW.shop_owner
        FROM regexp_matches(v_blob, '"path"\s*:\s*"([A-Za-z0-9._-]+)"', 'g') AS m
        ON CONFLICT (name) DO NOTHING;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'artwork_objects map skipped for %: %', TG_TABLE_NAME, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $$;

-- (Triggers from 20260827 already point at this function — no re-create.)

-- ── 2. Backfill existing bare-path refs ──────────────────────────────
-- Same tenant semantics as the 20260827 backfill; only quotes/orders carry
-- the { path } ref shape. ON CONFLICT keeps rows the 20260827 backfill or
-- upload-time mapping already created.

INSERT INTO public.artwork_objects (name, shop_owner)
SELECT DISTINCT m.name, src.shop_owner
FROM (
  SELECT shop_owner, (COALESCE(selected_artwork::text, '') || ' ' || COALESCE(line_items::text, '')) AS blob FROM public.quotes
  UNION ALL
  SELECT shop_owner, (COALESCE(selected_artwork::text, '') || ' ' || COALESCE(line_items::text, '')) FROM public.orders
) src,
LATERAL (
  SELECT (regexp_matches(src.blob, '"path"\s*:\s*"([A-Za-z0-9._-]+)"', 'g'))[1] AS name
) m
WHERE src.shop_owner IS NOT NULL AND src.shop_owner <> ''
ON CONFLICT (name) DO NOTHING;
