-- Server-side fallback for pre-submit broker quotes.
--
-- quotes.shop_owner is NOT NULL (20260806), but older frontend bundles send
-- shop_owner = null for broker drafts, so every broker draft save failed.
-- The frontend now sends `broker:<email>` (#945); this trigger applies the
-- same placeholder tenant for any client still on the old bundle, so saves
-- work without waiting on a deploy. BEFORE triggers run ahead of the
-- NOT NULL check. No-op whenever shop_owner is already set.

create or replace function public.quotes_default_broker_shop_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.shop_owner is null or new.shop_owner = '')
     and coalesce(nullif(new.broker_id, ''), nullif(new.broker_email, '')) is not null then
    new.shop_owner := 'broker:' || coalesce(nullif(new.broker_id, ''), new.broker_email);
  end if;
  return new;
end;
$$;

drop trigger if exists quotes_default_broker_shop_owner on public.quotes;
create trigger quotes_default_broker_shop_owner
  before insert or update on public.quotes
  for each row execute function public.quotes_default_broker_shop_owner();
