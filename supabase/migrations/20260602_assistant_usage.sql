-- Per-user, per-day rate limit for the onboarding assistant.
--
-- The assistant proxies Anthropic via Haiku 4.5, ~$0.004/question.
-- A single shop owner could in theory send thousands of messages a
-- day and rack up real cost from one account. Caps are also a
-- defense against prompt-injection loops that try to abuse the
-- assistant as a free LLM.
--
-- Tiny table keyed by (user_id, date). Edge function upserts +
-- increments on each call and rejects with 429 once the count
-- exceeds the limit (enforced in code, not DB — keeps the limit
-- value tunable without a migration).
--
-- Service-role only. No surface for anon/authenticated to read or
-- write — they only ever interact through the edge function.

CREATE TABLE IF NOT EXISTS public.assistant_usage (
  user_id   UUID    NOT NULL,
  day       DATE    NOT NULL DEFAULT current_date,
  count     INT     NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- Cleanup support: older rows aren't load-bearing once their day
-- has passed (count would just start fresh anyway). Index lets a
-- future vacuum query drop them.
CREATE INDEX IF NOT EXISTS assistant_usage_day_idx
  ON public.assistant_usage (day);

ALTER TABLE public.assistant_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.assistant_usage FROM anon, authenticated;
GRANT  ALL ON public.assistant_usage TO service_role;

-- Atomic increment: inserts {today, 1} or bumps existing count.
-- SECURITY DEFINER + locked-down search_path so the edge function
-- can call this without granting the underlying table to anyone
-- beyond service_role.
CREATE OR REPLACE FUNCTION public.increment_assistant_usage(p_user_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count INT;
BEGIN
  INSERT INTO public.assistant_usage (user_id, day, count)
  VALUES (p_user_id, current_date, 1)
  ON CONFLICT (user_id, day) DO UPDATE
    SET count = public.assistant_usage.count + 1
  RETURNING count INTO new_count;
  RETURN new_count;
END;
$$;

-- Only the edge function (service role) calls this. Lock it down.
REVOKE ALL ON FUNCTION public.increment_assistant_usage(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_assistant_usage(UUID) TO service_role;
