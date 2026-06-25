-- ============================================================================
-- SECURITY: stop EMPLOYEES from writing financial / broker / ownership columns
-- on orders, while keeping their shop-floor updates working.
-- ============================================================================
-- The `orders_employee` RLS policy is FOR ALL, so an employee (shop-floor-only
-- in the UI) can, via the bundled anon key + their JWT, run e.g.
--   UPDATE orders SET paid = true        -- mark an order paid
--   UPDATE orders SET total = 0           -- alter the money
--   UPDATE orders SET broker_id = 'x'     -- reassign broker/commission
-- RLS scopes rows, not columns, so the policy alone can't prevent this. This is
-- intra-tenant role segregation, not a cross-tenant breakout — but an employee
-- should not be able to touch the books.
--
-- A BEFORE UPDATE trigger blocks changes to a DENYLIST of sensitive columns
-- when (and only when) the CALLER's role is 'employee'. Owners (shop/admin) and
-- managers are unaffected. Service-role + postgres-owned DEFINER functions are
-- exempt (current_user check). Everything employees legitimately update on the
-- shop floor — status, step_notes, checklist, art approval, completed_date,
-- production fields — is NOT in the denylist, so those updates pass untouched.
--
-- SECURITY INVOKER (default) so current_user reflects the actual caller. The
-- caller's own profile is readable under profiles_select_own, so the role
-- lookup resolves for employees; if it can't resolve (impossible for a normal
-- authenticated employee), the guard fails open (no worse than today).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_orders_employee_financial_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  -- Only the client-authenticatable API roles are constrained.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- Look up the CALLER's role (not the row's owner). Only employees are guarded.
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
      'Employees may not change financial, broker, or ownership fields on an order (paid, total, tax, discount, deposit, broker, shop_owner, customer). Ask a shop owner or manager.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_orders_employee_financial_columns ON public.orders;
CREATE TRIGGER guard_orders_employee_financial_columns
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_orders_employee_financial_columns();

COMMENT ON FUNCTION public.guard_orders_employee_financial_columns() IS
  'Blocks role=employee from changing financial/broker/ownership columns on orders. Owners/managers/service_role exempt. Shop-floor fields (status, checklist, step_notes, art approval) are not in the denylist. SECURITY INVOKER so current_user reflects the caller.';
