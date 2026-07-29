-- qb_line_snapshot — compact mirror of the QB invoice's LINE state.
--
-- Until now the QB mirror kept money state only (qb_total / qb_subtotal /
-- qb_tax_amount), so "modified in QuickBooks" detection was total-only. A
-- shop editing a line's description, quantity, or per-line amount in QBO
-- without moving the invoice total produced no notification and no banner
-- (e.g. changing a garment color from Black to Gray, or swapping two
-- lines' amounts so they net out).
--
-- This column stores what QB reported for the lines at the last mirror, so
-- the next webhook can diff against it and name what actually changed.
-- Compact by design ({i,d,q,a} per line) — the rich local itemization
-- stays in line_items and is never replaced by QB's flattened view.

alter table public.invoices
  add column if not exists qb_line_snapshot jsonb;

alter table public.quotes
  add column if not exists qb_line_snapshot jsonb;

comment on column public.invoices.qb_line_snapshot is
  'Compact snapshot of QB invoice lines at last mirror: [{i,d,q,a}]. Diffed by qbWebhook to detect QB-side line edits. Never customer-facing.';

comment on column public.quotes.qb_line_snapshot is
  'Compact snapshot of QB invoice lines at last mirror: [{i,d,q,a}]. Diffed by qbWebhook to detect QB-side line edits. Never customer-facing.';
