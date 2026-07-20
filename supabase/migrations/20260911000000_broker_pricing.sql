-- Per-broker pricing overrides (tester request 2026-07-18).
--
-- Before this: broker wholesale pricing was one shop-wide knob
-- (shops.pricing_config.brokerMarkupShare) applied identically to every
-- broker. Shops want to quote different wholesale terms per broker —
-- a "broker pricing sheet" (markup share, garment markup brackets,
-- and/or contract print-rate matrices) keyed to the individual broker.
--
-- Storage is a dedicated table, NOT a key inside shops.pricing_config,
-- for two hard reasons:
--   1. getPublicShopConfig ships the whole pricing_config blob to the
--      anonymous public wizard. Broker wholesale rates must never ride
--      along. This table has no anon policy, so the wizard can't see it.
--   2. Brokers have row-level SELECT on their assigned shop's `shops`
--      row (20260620030000). A column there would let broker A read
--      broker B's negotiated rates. Here each broker can read ONLY
--      their own row.
--
-- `overrides` is a PARTIAL pricing_config overlay — only the sections
-- the shop explicitly overrode (brokerMarkupShare, garmentMarkup,
-- firstPrint, addlPrint, plus a tiers/maxColors snapshot that keeps an
-- overridden matrix aligned with its own quantity tiers even if the
-- shop later re-tiers their main sheet). Everything absent inherits the
-- shop sheet at calc time via mergeBrokerPricing()
-- (src/lib/broker/brokerPricing.js). Overlay applies to the BROKER side
-- (wholesale) of a broker quote only — the client-side retail
-- suggestion keeps pricing off the shop's standard sheet.

CREATE TABLE IF NOT EXISTS public.broker_pricing (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_owner   TEXT NOT NULL,           -- shop's owner_email (RLS scope)
  broker_email TEXT NOT NULL,           -- broker profile email (quotes.broker_id convention)
  overrides    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_owner, broker_email)
);

CREATE INDEX IF NOT EXISTS broker_pricing_shop_idx
  ON public.broker_pricing (shop_owner);

-- updated_at maintenance (same pattern as purchase_orders).
CREATE OR REPLACE FUNCTION public.touch_broker_pricing_updated_at()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS broker_pricing_touch_updated_at ON public.broker_pricing;
CREATE TRIGGER broker_pricing_touch_updated_at
  BEFORE UPDATE ON public.broker_pricing
  FOR EACH ROW EXECUTE FUNCTION public.touch_broker_pricing_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────
-- No anon policy on purpose: the public wizard must never see broker
-- wholesale terms.
ALTER TABLE public.broker_pricing ENABLE ROW LEVEL SECURITY;

-- Shop owner: full control of their own brokers' sheets.
DROP POLICY IF EXISTS "broker_pricing_owner" ON public.broker_pricing;
CREATE POLICY "broker_pricing_owner" ON public.broker_pricing
  FOR ALL TO authenticated
  USING (shop_owner = auth.jwt()->>'email')
  WITH CHECK (shop_owner = auth.jwt()->>'email');

-- Managers: full control, same canonical subquery as 20260706. The
-- role='manager' filter matters — brokers ALSO carry assigned_shops,
-- and without it a broker would gain read/write on every other
-- broker's negotiated rates at their shop.
DROP POLICY IF EXISTS "broker_pricing_manager" ON public.broker_pricing;
CREATE POLICY "broker_pricing_manager" ON public.broker_pricing
  FOR ALL TO authenticated
  USING (shop_owner IN (
    SELECT jsonb_array_elements_text(p.assigned_shops)
    FROM profiles p
    WHERE p.auth_id = auth.uid() AND p.assigned_shops IS NOT NULL AND p.role = 'manager'
  ))
  WITH CHECK (shop_owner IN (
    SELECT jsonb_array_elements_text(p.assigned_shops)
    FROM profiles p
    WHERE p.auth_id = auth.uid() AND p.assigned_shops IS NOT NULL AND p.role = 'manager'
  ));

-- Brokers: read ONLY their own row (the BrokerDashboard needs their
-- effective sheet to price live quotes). Never another broker's.
DROP POLICY IF EXISTS "broker_pricing_broker_read" ON public.broker_pricing;
CREATE POLICY "broker_pricing_broker_read" ON public.broker_pricing
  FOR SELECT TO authenticated
  USING (lower(broker_email) = lower(auth.jwt()->>'email'));
