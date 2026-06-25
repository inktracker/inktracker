-- Backfill quotes.company from the linked customer record.
--
-- The Quotes list (and email / payment views) show the shop/company name via a
-- live join to the customers table (customerMap[customer_id]). When a viewer
-- can't read the full customer record — e.g. a manager with the "Customers"
-- section turned off, where RLS blocks customer reads — the join is empty and
-- the UI fell back to the personal contact name (customer_name) instead of the
-- company. Going forward QuoteEditorModal denormalizes company onto the quote
-- on customer select / new-client create; this backfills existing rows so the
-- company shows consistently regardless of who is viewing.
--
-- Safe + tenant-scoped: the join is on customer_id, which already belongs to the
-- same shop_owner. We only fill rows whose company is empty and whose customer
-- actually has a company. No owner_email / financial columns are touched.

-- quotes.customer_id is text, customers.id is uuid — cast on the join.
update quotes q
set company = c.company
from customers c
where q.customer_id = c.id::text
  and nullif(btrim(q.company), '') is null
  and nullif(btrim(c.company), '') is not null;
