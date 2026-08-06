-- Cardless 14-day trial at signup (reverts BILL-01's card wall).
--
-- Decision 2026-08-06: every organic signup since the card wall shipped
-- (2 of 2 — joe@deadringer.co Jul 3, michael@arsupremo.com Jul 31) bounced at
-- the "add a payment method to start your trial" step without creating a
-- single quote. The wall was keeping abusers out at the cost of keeping
-- everyone out. Joe chose to drop it.
--
-- Before: fresh self-signup → tier 'incomplete', no access until Stripe
-- Checkout (card up front) flips them to shop/trialing via the webhook.
--
-- After: fresh self-signup → tier 'trial', status 'trialing',
-- trial_ends_at = now() + 14 days. Full access immediately. The expiry wall
-- is the existing lapsed-subscription read-only mode (#631): when the trial
-- ends, getEffectiveTier collapses to 'expired' and has_active_subscription()
-- blocks writes — the shop keeps read access to their data and a Reactivate
-- path. Checkout mid-trial carries only the REMAINING trial days to Stripe
-- (trialPeriodDaysForCheckout), so adding a card never grants a second trial;
-- an expired-trial checkout charges today.
--
-- The abuse surface BILL-01 closed (me+1@, me+2@ serial trials) is accepted
-- for now: signup-notify emails make every signup visible, and re-walling is
-- a one-migration revert if it's abused in practice.
--
-- Unchanged: the invited-account branch (broker/employee/manager pre-created
-- by a shop owner) still just links auth_id and keeps its role.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Invited account flow: a row already exists (admin pre-created a
  -- broker/employee). Just link auth_id. Don't touch role — the
  -- shop owner already decided what they should be.
  IF EXISTS (SELECT 1 FROM public.profiles WHERE email = NEW.email) THEN
    UPDATE public.profiles
    SET auth_id = NEW.id
    WHERE email = NEW.email AND auth_id IS NULL;
    RETURN NEW;
  END IF;

  -- Fresh self-signup: start the 14-day trial immediately, no card.
  -- Expiry is enforced by getEffectiveTier (client) and
  -- has_active_subscription() (RLS write gate) off trial_ends_at.
  INSERT INTO public.profiles (
    auth_id, email, role, subscription_tier, subscription_status, trial_ends_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    'shop',
    'trial',
    'trialing',
    now() + interval '14 days'
  );
  RETURN NEW;
END;
$$;

-- Backfill: shop-owner accounts stranded at the wall get a fresh 14-day
-- trial starting now (deliberately fresh, not backdated — the point is to
-- give them a real shot at the product they never got to touch).
-- role='shop' only: broker/employee/manager rows sitting at 'incomplete'
-- inherit the owner's subscription via resolveTeamSubscription and bypass
-- billing gates by role, so their tier field is inert — leave it alone.
-- Legacy role='user' rows keep the activate_trial RPC path.
UPDATE public.profiles
SET subscription_tier = 'trial',
    subscription_status = 'trialing',
    trial_ends_at = now() + interval '14 days'
WHERE subscription_tier = 'incomplete'
  AND role = 'shop';
