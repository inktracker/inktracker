-- Prevent duplicate invoices for the same job.
--
-- Joe found that completing an order from the kanban created a NEW
-- invoice even when the quote had already been invoiced via the
-- Send-Quote → QB flow. Two paths into the `invoices` table didn't
-- know about each other:
--
--   Path A: SendQuoteModal calls qbSync.createInvoice, which makes
--           a QB invoice. handlePullInvoices later syncs that QB
--           invoice down into public.invoices using DocNumber as
--           invoice_id (often the quote_id itself, e.g. "Q-2027-VBII").
--
--   Path B: handleComplete (Production.jsx, Orders.jsx) creates a
--           fresh public.invoices row with invoice_id like
--           "INV-2026-XXXX" and order_id linking to the order.
--
-- Both rows exist for the same logical job. Joe's UI then showed
-- two "Paid" line items, customer received two invoices in QB,
-- bookkeeping diverged.
--
-- This migration enforces uniqueness at the database level:
--
--   1. (shop_owner, invoice_id) unique — a shop can't have two
--      invoices with the same human-readable id. Catches Pull
--      Invoices re-insertion races + manual edits.
--
--   2. (shop_owner, order_id) unique WHERE order_id IS NOT NULL
--      AND order_id != '' — one InkTracker invoice per order.
--      handleComplete's check + DB enforcement = belt-and-suspenders.
--
-- Both indexes are partial / NULL-permissive so QB-pulled invoices
-- with no order_id stay legal. Verified pre-migration: zero existing
-- rows violate either constraint.

-- Belt-and-suspenders: re-verify no dupes exist at apply time.
DO $$
DECLARE
  v_invoice_dups int;
  v_order_dups   int;
BEGIN
  SELECT COUNT(*) INTO v_invoice_dups FROM (
    SELECT shop_owner, invoice_id
    FROM public.invoices
    WHERE invoice_id IS NOT NULL AND invoice_id <> ''
    GROUP BY shop_owner, invoice_id
    HAVING COUNT(*) > 1
  ) d;

  SELECT COUNT(*) INTO v_order_dups FROM (
    SELECT shop_owner, order_id
    FROM public.invoices
    WHERE order_id IS NOT NULL AND order_id <> ''
    GROUP BY shop_owner, order_id
    HAVING COUNT(*) > 1
  ) d;

  IF v_invoice_dups > 0 THEN
    RAISE EXCEPTION
      '% (shop_owner, invoice_id) pairs are duplicated — must be cleaned up before this constraint can be added',
      v_invoice_dups;
  END IF;

  IF v_order_dups > 0 THEN
    RAISE EXCEPTION
      '% (shop_owner, order_id) pairs are duplicated — must be cleaned up before this constraint can be added',
      v_order_dups;
  END IF;
END $$;

-- Unique invoice_id per shop. Partial so anonymous/QB-pulled rows
-- (theoretical edge case where invoice_id is null) don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_shop_invoice_id_unique
  ON public.invoices (shop_owner, invoice_id)
  WHERE invoice_id IS NOT NULL AND invoice_id <> '';

-- Unique order_id per shop — one InkTracker invoice per order.
-- Partial so QB-pulled invoices without an order linkage stay legal.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_shop_order_id_unique
  ON public.invoices (shop_owner, order_id)
  WHERE order_id IS NOT NULL AND order_id <> '';
