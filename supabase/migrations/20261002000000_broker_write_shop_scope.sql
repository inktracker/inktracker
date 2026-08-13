-- Broker security audit 2026-08-13 (P2): quotes_broker_write's WITH CHECK
-- only bound broker_id — a broker could INSERT/UPDATE rows carrying ANY
-- shop_owner, planting "Pending" quotes in shops they were never assigned
-- to (cross-tenant queue injection). Bind shop_owner to the broker's own
-- assigned_shops (their profile row — readable under profiles_select_own,
-- no self-reference recursion: this is a policy on QUOTES reading
-- PROFILES, and profiles' policies never reference quotes).
--
-- USING stays broker_id-only: brokers legitimately edit their own drafts
-- and submitted quotes; the tenancy hole was on the WRITE side.

drop policy if exists quotes_broker_write on public.quotes;
create policy quotes_broker_write on public.quotes
  for all to authenticated
  using  (broker_id = (auth.jwt() ->> 'email'))
  with check (
    broker_id = (auth.jwt() ->> 'email')
    and (
      shop_owner is null
      or exists (
        select 1
        from public.profiles p
        where p.auth_id = auth.uid()
          and p.assigned_shops ? quotes.shop_owner
      )
    )
  );
