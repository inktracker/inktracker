-- Allow brokers to manage their own customers (shop_owner = 'broker:' || email)
CREATE POLICY "customers_broker" ON customers FOR ALL TO authenticated
  USING (shop_owner = 'broker:' || auth.jwt()->>'email')
  WITH CHECK (shop_owner = 'broker:' || auth.jwt()->>'email');
