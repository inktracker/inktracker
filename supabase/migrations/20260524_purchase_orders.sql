-- Purchase Orders for API-submitted supplier orders.
--
-- Background: inventory_items already has a primitive "I ordered this"
-- workflow via the supplier / ordered_at / ordered_qty columns added in
-- 20260514_inventory_shopping_list.sql. That covers the case where the
-- shop manually phoned/emailed the supplier and just wants to track that
-- restock is in flight.
--
-- This new table is for the API-submitted path: shop builds a draft PO
-- in the InkTracker UI, accumulates SKUs across multiple jobs to hit
-- free-freight thresholds, then submits via acPlaceOrder (or future
-- ssPlaceOrder) which POSTs the order to the supplier's API and stores
-- the supplier's order ID back here.
--
-- Items live in a JSONB column rather than a child table — we don't
-- query by SKU, only ever load all items for a given PO. Same pattern
-- as quotes.line_items.
--
-- Free-freight threshold is per-shop on profiles (joins the AC creds
-- already there). Defaults to 200 USD; shop overrides when their
-- supplier changes terms.

-- ── purchase_orders table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_owner           TEXT NOT NULL,                       -- RLS scope
  supplier             TEXT NOT NULL,                       -- "AS Colour" / "S&S Activewear"
  status               TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'submitted', 'cancelled')),
  reference            TEXT,                                -- shop's internal name, e.g. "Acme + Lakers restock"
  ship_to              JSONB,                               -- {company, firstName, lastName, address1, address2, city, state, zip, countryCode, email, phone}
  items                JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{sku, styleCode, color, size, quantity, unitPrice, warehouse}]
  notes                TEXT,                                -- maps to AS Colour orderNotes
  courier_instructions TEXT,                                -- maps to AS Colour courierInstructions
  shipping_method      TEXT,                                -- AS Colour shippingMethod string
  supplier_order_id    TEXT,                                -- AS Colour's order ID after submit
  submit_response      JSONB,                               -- raw supplier response on submit (audit trail)
  submitted_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Hot path: list a shop's drafts (and history).
CREATE INDEX IF NOT EXISTS purchase_orders_shop_status_idx
  ON public.purchase_orders (shop_owner, status, created_at DESC);

-- updated_at maintenance.
CREATE OR REPLACE FUNCTION public.touch_purchase_orders_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS purchase_orders_touch_updated_at ON public.purchase_orders;
CREATE TRIGGER purchase_orders_touch_updated_at
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_purchase_orders_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────
-- Same pattern as the rest of the app: shop_owner scope, with broker /
-- manager / employee access via assigned_shops_for(auth.uid()) which
-- already exists from 20260513.

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_orders_select ON public.purchase_orders;
CREATE POLICY purchase_orders_select ON public.purchase_orders
  FOR SELECT TO authenticated
  USING (
    shop_owner = (SELECT email FROM public.profiles WHERE auth_id = auth.uid())
    OR shop_owner IN (SELECT public.assigned_shop_emails_for(auth.uid()))
  );

-- Inserts/updates/deletes: only shop_owner OR a role granted by
-- assigned_shops. The edge function (acPlaceOrder) already enforces
-- role gating before flipping status to 'submitted', so a manager
-- submitting a PO is fine here — the role check happens upstream.
DROP POLICY IF EXISTS purchase_orders_insert ON public.purchase_orders;
CREATE POLICY purchase_orders_insert ON public.purchase_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    shop_owner = (SELECT email FROM public.profiles WHERE auth_id = auth.uid())
    OR shop_owner IN (SELECT public.assigned_shop_emails_for(auth.uid()))
  );

DROP POLICY IF EXISTS purchase_orders_update ON public.purchase_orders;
CREATE POLICY purchase_orders_update ON public.purchase_orders
  FOR UPDATE TO authenticated
  USING (
    shop_owner = (SELECT email FROM public.profiles WHERE auth_id = auth.uid())
    OR shop_owner IN (SELECT public.assigned_shop_emails_for(auth.uid()))
  )
  WITH CHECK (
    shop_owner = (SELECT email FROM public.profiles WHERE auth_id = auth.uid())
    OR shop_owner IN (SELECT public.assigned_shop_emails_for(auth.uid()))
  );

DROP POLICY IF EXISTS purchase_orders_delete ON public.purchase_orders;
CREATE POLICY purchase_orders_delete ON public.purchase_orders
  FOR DELETE TO authenticated
  USING (
    shop_owner = (SELECT email FROM public.profiles WHERE auth_id = auth.uid())
    OR shop_owner IN (SELECT public.assigned_shop_emails_for(auth.uid()))
  );

-- ── Free-freight threshold on profiles ──────────────────────────────
-- Per-supplier thresholds as a JSONB so we don't have to migrate every
-- time a new supplier is added. Shape: { "AS Colour": 200, "S&S Activewear": 200 }.
-- Frontend reads this on the PO page and shows the progress bar /
-- "$X to free shipping" hint.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS free_freight_thresholds JSONB DEFAULT '{}'::jsonb;
