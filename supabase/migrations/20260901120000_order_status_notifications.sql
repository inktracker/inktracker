-- Status-change notifications, team side (communication phase 3a).
--
-- When an order's status changes, notify the shop owner and the assigned
-- operator — never the person who made the change. Implemented as a DB
-- trigger so EVERY write site is covered (ShopFloor stage buttons, the
-- order modal, and anything added later) without touching client code.
-- Rows are addressed (recipient_email), so delivery rides the existing
-- bell + per-person push rails untouched.
--
-- Safety posture:
--  * The entire body is wrapped in an exception handler — a notification
--    failure can NEVER block or roll back the order update itself.
--  * SECURITY DEFINER (owner postgres) because notifications INSERT is
--    service-role-only under RLS by design; search_path pinned.
--  * Fires only on a real status transition (UPDATE OF status + IS
--    DISTINCT FROM), never on insert.

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
begin
  begin
    if new.status is null or old.status is not distinct from new.status then
      return new;
    end if;

    -- Who made the change (empty for service-role/system writes — then
    -- everyone relevant gets notified, since nobody is the actor).
    actor := lower(coalesce(auth.jwt() ->> 'email', ''));
    select coalesce(nullif(p.full_name, ''), p.email) into actor_name
      from profiles p where lower(p.email) = actor limit 1;

    if lower(new.shop_owner) <> actor then
      recips := array_append(recips, lower(new.shop_owner));
    end if;

    -- assigned_operator stores a display label (full_name || email) —
    -- resolve it to a real member of THIS shop.
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
    null;  -- never block the order write over a notification
  end;
  return new;
end $$;

drop trigger if exists order_status_change_notify on public.orders;
create trigger order_status_change_notify
  after update of status on public.orders
  for each row execute function public.notify_order_status_change();
