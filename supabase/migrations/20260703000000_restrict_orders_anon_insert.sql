-- Close the last permissive-RLS finding: orders_anon_insert was
-- WITH CHECK (true), letting any holder of the bundled anon key INSERT
-- order rows into any (or no) shop. Lower severity than the
-- quotes_anon_update hole (fixed in 20260630) — create-only, can't read
-- or modify existing rows — but still a junk-insert vector with no
-- legitimate client use: orders are created server-side (edge functions
-- on quote conversion), never by the anon browser client.
--
-- Mirror quotes_anon_insert_restricted: require shop_owner to name a
-- real shop. An anon insert into a nonexistent tenant now fails.

DROP POLICY IF EXISTS orders_anon_insert ON public.orders;

CREATE POLICY orders_anon_insert ON public.orders
  FOR INSERT
  TO anon
  WITH CHECK (
    shop_owner IS NOT NULL
    AND shop_owner <> ''
    AND EXISTS (SELECT 1 FROM public.shops WHERE shops.owner_email = orders.shop_owner)
  );
