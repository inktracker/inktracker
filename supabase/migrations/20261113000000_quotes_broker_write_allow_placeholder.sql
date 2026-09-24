-- Let brokers write their own pre-submit quotes under the `broker:<email>`
-- placeholder tenant.
--
-- #945 / 20261112 moved pre-submit broker quotes from shop_owner = NULL
-- (illegal since the 20260806 NOT NULL) to `broker:<email>`. But the live
-- quotes_broker_write WITH CHECK only allowed shop_owner NULL or one of the
-- broker's assigned_shops, so the placeholder would be rejected by RLS and
-- the broker save would still fail — now with a permission error. Allow the
-- broker's OWN placeholder (never another broker's).

alter policy quotes_broker_write on public.quotes
  with check (
    broker_id = (auth.jwt() ->> 'email')
    and (
      shop_owner is null
      or shop_owner = 'broker:' || (auth.jwt() ->> 'email')
      or exists (
        select 1 from public.profiles p
        where p.auth_id = auth.uid()
          and p.assigned_shops ? quotes.shop_owner
      )
    )
  );
