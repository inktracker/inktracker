-- Server-side subscription enforcement on writes (audit BILL-02) — STAGE 1.
--
-- Problem: feature gating ran almost entirely in React. RLS scoped rows by
-- shop_owner but not by subscription STATUS, so an expired / never-paid user
-- (or their token) could still CRUD the data plane directly. BILL-02.
--
-- Fix: gate WRITES in RLS via has_active_subscription(). Key design choices
-- that keep this safe:
--   • WITH CHECK only — never USING. Lapsed shops can still READ, EXPORT, and
--     DELETE their data; they just can't CREATE or MODIFY rows. (We promised
--     "export your data anytime".)
--   • Fail-safe — the function returns TRUE on any case it can't resolve, so
--     a missing profile / unreadable owner row never locks out a legit user.
--     Only a CLEARLY lapsed subscription returns FALSE.
--   • Team inheritance — managers/employees are judged by the OWNER's
--     subscription, never their own (they often sit at 'trial'/'incomplete').
--   • Admins and brokers are never gated here.
--
-- STAGE 1 (this migration): apply to the two highest-value "create work"
-- tables only — quotes and orders (owner policies). This is the canary.
-- STAGE 2 (follow-up, after this is verified safe in prod): extend the same
-- `AND public.has_active_subscription()` to the WITH CHECK of the other owner
-- + team write policies — customers, invoices, expenses, inventory_items,
-- commissions, shop_performance, tax_categories, payees, payment_accounts,
-- purchase_orders, and the *_employee write policies.
--
-- NOT gated, intentionally: profiles + shops (a lapsed user MUST be able to
-- reach billing and resubscribe), and all anon/public-wizard policies
-- (inbound customer leads shouldn't be blocked by a shop's lapse).
--
-- ROLLBACK (if anything misbehaves):
--   ALTER POLICY "quotes_owner" ON public.quotes
--     WITH CHECK (shop_owner = auth.jwt()->>'email');
--   ALTER POLICY "orders_owner" ON public.orders
--     WITH CHECK (shop_owner = auth.jwt()->>'email');
--   (and optionally DROP FUNCTION public.has_active_subscription();)

-- ── has_active_subscription() ───────────────────────────────────────────────
-- Decision contract mirrored + unit-tested in JS:
--   supabase/functions/_shared/billingLogic.js#subscriptionBlocksWrites
CREATE OR REPLACE FUNCTION public.has_active_subscription()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role       text;
  v_shop_owner text;
  v_tier       text;
  v_status     text;
  v_trial      timestamptz;
BEGIN
  SELECT role, shop_owner, subscription_tier, subscription_status, trial_ends_at
    INTO v_role, v_shop_owner, v_tier, v_status, v_trial
  FROM public.profiles
  WHERE auth_id = auth.uid()
  LIMIT 1;

  -- No profile resolvable (service role / edge / odd state): fail-safe allow.
  -- Row-scoping policies still apply; this only governs subscription status.
  IF NOT FOUND THEN
    RETURN true;
  END IF;

  -- Admins and brokers are never gated by subscription here.
  IF v_role IN ('admin', 'broker') THEN
    RETURN true;
  END IF;

  -- Team members inherit the shop OWNER's subscription, never their own.
  IF v_role IN ('manager', 'employee') AND v_shop_owner IS NOT NULL THEN
    SELECT subscription_tier, subscription_status, trial_ends_at
      INTO v_tier, v_status, v_trial
    FROM public.profiles
    WHERE email = v_shop_owner AND role IN ('shop', 'admin')
    LIMIT 1;
    -- Owner row not found → fail-safe allow (don't lock out a whole team).
    IF NOT FOUND THEN
      RETURN true;
    END IF;
  END IF;

  -- Clearly lapsed → block writes. Everything else (active / trialing /
  -- past_due / trial still in window / unknown null) → allow.
  IF v_tier = 'expired'
     OR v_tier = 'incomplete'
     OR v_status = 'canceled'
     OR (v_tier = 'trial' AND v_trial IS NOT NULL AND v_trial < now()) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.has_active_subscription() IS
  'BILL-02: true unless the caller''s governing subscription (own, or shop owner''s for team members) is clearly lapsed (expired/incomplete/canceled/expired-trial). Admins+brokers always true. Fail-safe true on unresolved state. Used in WITH CHECK of write policies.';

-- ── Stage 1 canary: gate writes on quotes + orders (owner policies) ─────────
-- WITH CHECK only; USING (read/delete visibility) is left exactly as-is.
ALTER POLICY "quotes_owner" ON public.quotes
  WITH CHECK (shop_owner = auth.jwt()->>'email' AND public.has_active_subscription());

ALTER POLICY "orders_owner" ON public.orders
  WITH CHECK (shop_owner = auth.jwt()->>'email' AND public.has_active_subscription());
