-- The QB invoice has TWO identifiers we care about:
--   1. Invoice.Id        — internal QBO record id (e.g. "3685"). Used in
--                          QB API calls. Stored as `qb_invoice_id`.
--   2. Invoice.DocNumber — the human-facing invoice number that QB shows
--                          in its UI and on the customer-facing email
--                          (e.g. "Q-2026-V0TN"). Operators navigate by
--                          THIS, not the internal id.
--
-- Until now we only persisted the internal id, so the InkTracker "Send"
-- modal showed "#3685" while the matching record in QB displayed as
-- "Q-2026-V0TN". Operators couldn't reconcile the two without opening
-- both windows. Save the DocNumber alongside the id so the UI can show
-- the human-friendly number everywhere.
--
-- Both `quotes` and `invoices` carry the QB linkage (quotes for the
-- "Send Quote" flow that mints an invoice, invoices for the standalone
-- Invoice → QB flow), so both tables get the column.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS qb_doc_number TEXT;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS qb_doc_number TEXT;

COMMENT ON COLUMN public.quotes.qb_doc_number IS
  'Human-facing QB invoice number (DocNumber) — e.g. "Q-2026-V0TN". Distinct from qb_invoice_id (the internal QBO record id).';
COMMENT ON COLUMN public.invoices.qb_doc_number IS
  'Human-facing QB invoice number (DocNumber). Distinct from qb_invoice_id.';
