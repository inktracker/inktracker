-- Hourly Reddit lead scan: storage + scheduler.
--
-- (1) reddit_scan_seen — dedupe store so a thread is emailed to Joe at most
--     once. Operator-global (not per-shop); service-role only, like
--     qb_event_log. RLS on with no policy = locked to the service role the
--     edge function uses.
--
-- (2) pg_cron hourly trigger for the redditScan edge function. Same pattern as
--     the systemHealthCheck trigger (fire function reads a bearer token from
--     Vault and pg_net POSTs the function), minus the DST guard — hourly
--     cadence doesn't care which UTC hour it is, so a plain '5 * * * *' is fine.

create table if not exists public.reddit_scan_seen (
  post_id      text primary key,               -- Reddit fullname, e.g. t3_abc123
  subreddit    text,
  title        text,
  permalink    text,
  score        integer,
  why          text[],
  created_utc  timestamptz,                     -- when the Reddit post was made
  seen_at      timestamptz not null default now()
);

-- Housekeeping index for the occasional "what did we surface lately?" query
-- and for a future retention prune.
create index if not exists reddit_scan_seen_seen_at_idx
  on public.reddit_scan_seen (seen_at desc);

alter table public.reddit_scan_seen enable row level security;
revoke all on public.reddit_scan_seen from anon, authenticated;
grant  all on public.reddit_scan_seen to service_role;

comment on table public.reddit_scan_seen is
  'Dedupe store for the hourly Reddit lead scan (functions/redditScan). One row per surfaced thread so Joe is emailed about it at most once. Service-role only.';

-- ── pg_cron hourly trigger ─────────────────────────────────────────────────
create extension if not exists pg_cron;

create or replace function public.fire_reddit_scan()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_token text;
  v_url   text := 'https://skmltfbibaqcjddmeqvi.supabase.co/functions/v1/redditScan';
begin
  select decrypted_secret into v_token
  from vault.decrypted_secrets where name = 'reddit_scan_cron_token' limit 1;
  if v_token is null or v_token = '' then
    raise warning 'fire_reddit_scan: vault secret reddit_scan_cron_token missing — cannot trigger';
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    body    := '{}'::jsonb,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Content-Type', 'application/json')
  );
end;
$$;

-- Outbound-call trigger — lock it to owner/cron only.
revoke all on function public.fire_reddit_scan() from public, anon, authenticated;

-- (Re)schedule idempotently — hourly at :05.
do $$
begin
  perform cron.unschedule('reddit-scan-hourly');
exception when others then
  null; -- not scheduled yet
end $$;

select cron.schedule(
  'reddit-scan-hourly',
  '5 * * * *',
  $$select public.fire_reddit_scan();$$
);
