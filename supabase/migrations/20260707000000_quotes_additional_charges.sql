-- Tester request (Kato / Thunder House, 2026-06-15): a quote needs a place to
-- add one-off named charges with a custom dollar amount (e.g. "Estimated
-- shipping — $25"), separate from the per-piece "extras" system. Each charge
-- carries a taxable flag: taxable charges join the taxed base; non-taxable
-- charges are added to the total after tax.
--
-- Shape (jsonb array):
--   [{ "id": "...", "label": "Estimated shipping", "amount": 25, "taxable": false }, ...]
--
-- Backward-compatible & inert: nullable, no default behavior change. Existing
-- quotes read as having no additional charges. The feature only takes effect
-- once the updated quote editor / customer views are deployed.

alter table public.quotes
  add column if not exists additional_charges jsonb;

comment on column public.quotes.additional_charges is
  'Array of one-off named quote charges: [{id,label,amount,taxable}]. Taxable charges join the taxed base; non-taxable are added after tax. Added 2026-06-15.';
