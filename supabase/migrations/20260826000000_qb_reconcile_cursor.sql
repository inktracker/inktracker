-- Round-robin cursor for the nightly QB reconcile (pre-scale audit,
-- 2026-07-02). The cron used to iterate every QB-connected shop serially
-- in one invocation — O(shops × invoices) against the edge function's
-- wall-clock cap, silently truncating the tail as shop count grows.
--
-- qbReconcile now processes shops least-recently-reconciled first under a
-- time budget and stamps this column after each shop. Shops it doesn't
-- reach keep their older stamp and go to the FRONT of the next night's
-- run — no shop can starve, no separate cursor row to corrupt.

ALTER TABLE public.profile_secrets
  ADD COLUMN IF NOT EXISTS qb_last_reconciled_at TIMESTAMPTZ;
