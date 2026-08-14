-- Shop partnerships — MVP schema (docs/shop-partnerships-design.md).
--
-- Peer shops subcontract to each other (print ↔ embroidery). Both stay
-- full shop accounts; hand-offs cross tenants ONLY through the
-- partnerHandoff service-role edge function. Blind by default; trade
-- price snapshots at acceptance.

-- ── Partner links ───────────────────────────────────────────────────────
create table if not exists shop_partners (
  id           uuid primary key default gen_random_uuid(),
  shop_a       text not null,   -- invite sender (owner email)
  shop_b       text not null,   -- invite recipient (owner email)
  status       text not null default 'invited'
               check (status in ('invited','active','ended')),
  specialty_a  text,            -- display only, v1 (e.g. 'Screen printing')
  specialty_b  text,
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  check (shop_a <> shop_b)
);

-- One link per pair regardless of direction.
create unique index if not exists shop_partners_pair_uniq
  on shop_partners (least(shop_a, shop_b), greatest(shop_a, shop_b));

-- ── Hand-offs ───────────────────────────────────────────────────────────
create table if not exists partner_handoffs (
  id                  uuid primary key default gen_random_uuid(),
  sending_shop        text not null,
  receiving_shop      text not null,
  source_order_id     text not null,   -- sender's orders.order_id
  source_line_ids     text[] not null default '{}',
  receiving_order_id  text,            -- receiver's orders.order_id, set on accept
  status              text not null default 'offered'
                      check (status in ('offered','accepted','declined',
                                        'countered','in_production',
                                        'completed','cancelled')),
  blind               boolean not null default true,
  due_date            date,
  counter_due_date    date,
  -- SNAPSHOT at acceptance (deposit-path lesson: the agreement is a
  -- number written once; the receiver's invoice generates FROM it).
  agreed_trade_total  numeric check (agreed_trade_total is null or agreed_trade_total >= 0),
  offered_trade_total numeric check (offered_trade_total is null or offered_trade_total >= 0),
  note                text,
  spec                jsonb not null,  -- sanitized portable job payload
  created_at          timestamptz not null default now(),
  accepted_at         timestamptz,
  completed_at        timestamptz,
  check (sending_shop <> receiving_shop)
);

create index if not exists partner_handoffs_sending_idx   on partner_handoffs (sending_shop, status);
create index if not exists partner_handoffs_receiving_idx on partner_handoffs (receiving_shop, status);

-- One LIVE hand-off per source order. The sender order carries a single
-- partner_cost/partner_status pair, so a second concurrent offer/accept of
-- the same order would clobber its P&L and fight over the chip. Terminal
-- states (declined/cancelled/completed) are excluded so an order can be
-- re-offered after a decline.
create unique index if not exists partner_handoffs_one_live_per_order
  on partner_handoffs (sending_shop, source_order_id)
  where status in ('offered','accepted','in_production');

-- ── Sender-side mirror + costing columns on orders ─────────────────────
alter table orders
  add column if not exists partner_handoff_id  uuid,     -- receiver side: backlink to the hand-off
  add column if not exists partner_status      text,     -- sender side: mirrored partner progress
  add column if not exists partner_cost        numeric   -- sender side: agreed trade total (job P&L)
      check (partner_cost is null or partner_cost >= 0);

-- ── RLS ────────────────────────────────────────────────────────────────
alter table shop_partners  enable row level security;
alter table partner_handoffs enable row level security;

-- A caller "acts for" a shop when their profile email IS the shop owner
-- or their profiles.shop_owner points at it (managers). Employees and
-- brokers are excluded from partnership surfaces. Reading profiles from
-- another table's policy is the established safe pattern (no profiles
-- self-reference).
-- Case-insensitive match: the edge function lowercases every party column,
-- while orders.shop_owner / profiles.email can be mixed-case. Comparing
-- case-sensitively would make a mixed-case shop fail its own RLS closed and
-- silently miss its orders. lower() both sides keeps them in lockstep.
create or replace function public.acts_for_shop(p_shop text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.auth_id = auth.uid()
      and p.role in ('shop','admin','manager')
      and (lower(p.email) = lower(p_shop) or lower(p.shop_owner) = lower(p_shop))
  );
$$;

drop policy if exists shop_partners_select on shop_partners;
create policy shop_partners_select on shop_partners
  for select to authenticated
  using (acts_for_shop(shop_a) or acts_for_shop(shop_b));

-- ALL writes to shop_partners go through the partnerHandoff edge function
-- (service role), exactly like partner_handoffs. Authenticated INSERT/UPDATE
-- policies previously let either party self-activate an invite or rewrite
-- shop_a/shop_b to a non-consenting shop, bypassing the invite→accept
-- consent flow (audit 2026-08). No authenticated write policies exist now —
-- that omission IS the consent boundary.
drop policy if exists shop_partners_insert on shop_partners;
drop policy if exists shop_partners_update on shop_partners;

-- Hand-offs: both parties may READ their own; ALL writes go through the
-- partnerHandoff edge function (service role). No authenticated write
-- policies exist — that is the tenant-isolation boundary.
drop policy if exists partner_handoffs_select on partner_handoffs;
create policy partner_handoffs_select on partner_handoffs
  for select to authenticated
  using (acts_for_shop(sending_shop) or acts_for_shop(receiving_shop));

-- ── NEW-05 lockstep: re-assert orders_employee write gate ──────────────
-- This file names orders_employee (guard regen below) and contains WITH
-- CHECK clauses, so the NEW-05 guard test treats it as the effective
-- policy file. Restate the full gate verbatim from 20260808000000 so the
-- invariant holds by construction (no-op against live state).
ALTER POLICY "orders_employee" ON public.orders
  WITH CHECK (
    (
      shop_owner IN (
        SELECT jsonb_array_elements_text(p.assigned_shops)
        FROM public.profiles p
        WHERE p.auth_id = auth.uid() AND p.assigned_shops IS NOT NULL
      )
      AND public.manager_section_allowed('Production')
    )
    AND public.has_active_subscription()
  );

-- ── Employee financial guard: partner_cost joins the denylist ──────────
-- (Lockstep regeneration of guard_orders_employee_financial_columns with
-- one more column; see 20260711020000 / 20260819 / 20260930.)
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
     OR NEW.qb_deposit_invoice_id IS DISTINCT FROM OLD.qb_deposit_invoice_id
     OR NEW.partner_cost    IS DISTINCT FROM OLD.partner_cost
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
      'Employees may not change financial, broker, or ownership fields on an order (paid, total, tax, discount, deposit, fees, partner cost, broker, shop_owner, customer). Ask a shop owner or manager.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

-- ── Status mirror: receiver's order → hand-off → sender's order ────────
-- A DB trigger (not client code) so the mirror can never be skipped by a
-- stale tab or a floor tablet. SECURITY DEFINER: the cross-tenant write
-- to the SENDER's order is exactly the one place partnership state may
-- cross shops, and it writes only partner_status (a display chip) plus
-- the hand-off row + a completion bell.
create or replace function public.mirror_partner_handoff_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_handoff partner_handoffs%rowtype;
  v_mirror text;
begin
  if new.partner_handoff_id is null or new.status is not distinct from old.status then
    return new;
  end if;

  select * into v_handoff from partner_handoffs where id = new.partner_handoff_id;
  if not found then return new; end if;

  -- Spoof guard: only the RECEIVER's own order may drive the mirror. Without
  -- this, a sender (who knows the handoff uuid via RLS) could stamp
  -- partner_handoff_id on one of their own orders and flip its status to
  -- fake progress/completion on their own board.
  if new.shop_owner is distinct from v_handoff.receiving_shop then
    return new;
  end if;

  v_mirror := case
    when new.status in ('Cancelled','Canceled','Voided') then 'cancelled'
    when new.status in ('Completed','Ready for Pickup') then 'completed'
    when new.status = 'Art Approval' then 'accepted'
    else 'in_production'
  end;

  -- Advance the hand-off ONLY from a live state. FOUND tells us whether this
  -- was a real transition — so the completion/cancel bell fires exactly once
  -- and a bounce back into a completed status can't re-notify or regress.
  update partner_handoffs
     set status = case
                    when v_mirror = 'completed' then 'completed'
                    when v_mirror = 'cancelled' then 'cancelled'
                    else 'in_production'
                  end,
         completed_at = case when v_mirror = 'completed' then coalesce(completed_at, now()) else completed_at end
   where id = v_handoff.id
     and status in ('accepted','in_production');
  if not found then
    -- Hand-off already terminal (completed/cancelled/declined) — freeze the
    -- sender chip and don't re-notify.
    return new;
  end if;

  update orders o
     set partner_status = v_mirror
   where o.shop_owner = v_handoff.sending_shop
     and o.order_id   = v_handoff.source_order_id;

  if v_mirror = 'completed' then
    insert into notifications (shop_owner, event_type, severity, title, body, related_entity, related_id, metadata)
    values (
      v_handoff.sending_shop,
      'partner_job_completed',
      'info',
      'Partner job completed',
      'Your partner finished the subcontracted work on order ' || v_handoff.source_order_id ||
        '. Expect their invoice' ||
        case when v_handoff.agreed_trade_total is not null
             then ' for $' || to_char(v_handoff.agreed_trade_total, 'FM999999990.00') else '' end || '.',
      'order',
      v_handoff.source_order_id,
      jsonb_build_object('partner_handoff_id', v_handoff.id, 'receiving_shop', v_handoff.receiving_shop)
    );
  elsif v_mirror = 'cancelled' then
    insert into notifications (shop_owner, event_type, severity, title, body, related_entity, related_id, metadata)
    values (
      v_handoff.sending_shop,
      'partner_job_cancelled',
      'warning',
      'Partner cancelled the job',
      'Your partner cancelled the subcontracted work on order ' || v_handoff.source_order_id ||
        '. Re-place it with another partner or produce it in-house.',
      'order',
      v_handoff.source_order_id,
      jsonb_build_object('partner_handoff_id', v_handoff.id, 'receiving_shop', v_handoff.receiving_shop)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists mirror_partner_handoff_status on orders;
create trigger mirror_partner_handoff_status
  after update of status on orders
  for each row
  execute function public.mirror_partner_handoff_status();

comment on table shop_partners is
  'Peer shop partnerships (print ↔ embroidery subcontracting). One row per pair.';
comment on table partner_handoffs is
  'Cross-tenant job offers. Written ONLY by the partnerHandoff edge function (service role) — no authenticated write policies by design.';
comment on column partner_handoffs.spec is
  'Sanitized portable job payload (partnerSpec.js): specs/art/quantities only — never sender customer identity or retail pricing when blind.';
