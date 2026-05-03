-- Add shipping fields to orders table for FedEx integration
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address_street TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address_city TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address_state TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address_zip TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address_country TEXT DEFAULT 'US';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_weight NUMERIC;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_length NUMERIC;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_width NUMERIC;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_height NUMERIC;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_service_type TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_carrier TEXT DEFAULT 'FedEx';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_label_url TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_rate NUMERIC;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_status TEXT;
