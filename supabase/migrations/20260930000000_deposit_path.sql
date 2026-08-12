-- Deposit path (docs/deposit-path-design.md).
--
-- Deposits become collectible via a QB "deposit invoice" used as a
-- temporary collection vehicle, settled onto the final full invoice as a
-- linked Payment. These columns hold the agreement snapshot and the
-- deposit invoice's identity/link.
--
-- deposit_amount is a SNAPSHOT (dollars at request time). It is never
-- re-derived from total × pct: order edits change the remainder, never
-- the deposit the customer already agreed to (or paid).
--
-- qb_deposit_invoice_id is deliberately a SEPARATE column from
-- qb_invoice_id so every scanner, reconciler, and paid-cascade keyed on
-- qb_invoice_id ignores deposit invoices by construction.

alter table quotes
  add column if not exists deposit_amount         numeric,
  add column if not exists deposit_paid_at        timestamptz,
  add column if not exists qb_deposit_invoice_id  text,
  add column if not exists qb_deposit_payment_link text;

alter table orders
  add column if not exists deposit_amount         numeric,
  -- Carried quote → order → invoice so final-invoice settlement can find
  -- the outstanding deposit invoice without a reverse-join at sync time.
  add column if not exists qb_deposit_invoice_id  text;

alter table invoices
  add column if not exists deposit_amount         numeric,
  add column if not exists qb_deposit_invoice_id  text;

-- Non-negative money. NULL = "no snapshot yet" (legacy rows / no deposit).
alter table quotes   drop constraint if exists quotes_deposit_amount_nonneg;
alter table quotes   add  constraint quotes_deposit_amount_nonneg
  check (deposit_amount is null or deposit_amount >= 0);
alter table orders   drop constraint if exists orders_deposit_amount_nonneg;
alter table orders   add  constraint orders_deposit_amount_nonneg
  check (deposit_amount is null or deposit_amount >= 0);
alter table invoices drop constraint if exists invoices_deposit_amount_nonneg;
alter table invoices add  constraint invoices_deposit_amount_nonneg
  check (deposit_amount is null or deposit_amount >= 0);

-- Range CHECK parity: quotes got 20260807000000_deposit_pct_clamp_check;
-- orders/invoices carry deposit_pct since 20260819 with no CHECK. Clamp
-- any out-of-range strays first so the constraint can attach.
update orders   set deposit_pct = least(100, greatest(0, deposit_pct))
  where deposit_pct is not null and (deposit_pct < 0 or deposit_pct > 100);
update invoices set deposit_pct = least(100, greatest(0, deposit_pct))
  where deposit_pct is not null and (deposit_pct < 0 or deposit_pct > 100);
alter table orders   drop constraint if exists orders_deposit_pct_range;
alter table orders   add  constraint orders_deposit_pct_range
  check (deposit_pct is null or (deposit_pct >= 0 and deposit_pct <= 100));
alter table invoices drop constraint if exists invoices_deposit_pct_range;
alter table invoices add  constraint invoices_deposit_pct_range
  check (deposit_pct is null or (deposit_pct >= 0 and deposit_pct <= 100));

-- Webhook lookup path: paid deposit invoices are matched by this id.
create index if not exists idx_quotes_qb_deposit_invoice_id
  on quotes (qb_deposit_invoice_id) where qb_deposit_invoice_id is not null;

-- With deposits COLLECTIBLE, a DEFAULT 50 on deposit_pct is a loaded gun:
-- any insert path that omits the field would silently demand a deposit.
-- Every current code path sets it explicitly; the default becomes 0.
-- (Existing rows keep their values — legacy pct>0 rows without a minted
-- deposit invoice are harmless: the customer page requires a live
-- qb_deposit_invoice_id before routing to deposit collection.)
alter table quotes alter column deposit_pct set default 0;

-- ── Employee financial-column guard: deposit_amount joins the denylist ──
-- Lockstep with 20260711020000 + 20260819000000 (same function, one more
-- column). Employees must not edit the deposit snapshot.
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
     OR NEW.deposit_amount  IS DISTINCT FROM OLD.deposit_amount
     -- qb_deposit_invoice_id drives settlement's payment-move + VOID in
     -- the shop's QB realm — the single most dangerous column on this
     -- table. Written only by service-role edge functions, which bypass
     -- this guard by design (security audit 2026-08-12, HIGH). NOTE:
     -- orders has no qb_invoice_id column — do not "defensively" add it
     -- here; the trigger would 42703 on every employee update.
     OR NEW.qb_deposit_invoice_id IS DISTINCT FROM OLD.qb_deposit_invoice_id
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

comment on column quotes.deposit_amount is
  'Dollar snapshot of the requested deposit at mint/mark time. Never re-derived from total × deposit_pct.';
comment on column quotes.qb_deposit_invoice_id is
  'QB id of the temporary deposit-collection invoice. Separate from qb_invoice_id so reconcilers ignore it.';
comment on column quotes.qb_deposit_payment_link is
  'Intuit share link for the deposit invoice. Validated with the same lockstep contract as qb_payment_link.';
