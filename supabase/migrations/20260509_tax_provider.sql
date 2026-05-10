-- ============================================================================
-- Tax provider abstraction — schema additions.
-- ============================================================================
-- Adds the columns needed for the pluggable TaxProvider work:
--
--   shops.tax_mode             — enum('internal','quickbooks'), default 'internal'
--   shops.default_jurisdiction — text, used when ship_to has no rate match
--   shops.rate_table           — jsonb [{ zip|state, rate }, ...]
--
--   customers.taxable          — bool, default true (per-customer toggle, on top
--                                of the existing tax_exempt flag)
--   customers.exempt_reason    — text
--   customers.resale_cert      — text
--   customers.ship_to_address  — jsonb { street, city, state, zip, country }
--
-- line_item.taxable lives on the existing JSONB line items array on `quotes`
-- (no DDL needed — providers honor it as an inline JSON property).
--
-- Backfill: shops with a QB realm in profile_secrets are marked 'quickbooks'
-- so they keep computing tax via QBO with no behavior change. All others get
-- 'internal'. A NOTICE is emitted per shop for audit.
--
-- This migration is additive and idempotent — re-running is a no-op.
-- ============================================================================

-- ── shops ──────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'tax_mode_t'
  ) THEN
    CREATE TYPE tax_mode_t AS ENUM ('internal', 'quickbooks');
  END IF;
END $$;

ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS tax_mode             tax_mode_t NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS default_jurisdiction text,
  ADD COLUMN IF NOT EXISTS rate_table           jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ── customers ──────────────────────────────────────────────────────────────

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS taxable          boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS exempt_reason    text,
  ADD COLUMN IF NOT EXISTS resale_cert      text,
  ADD COLUMN IF NOT EXISTS ship_to_address  jsonb;

-- ── Backfill shops.tax_mode ────────────────────────────────────────────────
-- 'quickbooks' for shops whose owning profile has a qb_realm_id in
-- profile_secrets, else 'internal'. Emits one NOTICE per row for audit.

DO $$
DECLARE
  r RECORD;
  v_mode tax_mode_t;
  v_reason text;
BEGIN
  FOR r IN
    SELECT
      s.id           AS shop_id,
      s.shop_owner   AS shop_owner,
      ps.qb_realm_id AS qb_realm_id
    FROM shops s
    LEFT JOIN profiles p
      ON p.email = s.shop_owner
    LEFT JOIN profile_secrets ps
      ON ps.profile_id = p.id
  LOOP
    IF r.qb_realm_id IS NOT NULL AND r.qb_realm_id <> '' THEN
      v_mode := 'quickbooks';
      v_reason := 'has_qb_realm_id';
    ELSE
      v_mode := 'internal';
      v_reason := 'default';
    END IF;

    -- Only update rows still at the default — never clobber a value an admin
    -- may have already set by hand (re-run safety).
    UPDATE shops
    SET    tax_mode = v_mode
    WHERE  id = r.shop_id
      AND  tax_mode = 'internal'
      AND  v_mode <> 'internal';

    RAISE NOTICE 'tax_provider_backfill shop=% tax_mode=% reason=%',
                 r.shop_id, v_mode, v_reason;
  END LOOP;
END $$;
