-- Shop-level notification preferences: how chatty are the TEAM rails?
--
-- shops.notification_prefs maps category → bool; a MISSING key means ON,
-- so the default '{}' preserves exactly today's behavior for every shop.
-- Categories (enforced at each creation point):
--   order_status   — team pings when a job changes stage (SQL trigger)
--   comment_copies — the owner's automatic copy of every comment
--                    (@mentions are NOT affected — a deliberate human
--                    ping always delivers)
--   task_pings     — task assignment / completion notifications
--
-- Customer-facing emails have their own opt-in (customer_status_notify)
-- and are not governed here.

alter table shops
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

comment on column shops.notification_prefs is
  'Team-notification category toggles: {order_status, comment_copies, task_pings} → bool. Missing key = enabled. @mentions always deliver regardless.';

-- Teach the team-side status trigger to respect the pref. Full function
-- replacement (body otherwise identical to 20260901120000) with an early
-- exit when the shop disabled order_status pings.
create or replace function public.notify_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text;
  actor_name text;
  op_email text;
  recips text[] := '{}';
  r text;
  ttl text;
  bdy text;
  prefs jsonb;
begin
  begin
    if new.status is null or old.status is not distinct from new.status then
      return new;
    end if;

    select coalesce(s.notification_prefs, '{}'::jsonb) into prefs
      from shops s where s.owner_email = new.shop_owner limit 1;
    if coalesce((prefs ->> 'order_status')::boolean, true) = false then
      return new;
    end if;

    actor := lower(coalesce(auth.jwt() ->> 'email', ''));
    select coalesce(nullif(p.full_name, ''), p.email) into actor_name
      from profiles p where lower(p.email) = actor limit 1;

    if lower(new.shop_owner) <> actor then
      recips := array_append(recips, lower(new.shop_owner));
    end if;

    if coalesce(new.assigned_operator, '') <> '' then
      select lower(p.email) into op_email
        from profiles p
       where (lower(p.email) = lower(new.assigned_operator)
              or lower(coalesce(p.full_name, '')) = lower(new.assigned_operator))
         and (p.email = new.shop_owner or p.shop_owner = new.shop_owner)
       limit 1;
      if op_email is not null and op_email <> actor and not (op_email = any(recips)) then
        recips := array_append(recips, op_email);
      end if;
    end if;

    if array_length(recips, 1) is null then
      return new;
    end if;

    ttl := coalesce(nullif(new.customer_name, ''), new.order_id) || ' moved to ' || new.status;
    bdy := new.order_id || ' — ' || coalesce(old.status, '(new)') || ' → ' || new.status
           || case when actor_name is not null then ' · by ' || actor_name else '' end;

    foreach r in array recips loop
      insert into notifications
        (shop_owner, recipient_email, event_type, severity, title, body,
         related_entity, related_id, metadata)
      values
        (new.shop_owner, r, 'order_status', 'info', ttl, bdy,
         'order', new.id::text,
         jsonb_build_object('order_id', new.order_id, 'from', old.status, 'to', new.status));
    end loop;
  exception when others then
    null;
  end;
  return new;
end $$;
