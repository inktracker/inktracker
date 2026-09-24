-- Hand a broker quote back to its broker when the shop deletes the order.
--
-- revertQuoteOnOrderDelete (shop-side, on order delete) tried to un-queue a
-- broker quote with a plain UPDATE setting shop_owner = NULL. That could never
-- succeed: shop_owner is NOT NULL (20260806), and even before that the shop's
-- own RLS WITH CHECK (quotes_owner / quotes_manager) forbids moving a row out
-- of its tenant. The failure was swallowed as a console.warn, so the quote
-- stayed stranded at "Converted to Order" — invisible to the shop's Quotes
-- list AND never returned to the broker.
--
-- This SECURITY DEFINER function does the hand-back after verifying the
-- caller is the quote's shop owner or a manager assigned to that shop.
-- It re-tenants to the `broker:<email>` placeholder (the same pre-submit
-- tenant the broker dashboard writes) and resets status so the broker can
-- re-submit.

create or replace function public.return_quote_to_broker(p_quote_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text := auth.jwt() ->> 'email';
  v_quote  public.quotes%rowtype;
begin
  if v_email is null or v_email = '' then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_quote from public.quotes where id::text = p_quote_id;
  if not found then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;

  if coalesce(v_quote.broker_id, '') = '' then
    raise exception 'quote has no broker' using errcode = '22023';
  end if;

  if not (
    v_quote.shop_owner = v_email
    or exists (
      select 1 from public.profiles p
      where p.auth_id = auth.uid()
        and p.role = 'manager'
        and p.assigned_shops ? v_quote.shop_owner
    )
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  update public.quotes
     set status = 'Client Approved',
         converted_order_id = null,
         shop_owner = 'broker:' || v_quote.broker_id
   where id = v_quote.id;
end;
$$;

revoke all on function public.return_quote_to_broker(text) from public, anon;
grant execute on function public.return_quote_to_broker(text) to authenticated;
