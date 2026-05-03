-- ============================================================================
-- InkTracker RLS Lockdown — Multi-Tenant Data Isolation
-- ============================================================================
-- Replaces the permissive "USING (TRUE)" policies with proper shop_owner scoping.
--
-- Pattern:
--   - Authenticated users can only see/modify rows where shop_owner = their email
--   - Brokers can also see rows where broker_id = their email
--   - Anonymous users can insert quotes/orders (public wizard)
--   - Profiles table uses auth_id matching instead of shop_owner
--   - Edge functions use service_role key which bypasses RLS
--
-- Run via Supabase Dashboard → SQL Editor
-- ============================================================================

-- Helper: get current user's email from JWT
-- auth.jwt()->>'email' returns the authenticated user's email

-- ── PROFILES ────────────────────────────────────────────────────────────────
-- Users can only read/update their own profile. Admins handled by service_role.
DROP POLICY IF EXISTS "auth_all_profiles" ON profiles;
DROP POLICY IF EXISTS "profiles_select" ON profiles;
DROP POLICY IF EXISTS "profiles_update" ON profiles;
DROP POLICY IF EXISTS "profiles_insert" ON profiles;

-- Own profile
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT TO authenticated
  USING (auth_id = auth.uid());

-- Shop owners can see profiles of brokers/employees assigned to their shop
CREATE POLICY "profiles_select_team" ON profiles FOR SELECT TO authenticated
  USING (
    assigned_shops::jsonb ? (auth.jwt()->>'email')
    OR shop_owner = auth.jwt()->>'email'
  );

-- Brokers/employees can see the shop owner's profile
CREATE POLICY "profiles_select_shop_owner" ON profiles FOR SELECT TO authenticated
  USING (
    email IN (
      SELECT jsonb_array_elements_text(p.assigned_shops::jsonb)
      FROM profiles p WHERE p.auth_id = auth.uid() AND p.assigned_shops IS NOT NULL
    )
  );

CREATE POLICY "profiles_update" ON profiles FOR UPDATE TO authenticated
  USING (auth_id = auth.uid())
  WITH CHECK (auth_id = auth.uid());

-- Allow insert for new signups (trigger or onboarding creates the profile)
CREATE POLICY "profiles_insert" ON profiles FOR INSERT TO authenticated
  WITH CHECK (auth_id = auth.uid());

-- ── SHOPS ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_all_shops" ON shops;
DROP POLICY IF EXISTS "shops_select" ON shops;
DROP POLICY IF EXISTS "shops_insert" ON shops;
DROP POLICY IF EXISTS "shops_update" ON shops;
DROP POLICY IF EXISTS "shops_delete" ON shops;

CREATE POLICY "shops_select" ON shops FOR SELECT TO authenticated
  USING (owner_email = auth.jwt()->>'email');

CREATE POLICY "shops_insert" ON shops FOR INSERT TO authenticated
  WITH CHECK (owner_email = auth.jwt()->>'email');

CREATE POLICY "shops_update" ON shops FOR UPDATE TO authenticated
  USING (owner_email = auth.jwt()->>'email');

CREATE POLICY "shops_delete" ON shops FOR DELETE TO authenticated
  USING (owner_email = auth.jwt()->>'email');

-- ── CUSTOMERS ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_all_customers" ON customers;
DROP POLICY IF EXISTS "customers_owner" ON customers;

CREATE POLICY "customers_owner" ON customers FOR ALL TO authenticated
  USING (shop_owner = auth.jwt()->>'email')
  WITH CHECK (shop_owner = auth.jwt()->>'email');

-- ── QUOTES ──────────────────────────────────────────────────────────────────
-- Shop owners see their quotes. Brokers see quotes they submitted.
-- Anonymous users can insert (public wizard) and select (payment page).
DROP POLICY IF EXISTS "auth_all_quotes" ON quotes;
DROP POLICY IF EXISTS "anon_insert_quotes" ON quotes;
DROP POLICY IF EXISTS "anon_select_quotes" ON quotes;
DROP POLICY IF EXISTS "quotes_owner" ON quotes;
DROP POLICY IF EXISTS "quotes_broker" ON quotes;
DROP POLICY IF EXISTS "quotes_anon_insert" ON quotes;
DROP POLICY IF EXISTS "quotes_anon_select" ON quotes;

CREATE POLICY "quotes_owner" ON quotes FOR ALL TO authenticated
  USING (shop_owner = auth.jwt()->>'email')
  WITH CHECK (shop_owner = auth.jwt()->>'email');

CREATE POLICY "quotes_broker" ON quotes FOR SELECT TO authenticated
  USING (broker_id = auth.jwt()->>'email');

-- Public quote submission (wizard) and viewing (payment page)
CREATE POLICY "quotes_anon_insert" ON quotes FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "quotes_anon_select" ON quotes FOR SELECT TO anon
  USING (true);

-- ── ORDERS ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_all_orders" ON orders;
DROP POLICY IF EXISTS "anon_insert_orders" ON orders;
DROP POLICY IF EXISTS "orders_owner" ON orders;
DROP POLICY IF EXISTS "orders_broker" ON orders;
DROP POLICY IF EXISTS "orders_anon_insert" ON orders;
DROP POLICY IF EXISTS "orders_employee" ON orders;

CREATE POLICY "orders_owner" ON orders FOR ALL TO authenticated
  USING (shop_owner = auth.jwt()->>'email')
  WITH CHECK (shop_owner = auth.jwt()->>'email');

-- Brokers can see orders linked to them
CREATE POLICY "orders_broker" ON orders FOR SELECT TO authenticated
  USING (broker_id = auth.jwt()->>'email');

-- Employees can see and update orders for their assigned shop
CREATE POLICY "orders_employee" ON orders FOR ALL TO authenticated
  USING (
    shop_owner IN (
      SELECT jsonb_array_elements_text(p.assigned_shops::jsonb)
      FROM profiles p WHERE p.auth_id = auth.uid() AND p.assigned_shops IS NOT NULL
    )
  )
  WITH CHECK (
    shop_owner IN (
      SELECT jsonb_array_elements_text(p.assigned_shops::jsonb)
      FROM profiles p WHERE p.auth_id = auth.uid() AND p.assigned_shops IS NOT NULL
    )
  );

-- Public order submission from wizard
CREATE POLICY "orders_anon_insert" ON orders FOR INSERT TO anon
  WITH CHECK (true);

-- ── INVOICES ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_all_invoices" ON invoices;
DROP POLICY IF EXISTS "invoices_owner" ON invoices;

CREATE POLICY "invoices_owner" ON invoices FOR ALL TO authenticated
  USING (shop_owner = auth.jwt()->>'email')
  WITH CHECK (shop_owner = auth.jwt()->>'email');

-- ── EXPENSES ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_all_expenses" ON expenses;
DROP POLICY IF EXISTS "expenses_owner" ON expenses;

CREATE POLICY "expenses_owner" ON expenses FOR ALL TO authenticated
  USING (shop_owner = auth.jwt()->>'email')
  WITH CHECK (shop_owner = auth.jwt()->>'email');

-- ── INVENTORY_ITEMS ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_all_inventory_items" ON inventory_items;
DROP POLICY IF EXISTS "inventory_items_owner" ON inventory_items;

CREATE POLICY "inventory_items_owner" ON inventory_items FOR ALL TO authenticated
  USING (shop_owner = auth.jwt()->>'email')
  WITH CHECK (shop_owner = auth.jwt()->>'email');

-- ── COMMISSIONS ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_all_commissions" ON commissions;
DROP POLICY IF EXISTS "commissions_owner" ON commissions;
DROP POLICY IF EXISTS "commissions_broker" ON commissions;

CREATE POLICY "commissions_owner" ON commissions FOR ALL TO authenticated
  USING (shop_owner = auth.jwt()->>'email')
  WITH CHECK (shop_owner = auth.jwt()->>'email');

CREATE POLICY "commissions_broker" ON commissions FOR SELECT TO authenticated
  USING (broker_id = auth.jwt()->>'email');

-- ── BROKER_NOTIFICATIONS ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_all_broker_notifications" ON broker_notifications;
DROP POLICY IF EXISTS "broker_notifications_access" ON broker_notifications;

CREATE POLICY "broker_notifications_access" ON broker_notifications FOR ALL TO authenticated
  USING (
    shop_owner = auth.jwt()->>'email' OR
    broker_id = auth.jwt()->>'email'
  )
  WITH CHECK (
    shop_owner = auth.jwt()->>'email' OR
    broker_id = auth.jwt()->>'email'
  );

-- ── BROKER_PERFORMANCE ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_all_broker_performance" ON broker_performance;
DROP POLICY IF EXISTS "broker_performance_access" ON broker_performance;

CREATE POLICY "broker_performance_access" ON broker_performance FOR ALL TO authenticated
  USING (
    shop_owner = auth.jwt()->>'email' OR
    broker_id = auth.jwt()->>'email'
  )
  WITH CHECK (
    shop_owner = auth.jwt()->>'email' OR
    broker_id = auth.jwt()->>'email'
  );

-- ── SHOP_PERFORMANCE ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_all_shop_performance" ON shop_performance;
DROP POLICY IF EXISTS "shop_performance_owner" ON shop_performance;

CREATE POLICY "shop_performance_owner" ON shop_performance FOR ALL TO authenticated
  USING (shop_owner = auth.jwt()->>'email')
  WITH CHECK (shop_owner = auth.jwt()->>'email');

-- ── TAX_CATEGORIES ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_all_tax_categories" ON tax_categories;
DROP POLICY IF EXISTS "tax_categories_owner" ON tax_categories;

CREATE POLICY "tax_categories_owner" ON tax_categories FOR ALL TO authenticated
  USING (shop_owner = auth.jwt()->>'email')
  WITH CHECK (shop_owner = auth.jwt()->>'email');

-- ── PAYEES ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_all_payees" ON payees;
DROP POLICY IF EXISTS "payees_owner" ON payees;

CREATE POLICY "payees_owner" ON payees FOR ALL TO authenticated
  USING (shop_owner = auth.jwt()->>'email')
  WITH CHECK (shop_owner = auth.jwt()->>'email');

-- ── PAYMENT_ACCOUNTS ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_all_payment_accounts" ON payment_accounts;
DROP POLICY IF EXISTS "payment_accounts_owner" ON payment_accounts;

CREATE POLICY "payment_accounts_owner" ON payment_accounts FOR ALL TO authenticated
  USING (shop_owner = auth.jwt()->>'email')
  WITH CHECK (shop_owner = auth.jwt()->>'email');

-- ── MESSAGES ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_all_messages" ON messages;
DROP POLICY IF EXISTS "messages_access" ON messages;

CREATE POLICY "messages_access" ON messages FOR ALL TO authenticated
  USING (
    from_email = auth.jwt()->>'email' OR
    to_email = auth.jwt()->>'email'
  )
  WITH CHECK (
    from_email = auth.jwt()->>'email'
  );

-- ── BROKER_DOCUMENTS ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_all_broker_documents" ON broker_documents;
DROP POLICY IF EXISTS "broker_documents_access" ON broker_documents;

CREATE POLICY "broker_documents_access" ON broker_documents FOR ALL TO authenticated
  USING (
    shop_owner = auth.jwt()->>'email' OR
    broker_id = auth.jwt()->>'email'
  )
  WITH CHECK (
    shop_owner = auth.jwt()->>'email' OR
    broker_id = auth.jwt()->>'email'
  );

-- ── BROKER_FILES ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_all_broker_files" ON broker_files;
DROP POLICY IF EXISTS "broker_files_access" ON broker_files;

CREATE POLICY "broker_files_access" ON broker_files FOR ALL TO authenticated
  USING (
    shop_owner = auth.jwt()->>'email' OR
    broker_id = auth.jwt()->>'email'
  )
  WITH CHECK (
    shop_owner = auth.jwt()->>'email' OR
    broker_id = auth.jwt()->>'email'
  );
