-- Daily 6am-Pacific trigger for the systemHealthCheck edge function, via
-- pg_cron + pg_net INSTEAD of GitHub Actions. GitHub's scheduler drifts 3-6h
-- on this repo (qb-reconcile's "05:00 UTC" job fires ~09:00), so it cannot
-- hit a specific local hour. pg_cron fires from the database, precise.
--
-- DST handling: pg_cron schedules run in UTC, so a fixed UTC hour would drift
-- an hour across DST. Instead pg_cron pokes the guard function four times
-- across the 13:00-15:00 UTC window, and the function only actually fires the
-- health check when it's the 6 o'clock hour in America/Los_Angeles AND it
-- hasn't already run today. Net effect: one call at ~6:07am Pacific, year-round.
--
-- Auth: the guard reads a dedicated bearer token from Vault (secret
-- 'health_cron_token', inserted out-of-band — never committed) and sends it as
-- Authorization. The edge function accepts it via HEALTHCHECK_CRON_TOKEN,
-- separate from the shared CRON_SECRET the GitHub crons use.

create extension if not exists pg_cron;

create or replace function public.fire_system_health_check(force boolean default false)
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_token text;
  v_url   text := 'https://skmltfbibaqcjddmeqvi.supabase.co/functions/v1/systemHealthCheck';
  v_pt_hour text := to_char(now() at time zone 'America/Los_Angeles', 'HH24');
  v_ran_today boolean;
begin
  if not force then
    -- Only in the 6am Pacific hour...
    if v_pt_hour <> '06' then return; end if;
    -- ...and only once per day (the four cron pokes must collapse to one run).
    select exists (
      select 1 from public.qb_event_log
      where action = 'system_health_run' and created_at > now() - interval '20 hours'
    ) into v_ran_today;
    if v_ran_today then return; end if;
  end if;

  select decrypted_secret into v_token
  from vault.decrypted_secrets where name = 'health_cron_token' limit 1;
  if v_token is null or v_token = '' then
    raise warning 'fire_system_health_check: vault secret health_cron_token missing — cannot trigger';
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    body    := '{}'::jsonb,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Content-Type', 'application/json')
  );
end;
$$;

-- Lock the function down — it can trigger an outbound call, so only the
-- table owner / cron should invoke it.
revoke all on function public.fire_system_health_check(boolean) from public, anon, authenticated;

-- (Re)schedule idempotently.
do $$
begin
  perform cron.unschedule('system-health-6am-pt');
exception when others then
  null; -- not scheduled yet
end $$;

select cron.schedule(
  'system-health-6am-pt',
  '7,37 13,14 * * *', -- 13:07/13:37/14:07/14:37 UTC straddles 6am PDT & PST
  $$select public.fire_system_health_check();$$
);
