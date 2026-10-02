-- Which ways a shop's customers may pay through InkTracker payments
-- (Joe, 2026-10-02: shops choose). Both on by default; the edge function
-- refuses turning both off.
alter table public.processor_accounts
  add column if not exists accept_card boolean not null default true,
  add column if not exists accept_bank boolean not null default true;
