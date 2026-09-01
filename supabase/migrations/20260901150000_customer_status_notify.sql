-- Customer-facing status notifications (communication phase 3b).
--
-- Shops opt IN per status: shops.customer_status_notify maps a status to
-- {enabled, note}. Everything defaults OFF — no shop emails a customer
-- until its owner flips a toggle in Account → Customer Updates.
--
-- Delivery: a second status trigger (additive — the team-side
-- order_status_change_notify is untouched) fires an async pg_net POST to
-- the statusCustomerEmail edge function, which is SELF-VALIDATING: it
-- re-reads the order, checks the shop's config, resolves the recipient,
-- dedupes via notification_log, and sends through the shared Resend
-- rails (so the nightly email-health alert watches this path for free).
--
-- DEPLOY ORDER: statusCustomerEmail edge function goes out BEFORE this
-- migration in the same session; if a post ever 404s it is harmless and
-- the order write is unaffected (exception-wrapped like its siblings).

alter table shops
  add column if not exists customer_status_notify jsonb not null default '{}'::jsonb;

comment on column shops.customer_status_notify is
  'Per-status customer email opt-in: { "<status>": { "enabled": bool, "note": text } }. Default {} = never email customers. Read by the statusCustomerEmail edge function.';

-- Allow the new event type in the email audit log (superset of the live
-- constraint, verified against prod before writing).
alter table public.notification_log
  drop constraint if exists notification_log_event_type_check;
alter table public.notification_log
  add constraint notification_log_event_type_check check (event_type in (
    'quote_approval', 'artwork_approval', 'quote_payment',
    'quote_send', 'reply', 'payment_confirmation', 'trial_reminder',
    'signup_notify', 'welcome_email', 'drip_day2',
    'status_update'
  ));

create or replace function public.notify_customer_on_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  begin
    if new.status is null or old.status is not distinct from new.status then
      return new;
    end if;
    perform net.http_post(
      url     := 'https://skmltfbibaqcjddmeqvi.supabase.co/functions/v1/statusCustomerEmail',
      body    := jsonb_build_object('record', jsonb_build_object(
                   'id', new.id, 'from', old.status, 'to', new.status)),
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  exception when others then
    raise warning 'notify_customer_on_status_change failed (non-fatal): %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists order_status_customer_notify on public.orders;
create trigger order_status_customer_notify
  after update of status on public.orders
  for each row execute function public.notify_customer_on_status_change();
