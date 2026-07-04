-- Seeds the drill database with a small, fully-synthetic dataset that
-- exercises the restore chain: two tenants, linked customers → quotes →
-- orders → invoices (satisfying data_integrity_violations()), plus rows in
-- the operational tables the backup covers. Regenerate the committed
-- fixture with:  scripts/restore-drill/export-fixture.sh
-- All identities are invented (@drill.example) — no production data.

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-000000000001', 'owner1@drill.example'),
  ('00000000-0000-4000-8000-000000000002', 'owner2@drill.example');

INSERT INTO profiles (id, auth_id, email, role, shop_name, subscription_tier, subscription_status)
VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'owner1@drill.example', 'shop', 'Drill Shop One', 'trial', 'trialing'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'owner2@drill.example', 'shop', 'Drill Shop Two', 'trial', 'trialing');

INSERT INTO shops (id, owner_email, shop_name)
VALUES
  ('20000000-0000-4000-8000-000000000001', 'owner1@drill.example', 'Drill Shop One'),
  ('20000000-0000-4000-8000-000000000002', 'owner2@drill.example', 'Drill Shop Two');

INSERT INTO customers (id, shop_owner, name, company, email)
VALUES
  ('30000000-0000-4000-8000-000000000001', 'owner1@drill.example', 'Casey Customer', 'Drill Co', 'casey@drill.example'),
  ('30000000-0000-4000-8000-000000000002', 'owner1@drill.example', 'Riley Repeat', 'Repeat LLC', 'riley@drill.example'),
  ('30000000-0000-4000-8000-000000000003', 'owner2@drill.example', 'Morgan Merch', 'Merch Inc', 'morgan@drill.example');

INSERT INTO quotes (id, quote_id, shop_owner, customer_id, customer_name, status, date, subtotal, tax, total, public_token)
VALUES
  ('40000000-0000-4000-8000-000000000001', 'Q-DRILL-0001', 'owner1@drill.example', '30000000-0000-4000-8000-000000000001', 'Casey Customer', 'Sent',      '2026-07-01', 100, 8, 108, 'drill-token-q1'),
  ('40000000-0000-4000-8000-000000000002', 'Q-DRILL-0002', 'owner1@drill.example', '30000000-0000-4000-8000-000000000002', 'Riley Repeat',  'Approved',  '2026-07-01', 200, 16, 216, 'drill-token-q2'),
  ('40000000-0000-4000-8000-000000000003', 'Q-DRILL-0003', 'owner1@drill.example', '30000000-0000-4000-8000-000000000002', 'Riley Repeat',  'Converted to Order', '2026-07-02', 300, 24, 324, 'drill-token-q3'),
  ('40000000-0000-4000-8000-000000000004', 'Q-DRILL-0004', 'owner2@drill.example', '30000000-0000-4000-8000-000000000003', 'Morgan Merch',  'Draft',     '2026-07-02', 50, 4, 54, 'drill-token-q4');

UPDATE quotes SET converted_order_id = 'ORD-DRILL-0001', converted_at = '2026-07-02T12:00:00Z'
WHERE id = '40000000-0000-4000-8000-000000000003';

INSERT INTO orders (id, order_id, shop_owner, customer_id, customer_name, status, date, due_date, total, quote_id)
VALUES
  ('50000000-0000-4000-8000-000000000001', 'ORD-DRILL-0001', 'owner1@drill.example', '30000000-0000-4000-8000-000000000002', 'Riley Repeat', 'Printing',  '2026-07-02', '2026-07-10', 324, 'Q-DRILL-0003'),
  ('50000000-0000-4000-8000-000000000002', 'ORD-DRILL-0002', 'owner2@drill.example', '30000000-0000-4000-8000-000000000003', 'Morgan Merch', 'Completed', '2026-06-20', '2026-06-28', 500, NULL);

UPDATE orders SET completed_date = '2026-06-27' WHERE order_id = 'ORD-DRILL-0002';

INSERT INTO invoices (id, invoice_id, shop_owner, customer_id, customer_name, status, date, total)
VALUES
  ('60000000-0000-4000-8000-000000000001', 'INV-DRILL-0001', 'owner1@drill.example', '30000000-0000-4000-8000-000000000002', 'Riley Repeat', 'Sent', '2026-07-02', 324),
  ('60000000-0000-4000-8000-000000000002', 'INV-DRILL-0002', 'owner2@drill.example', '30000000-0000-4000-8000-000000000003', 'Morgan Merch', 'Paid', '2026-06-28', 500);

INSERT INTO expenses (id, shop_owner, payee, payment_date, total, memo)
VALUES
  ('70000000-0000-4000-8000-000000000001', 'owner1@drill.example', 'Drill Supply Co', '2026-07-01', 42.50, 'Drill emulsion'),
  ('70000000-0000-4000-8000-000000000002', 'owner2@drill.example', 'Drill Landlord', '2026-07-01', 1500, 'Drill rent');

INSERT INTO notification_log (shop_owner, event_type, recipient_email, recipient_role, subject, status)
VALUES
  ('owner1@drill.example', 'quote_approval', 'owner1@drill.example', 'shop_owner', 'Drill approval', 'sent'),
  ('owner2@drill.example', 'quote_payment',  'owner2@drill.example', 'shop_owner', 'Drill payment',  'failed');

INSERT INTO qb_event_log (shop_owner, action, direction, status)
VALUES ('__system__', 'drill_fixture', 'outbound', 'success');
