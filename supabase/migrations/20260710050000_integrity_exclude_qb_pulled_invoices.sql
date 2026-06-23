-- Refine data_integrity_violations(): don't flag QB-PULLED reference invoices
-- as "missing customer_id" violations.
--
-- Context: when a shop connects QuickBooks, InkTracker imports their existing
-- QB invoices for reference (handlePullInvoices). Those invoices reference QB
-- customers that have no InkTracker customer record, so `customer_id` is
-- legitimately NULL — the importer deliberately does NOT fabricate a link.
-- Identifying fingerprint of a QB-pulled reference invoice: `qb_invoice_id`
-- IS NOT NULL AND `order_id` IS NULL (it came from QB, not from an InkTracker
-- order/quote). Thunder House's 230 such rows tripped the nightly alert.
--
-- These are NOT the failure mode the check exists for. The "beloved's incident"
-- was an InkTracker invoice that LOST its customer (orphan with a "(deleted)"
-- name) — that's either a DANGLING link, or a MISSING link on an
-- InkTracker-created (order-linked / non-QB-pulled) invoice. Both are still
-- fully counted. We only carve out the benign QB-pulled-reference subset from
-- the invoices `missing_link` tally. `dangling_link` is unchanged (the real
-- danger), and quotes/orders are unchanged.

CREATE OR REPLACE FUNCTION public.data_integrity_violations()
RETURNS TABLE(tbl text, missing_link bigint, dangling_link bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 'invoices'::text,
         count(*) FILTER (
           WHERE (i.customer_id IS NULL OR i.customer_id = '')
             -- exclude QB-pulled reference invoices (no local customer is expected)
             AND NOT (i.qb_invoice_id IS NOT NULL AND i.order_id IS NULL)
         ),
         count(*) FILTER (WHERE i.customer_id IS NOT NULL AND i.customer_id <> '' AND c.id IS NULL)
  FROM invoices i LEFT JOIN customers c ON c.id::text = i.customer_id
  UNION ALL
  SELECT 'quotes',
         count(*) FILTER (WHERE q.customer_id IS NULL OR q.customer_id = ''),
         count(*) FILTER (WHERE q.customer_id IS NOT NULL AND q.customer_id <> '' AND c.id IS NULL)
  FROM quotes q LEFT JOIN customers c ON c.id::text = q.customer_id
  UNION ALL
  SELECT 'orders',
         count(*) FILTER (WHERE o.customer_id IS NULL OR o.customer_id = ''),
         count(*) FILTER (WHERE o.customer_id IS NOT NULL AND o.customer_id <> '' AND c.id IS NULL)
  FROM orders o LEFT JOIN customers c ON c.id::text = o.customer_id
$$;

REVOKE ALL ON FUNCTION public.data_integrity_violations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_integrity_violations() TO service_role;
