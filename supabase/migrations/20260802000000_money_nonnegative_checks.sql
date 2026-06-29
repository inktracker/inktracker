-- Non-negative CHECK constraints on money columns (audit DB-06).
--
-- Totals/tax/discount/commission are unconstrained NUMERIC — any authenticated
-- write or import (the wizard RPC clamps, but direct authed writes don't) could
-- persist a NEGATIVE total. Verified 0 existing negatives across these columns
-- at deploy time, so the constraints validate cleanly.
--
-- CHECK (col >= 0) is NULL-safe (a CHECK passes when the value is NULL), so
-- nullable columns keep working. Drop-then-add makes each idempotent. NUMERIC
-- scale standardization (12,2) is intentionally NOT done here — it rewrites the
-- column and would round existing values; the >= 0 guard is the safety win.

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('quotes','total'),      ('quotes','subtotal'),      ('quotes','tax'),
      ('orders','total'),      ('orders','subtotal'),      ('orders','tax'),
      ('invoices','total'),    ('invoices','subtotal'),    ('invoices','tax'), ('invoices','discount'),
      ('expenses','total'),
      ('commissions','order_total'), ('commissions','commission_amount')
    ) AS t(tbl, col)
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
                   c.tbl, c.tbl || '_' || c.col || '_nonneg');
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I >= 0)',
                   c.tbl, c.tbl || '_' || c.col || '_nonneg', c.col);
  END LOOP;
END $$;
