-- Global search: make job titles and LINE-ITEM content findable.
--
-- The header search only matched customer names and document ids, so
-- "find the hoodie job" or "which order had the TT41s" came up empty —
-- the exact complaint print shops have about Printavo's search. This RPC
-- searches quotes + orders on job_title AND the line_items JSON rendered
-- as text (product titles, style numbers, colors, imprint names).
--
-- SECURITY INVOKER on purpose: RLS applies to the caller, so owners see
-- their shop, managers/brokers see what their policies allow, and anon
-- sees nothing. Callers pass a raw term; the function builds the LIKE
-- pattern itself so metacharacters in user input never act as wildcards.

create or replace function public.search_docs_content(term text)
returns table(kind text, id uuid, doc_id text, job_title text, customer_name text)
language sql
stable
security invoker
set search_path = public
as $$
  with pat as (
    select '%' || replace(replace(replace(coalesce(term, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' as p
  )
  (
    select 'quote'::text, q.id, q.quote_id, q.job_title, q.customer_name
    from quotes q, pat
    where length(coalesce(term, '')) >= 2
      and (q.job_title ilike pat.p or q.line_items::text ilike pat.p)
    order by q.created_at desc
    limit 5
  )
  union all
  (
    select 'order'::text, o.id, o.order_id, o.job_title, o.customer_name
    from orders o, pat
    where length(coalesce(term, '')) >= 2
      and (o.job_title ilike pat.p or o.line_items::text ilike pat.p)
    order by o.created_at desc
    limit 5
  )
$$;

revoke all on function public.search_docs_content(text) from public;
revoke all on function public.search_docs_content(text) from anon;
grant execute on function public.search_docs_content(text) to authenticated;
