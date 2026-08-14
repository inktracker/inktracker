-- Line-level split hand-offs (docs/shop-partnerships-design.md).
--
-- v1 allowed ONE live hand-off per order. This lets a shop split ONE order
-- across MULTIPLE partners — different lines to different embroiderers —
-- while keeping the sender-side money/chip coherent. The sender order still
-- carries a single partner_cost/partner_status pair, but both are now
-- AGGREGATES over the order's hand-offs, recomputed by a single function.

-- No more "one live hand-off per order" — overlap is now enforced per LINE.
-- source_line_ids is text[], so a plain partial-unique index can't express
-- "no two live hand-offs share a line". Instead the insert goes through
-- offer_partner_handoff() below, which serializes concurrent offers for the
-- same order under an advisory lock and re-checks overlap inside the txn —
-- a real DB-level guarantee, not a best-effort app read-then-insert.
drop index if exists partner_handoffs_one_live_per_order;

-- Atomic offer: lock the (shop, order) pair, reject if any requested line is
-- already out to a live hand-off, else insert. One transaction, so two
-- concurrent offers of the same line can't both win (closes the TOCTOU the
-- dropped unique index used to cover).
create or replace function public.offer_partner_handoff(
  p_sending_shop      text,
  p_receiving_shop    text,
  p_source_order_id   text,
  p_line_ids          text[],
  p_blind             boolean,
  p_due_date          date,
  p_offered_trade_total numeric,
  p_note              text,
  p_spec              jsonb)
returns partner_handoffs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_clash text[];
  v_row   partner_handoffs;
begin
  -- Serialize offers for this order so the overlap check and insert are one
  -- critical section. Released automatically at end of this function's txn.
  perform pg_advisory_xact_lock(hashtext(p_sending_shop || '|' || p_source_order_id));

  select array_agg(x) into v_clash
  from unnest(p_line_ids) x
  where exists (
    select 1 from partner_handoffs h
    where h.sending_shop    = p_sending_shop
      and h.source_order_id = p_source_order_id
      and h.status in ('offered','accepted','in_production')
      and x = any(h.source_line_ids)
  );
  if v_clash is not null then
    raise exception 'LINE_OVERLAP: % already out to a partner', v_clash
      using errcode = 'unique_violation';
  end if;

  insert into partner_handoffs (
    sending_shop, receiving_shop, source_order_id, source_line_ids,
    blind, due_date, offered_trade_total, note, spec)
  values (
    p_sending_shop, p_receiving_shop, p_source_order_id, coalesce(p_line_ids, '{}'),
    p_blind, p_due_date, p_offered_trade_total, p_note, p_spec)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.offer_partner_handoff(text,text,text,text[],boolean,date,numeric,text,jsonb) from public;
grant  execute on function public.offer_partner_handoff(text,text,text,text[],boolean,date,numeric,text,jsonb) to service_role;

-- Recompute the sender order's partner rollup from ALL its hand-offs:
--   partner_cost   = Σ agreed_trade_total over accepted/in_production/completed
--                    (declined/cancelled/offered contribute nothing)
--   partner_status = the LEAST-advanced active chip (so "completed" only when
--                    every active hand-off is completed); 'cancelled' when the
--                    only non-offered hand-offs are cancelled; else null.
-- SECURITY DEFINER: called from the receiver-side trigger (cross-tenant write
-- to the sender's order) and from the edge function (service role) on accept.
create or replace function public.refresh_order_partner_rollup(
  p_sending_shop text, p_source_order_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cost numeric;
  v_rank int;
  v_has_cancelled boolean;
  v_status text;
begin
  select
    sum(agreed_trade_total) filter (where status in ('accepted','in_production','completed')),
    min(case status when 'accepted' then 1 when 'in_production' then 2 when 'completed' then 3 end)
      filter (where status in ('accepted','in_production','completed')),
    bool_or(status = 'cancelled')
  into v_cost, v_rank, v_has_cancelled
  from partner_handoffs
  where sending_shop = p_sending_shop and source_order_id = p_source_order_id;

  v_status := case
    when v_rank = 1 then 'accepted'
    when v_rank = 2 then 'in_production'
    -- All active legs completed BUT a partner bailed → 'cancelled' (needs
    -- attention), never a green 'completed' that hides unproduced lines.
    when v_rank = 3 and v_has_cancelled then 'cancelled'
    when v_rank = 3 then 'completed'
    when v_has_cancelled then 'cancelled'
    else null
  end;

  update orders
     set partner_cost   = v_cost,
         partner_status = v_status
   where shop_owner = p_sending_shop
     and order_id   = p_source_order_id;
end;
$$;

revoke execute on function public.refresh_order_partner_rollup(text, text) from public;
grant  execute on function public.refresh_order_partner_rollup(text, text) to service_role;

-- Mirror trigger: advance THIS hand-off, then rebuild the order's aggregate
-- chip/cost from every hand-off (not just this one) so split orders stay
-- coherent. Per-hand-off completion/cancel bells still fire once each.
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

  -- Spoof guard: only the RECEIVER's own order may drive the mirror.
  if new.shop_owner is distinct from v_handoff.receiving_shop then
    return new;
  end if;

  v_mirror := case
    when new.status in ('Cancelled','Canceled','Voided') then 'cancelled'
    when new.status in ('Completed','Ready for Pickup') then 'completed'
    when new.status = 'Art Approval' then 'accepted'
    else 'in_production'
  end;

  -- Advance the hand-off ONLY from a live state. FOUND = a real transition,
  -- so the completion/cancel bell fires exactly once and a bounce back can't
  -- re-notify or regress.
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
    return new;  -- hand-off already terminal — no re-notify, no regress
  end if;

  -- Rebuild the sender order's aggregate chip + cost across ALL hand-offs.
  perform public.refresh_order_partner_rollup(v_handoff.sending_shop, v_handoff.source_order_id);

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
