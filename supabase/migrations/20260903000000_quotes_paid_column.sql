-- QB-3 (2026-07-12 audit): four QB code paths write quotes.paid /
-- quotes.paid_date, but the columns never existed. PostgREST rejects an
-- UPDATE containing an unknown column WHOLESALE (PGRST204), so:
--   * "Link existing QB invoice" hard-failed for any already-paid invoice
--     (_shared/qbLinkLogic.js buildLinkPatch → qbSync throws the raw error);
--   * Refresh-from-QB and the nightly reconcile silently lost the ENTIRE
--     patch (qb_subtotal/qb_tax_amount/qb_total/payment link/doc number)
--     exactly on the paid transition (_shared/qbRefreshLogic.js);
--   * cascadeMarkLinkedPaid's quote step no-ops every time, so
--     decidePaidInvoiceAction's SKIP_ALREADY_CONVERTED (which reads
--     quote.paid) was unreachable and every webhook redelivery re-ran the
--     full cascade;
--   * handleRecordPayment with table="quotes" created the QB Payment then
--     failed the local flip.
-- The logic and its .eq("paid", false) race guards are all designed around
-- this column — add the column rather than unwind four call sites.

ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS paid boolean NOT NULL DEFAULT false;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS paid_date date;

-- Best-effort backfill so already-settled quotes read as paid: a converted
-- quote whose linked order is paid is paid. Anything the join misses just
-- means one redundant (idempotent) cascade pass on the next webhook
-- delivery — the order/invoice steps are individually gated on paid=false.
UPDATE public.quotes q
SET paid = true, paid_date = o.paid_date
FROM public.orders o
WHERE o.shop_owner = q.shop_owner
  AND q.converted_order_id IS NOT NULL
  AND o.order_id = q.converted_order_id
  AND o.paid = true
  AND q.paid = false;
