-- QB-payload completeness: the order→invoice→QB path builds the QuickBooks
-- invoice from the INVOICE row, but that row is an incomplete copy of the
-- quote. Beyond setup_total (fixed in 20260817/18), three more fields were
-- dropped, each a silent money discrepancy on order-derived QB invoices:
--   * additional_charges — one-off fees (shipping/rush/…) emitted as their own
--     QB lines by buildQBInvoicePayload. NO column existed on orders OR invoices,
--     so they vanished → QB UNDER-bills by the fee amount (verified $85 / $850).
--   * discount_type — invoices never carried it, so a FLAT discount was misread
--     as a PERCENT by buildQBInvoicePayload (a $50 flat → 50% off) → wrong total.
--     (Column already existed on invoices; completeOrder just didn't write it.)
--   * deposit_pct / deposit_paid — invoices never carried them, so a paid deposit
--     wasn't credited against the QB invoice → customer OVER-charged the deposit.
--
-- The quote→QB path (SendQuoteModal) is unaffected — it sends the quote, which
-- has every field. This brings the invoice path to parity.
--
-- Columns + a safety-guarded backfill. Amount-bearing backfills only fire where
-- the row's stored `total` equals the source total (so the total already billed
-- the thing → we never inflate a charge). Deposit backfill is restricted to
-- invoices NOT yet pushed to QB (qb_invoice_id IS NULL), so it can never enable
-- a double-credit on a later re-sync of an already-pushed invoice.

ALTER TABLE public.orders   ADD COLUMN IF NOT EXISTS additional_charges jsonb;
ALTER TABLE public.orders   ADD COLUMN IF NOT EXISTS deposit_pct numeric;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS additional_charges jsonb;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS deposit_pct numeric;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS deposit_paid boolean;

-- ── orders ← originating quote ───────────────────────────────────────────────
-- Link orders to their source quote BOTH ways: older orders carry quote_id =
-- NULL and only link via quotes.converted_order_id (the reverse pointer) — the
-- same three-way lookup runOrderCompletion uses. Matching on quote_id alone
-- silently misses every pre-link order.
UPDATE public.orders o
SET additional_charges = q.additional_charges
FROM public.quotes q
WHERE o.additional_charges IS NULL
  AND o.shop_owner = q.shop_owner
  AND (o.quote_id = q.quote_id OR q.converted_order_id = o.order_id)
  AND q.additional_charges IS NOT NULL
  AND o.total = q.total;                 -- guard: total already includes the fees

UPDATE public.orders o
SET deposit_pct = q.deposit_pct
FROM public.quotes q
WHERE o.deposit_pct IS NULL
  AND o.shop_owner = q.shop_owner
  AND (o.quote_id = q.quote_id OR q.converted_order_id = o.order_id)
  AND q.deposit_pct IS NOT NULL;

-- Defensive: re-run the setup_total backfill (shipped in 20260818) with the
-- reverse link too. 20260818 matched on quote_id only; an order with quote_id
-- = NULL that carries a setup fee would have been missed. Currently a no-op
-- (verified 0 such rows), but closes the same latent gap consistently.
UPDATE public.orders o
SET setup_total = q.setup_total
FROM public.quotes q
WHERE COALESCE(o.setup_total, 0) = 0
  AND o.shop_owner = q.shop_owner
  AND (o.quote_id = q.quote_id OR q.converted_order_id = o.order_id)
  AND COALESCE(q.setup_total, 0) > 0
  AND o.total = q.total;

-- ── invoices.additional_charges ← linked order, then originating quote ────────
UPDATE public.invoices i
SET additional_charges = o.additional_charges
FROM public.orders o
WHERE i.additional_charges IS NULL
  AND i.order_id = o.order_id AND i.shop_owner = o.shop_owner
  AND o.additional_charges IS NOT NULL
  AND i.total = o.total;

UPDATE public.invoices i
SET additional_charges = q.additional_charges
FROM public.quotes q
WHERE i.additional_charges IS NULL
  AND i.invoice_id = q.quote_id AND i.shop_owner = q.shop_owner
  AND q.additional_charges IS NOT NULL
  AND i.total = q.total;

-- ── invoices.discount_type ← linked order, then originating quote ─────────────
-- Metadata, not an amount — no total guard. A NULL discount_type already
-- behaves as 'percent' in buildQBInvoicePayload, so only FLAT-discount rows are
-- actually wrong; backfilling fixes those and is a no-op for the rest.
UPDATE public.invoices i
SET discount_type = o.discount_type
FROM public.orders o
WHERE i.discount_type IS NULL
  AND i.order_id = o.order_id AND i.shop_owner = o.shop_owner
  AND o.discount_type IS NOT NULL;

UPDATE public.invoices i
SET discount_type = q.discount_type
FROM public.quotes q
WHERE i.discount_type IS NULL
  AND i.invoice_id = q.quote_id AND i.shop_owner = q.shop_owner
  AND q.discount_type IS NOT NULL;

-- ── invoices.deposit_pct / deposit_paid ← linked order ───────────────────────
-- ONLY for invoices not yet in QB — so this can never enable a double deposit
-- credit on a re-sync of an already-pushed invoice.
UPDATE public.invoices i
SET deposit_pct  = o.deposit_pct,
    deposit_paid = o.deposit_paid
FROM public.orders o
WHERE i.order_id = o.order_id AND i.shop_owner = o.shop_owner
  AND i.qb_invoice_id IS NULL
  AND (i.deposit_pct IS NULL OR i.deposit_paid IS NULL);

-- ── Extend the employee financial-column guard to the two new order columns ──
-- additional_charges + deposit_pct are financial; employees must not edit them.
CREATE OR REPLACE FUNCTION public.guard_orders_employee_financial_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE auth_id = auth.uid();
  IF v_role IS DISTINCT FROM 'employee' THEN
    RETURN NEW;
  END IF;

  IF NEW.total              IS DISTINCT FROM OLD.total
     OR NEW.subtotal        IS DISTINCT FROM OLD.subtotal
     OR NEW.tax             IS DISTINCT FROM OLD.tax
     OR NEW.tax_rate        IS DISTINCT FROM OLD.tax_rate
     OR NEW.tax_exempt      IS DISTINCT FROM OLD.tax_exempt
     OR NEW.tax_id          IS DISTINCT FROM OLD.tax_id
     OR NEW.discount        IS DISTINCT FROM OLD.discount
     OR NEW.discount_type   IS DISTINCT FROM OLD.discount_type
     OR NEW.deposit_paid    IS DISTINCT FROM OLD.deposit_paid
     OR NEW.deposit_pct     IS DISTINCT FROM OLD.deposit_pct
     OR NEW.additional_charges IS DISTINCT FROM OLD.additional_charges
     OR NEW.rush_rate       IS DISTINCT FROM OLD.rush_rate
     OR NEW.setup_total     IS DISTINCT FROM OLD.setup_total
     OR NEW.paid            IS DISTINCT FROM OLD.paid
     OR NEW.paid_date       IS DISTINCT FROM OLD.paid_date
     OR NEW.actual_cost     IS DISTINCT FROM OLD.actual_cost
     OR NEW.actual_labor_cost IS DISTINCT FROM OLD.actual_labor_cost
     OR NEW.broker_id       IS DISTINCT FROM OLD.broker_id
     OR NEW.broker_name     IS DISTINCT FROM OLD.broker_name
     OR NEW.broker_company  IS DISTINCT FROM OLD.broker_company
     OR NEW.broker_client_name IS DISTINCT FROM OLD.broker_client_name
     OR NEW.shop_owner      IS DISTINCT FROM OLD.shop_owner
     OR NEW.customer_id     IS DISTINCT FROM OLD.customer_id
  THEN
    RAISE EXCEPTION
      'Employees may not change financial, broker, or ownership fields on an order (paid, total, tax, discount, deposit, fees, broker, shop_owner, customer). Ask a shop owner or manager.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;
