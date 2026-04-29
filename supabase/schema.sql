-- ============================================================
-- InkTracker — Supabase Schema
-- Run this in the Supabase SQL editor (Project > SQL Editor)
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- PROFILES (extends auth.users)
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id    UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT,
  full_name  TEXT,
  role       TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'broker', 'user')),
  shop_name  TEXT,
  logo_url   TEXT,
  display_name  TEXT,
  company_name  TEXT,
  phone      TEXT,
  address    TEXT,
  website    TEXT,
  notes      TEXT,
  assigned_shops  JSONB DEFAULT '[]',
  addons          JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create / link profile on Supabase Auth signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- If admin pre-created a profile with this email, link it
  UPDATE profiles
    SET auth_id  = NEW.id,
        full_name = COALESCE(profiles.full_name, NEW.raw_user_meta_data->>'full_name')
  WHERE email = NEW.email AND auth_id IS NULL;

  -- Otherwise create a fresh pending profile
  IF NOT FOUND THEN
    INSERT INTO profiles (auth_id, email, full_name, role)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
      'user'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ──────────────────────────────────────────────────────────
-- CUSTOMERS
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_owner     TEXT,
  name           TEXT NOT NULL,
  company        TEXT,
  email          TEXT,
  phone          TEXT,
  address        TEXT,
  notes          TEXT,
  orders         INT DEFAULT 0,
  tax_id         TEXT,
  tax_exempt     BOOLEAN DEFAULT FALSE,
  default_deposit_pct NUMERIC DEFAULT 0,
  saved_imprints JSONB DEFAULT '[]',
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS default_deposit_pct NUMERIC DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS qb_customer_id TEXT;

-- ──────────────────────────────────────────────────────────
-- QUOTES
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id         TEXT,
  shop_owner       TEXT,
  broker_id        TEXT,
  broker_name      TEXT,
  broker_company   TEXT,
  customer_id      TEXT,
  customer_name    TEXT NOT NULL,
  customer_email   TEXT,
  date             DATE,
  due_date         DATE,
  status           TEXT DEFAULT 'Draft' CHECK (status IN (
    'Draft','Sent','Pending','Approved','Approved and Paid','Declined',
    'Shop Approved','Sent to Client','Client Approved','Client Rejected','Converted to Order'
  )),
  notes            TEXT,
  rush_rate        NUMERIC DEFAULT 0,
  extras           JSONB,
  line_items       JSONB DEFAULT '[]',
  discount         NUMERIC DEFAULT 0,
  tax_rate         NUMERIC DEFAULT 8.265,
  deposit_pct      NUMERIC DEFAULT 50,
  deposit_paid     BOOLEAN DEFAULT FALSE,
  sent_to          TEXT,
  sent_date        TIMESTAMPTZ,
  client_status    TEXT,
  payment_status   TEXT DEFAULT 'Unpaid' CHECK (payment_status IN (
    'Unpaid','Deposit Requested','Deposit Paid','Paid in Full'
  )),
  sent_to_client_at   TIMESTAMPTZ,
  client_approved_at  TIMESTAMPTZ,
  converted_order_id  TEXT,
  converted_at        TIMESTAMPTZ,
  qb_invoice_id       TEXT,
  qb_payment_link     TEXT,
  qb_synced_at        TIMESTAMPTZ,
  qb_subtotal         NUMERIC,
  qb_tax_amount       NUMERIC,
  qb_total            NUMERIC,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Backfill for pre-existing DBs:
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS qb_invoice_id   TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS qb_payment_link TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS qb_synced_at    TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS qb_subtotal     NUMERIC;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS qb_tax_amount   NUMERIC;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS qb_total        NUMERIC;

-- ──────────────────────────────────────────────────────────
-- ORDERS
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     TEXT,
  shop_owner   TEXT,
  broker_id    TEXT,
  customer_id  TEXT,
  customer_name TEXT NOT NULL,
  date         DATE,
  due_date     DATE,
  step_dates   JSONB,
  status       TEXT DEFAULT 'Art Approval' CHECK (status IN (
    'Art Approval','Pre-Press','Printing','Finishing','QC','Ready for Pickup','Completed'
  )),
  line_items   JSONB DEFAULT '[]',
  notes        TEXT,
  rush_rate    NUMERIC DEFAULT 0,
  extras       JSONB,
  discount     NUMERIC DEFAULT 0,
  tax_rate     NUMERIC DEFAULT 8.265,
  subtotal     NUMERIC,
  tax          NUMERIC,
  total        NUMERIC,
  paid         BOOLEAN DEFAULT FALSE,
  paid_date    DATE,
  pdf_url      TEXT,
  selected_artwork JSONB DEFAULT '[]',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────
-- INVOICES
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    TEXT,
  shop_owner    TEXT,
  customer_id   TEXT,
  customer_name TEXT,
  order_id      TEXT,
  total         NUMERIC,
  paid          BOOLEAN DEFAULT FALSE,
  paid_date     DATE,
  status        TEXT DEFAULT 'Pending',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  date          DATE,
  due           DATE,
  subtotal      NUMERIC,
  tax           NUMERIC,
  line_items    JSONB DEFAULT '[]',
  notes         TEXT,
  rush_rate     NUMERIC,
  extras        JSONB DEFAULT '{}',
  discount      NUMERIC DEFAULT 0,
  discount_type TEXT DEFAULT 'percent',
  tax_rate      NUMERIC,
  broker_id     TEXT,
  broker_name   TEXT,
  qb_invoice_id TEXT,
  qb_payment_link TEXT
);

-- ──────────────────────────────────────────────────────────
-- EXPENSES
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_owner      TEXT NOT NULL,
  expense_id      TEXT,
  payee           TEXT NOT NULL,
  payment_account TEXT,
  payment_method  TEXT DEFAULT 'Credit Card' CHECK (payment_method IN (
    'Credit Card','Bank Transfer','Check','Cash','Other'
  )),
  payment_date    DATE NOT NULL,
  ref_number      TEXT,
  line_items      JSONB DEFAULT '[]',
  memo            TEXT,
  attachment_url  TEXT,
  total           NUMERIC NOT NULL,
  is_recurring    BOOLEAN DEFAULT FALSE,
  recurring_end_date DATE,
  linked_order_id TEXT,
  auto_generation_type TEXT,
  recurring_source_id UUID,
  qb_expense_id   TEXT,
  qb_synced_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Backfill for pre-existing DBs:
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS qb_expense_id TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS qb_synced_at TIMESTAMPTZ;

-- ──────────────────────────────────────────────────────────
-- INVENTORY ITEMS
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_owner TEXT,
  item       TEXT,
  sku        TEXT,
  category   TEXT,
  qty        INT DEFAULT 0,
  unit       TEXT,
  reorder    INT DEFAULT 0,
  cost       NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────
-- COMMISSIONS
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commissions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id        TEXT,
  broker_name      TEXT,
  shop_owner       TEXT,
  order_id         TEXT,
  customer_name    TEXT,
  order_total      NUMERIC,
  commission_pct   NUMERIC,
  commission_amount NUMERIC,
  status           TEXT DEFAULT 'Pending',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────
-- BROKER NOTIFICATIONS
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS broker_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_owner  TEXT,
  broker_id   TEXT,
  action      TEXT,
  item_label  TEXT,
  item_id     TEXT,
  item_entity TEXT,
  read        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────
-- BROKER PERFORMANCE
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS broker_performance (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id  TEXT,
  shop_owner TEXT,
  orders     INT DEFAULT 0,
  revenue    NUMERIC DEFAULT 0,
  date       DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────
-- SHOP PERFORMANCE
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shop_performance (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_owner TEXT,
  date       DATE,
  orders     INT DEFAULT 0,
  revenue    NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────
-- TAX CATEGORIES
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_owner  TEXT,
  name        TEXT,
  description TEXT,
  tax_code    TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────
-- PAYEES
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payees (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_owner TEXT,
  name       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────
-- PAYMENT ACCOUNTS
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_accounts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_owner TEXT,
  name       TEXT,
  type       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────
-- SHOPS
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shops (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email TEXT NOT NULL,
  shop_name   TEXT NOT NULL,
  addons      JSONB DEFAULT '[]',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────
-- MESSAGES
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  TEXT,
  from_email TEXT,
  to_email   TEXT,
  body       TEXT,
  broker_id  TEXT,
  shop_owner TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────
-- BROKER DOCUMENTS
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS broker_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_owner  TEXT,
  broker_id   TEXT,
  name        TEXT,
  file_url    TEXT,
  note        TEXT,
  color_count INT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────
-- BROKER FILES
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS broker_files (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id  TEXT,
  shop_owner TEXT,
  name       TEXT,
  file_url   TEXT,
  note       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- Enable RLS on all tables (authenticated users only)
-- Tighten per-shop policies later as needed.
-- ──────────────────────────────────────────────────────────
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'profiles','customers','quotes','orders','invoices','expenses',
    'inventory_items','commissions','broker_notifications','broker_performance',
    'shop_performance','tax_categories','payees','payment_accounts',
    'shops','messages','broker_documents','broker_files'
  ]) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    -- Allow all operations for authenticated users (tighten later)
    EXECUTE format('
      CREATE POLICY IF NOT EXISTS "auth_all_%s" ON %I
        FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE)
    ', tbl, tbl);
    -- Allow public (anon) read+insert for quote/order submission pages
  END LOOP;
END $$;

-- Public quote submission (QuoteRequest page — unauthenticated)
CREATE POLICY IF NOT EXISTS "anon_insert_quotes" ON quotes
  FOR INSERT TO anon WITH CHECK (TRUE);

CREATE POLICY IF NOT EXISTS "anon_select_quotes" ON quotes
  FOR SELECT TO anon USING (TRUE);

-- Public order submission
CREATE POLICY IF NOT EXISTS "anon_insert_orders" ON orders
  FOR INSERT TO anon WITH CHECK (TRUE);

-- ──────────────────────────────────────────────────────────
-- ENABLE REALTIME for live-updating tables
-- ──────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
ALTER PUBLICATION supabase_realtime ADD TABLE quotes;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE broker_notifications;
