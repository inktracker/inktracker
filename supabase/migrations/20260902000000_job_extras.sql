-- Per-job add-ons: configured fees toggled ONCE for the whole quote/order
-- (e.g. an art or setup fee). Mirrors additional_charges (which lives on the
-- same three tables) — a map of { feeKey: snapshot } consumed by
-- calcQuoteTotalsWithLinking → sumJobExtras. Nullable JSONB; absent = no per-job
-- fees, so every existing row is unaffected.
--
-- per_print and per_garment add-ons need NO schema change — they ride on the
-- existing line-level li.extras. Only per_job is quote-level, hence this column.

ALTER TABLE public.quotes   ADD COLUMN IF NOT EXISTS job_extras jsonb;
ALTER TABLE public.orders   ADD COLUMN IF NOT EXISTS job_extras jsonb;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS job_extras jsonb;
