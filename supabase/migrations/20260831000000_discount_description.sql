-- Optional free-text reason for a quote/invoice discount (e.g. "loyal
-- customer", "bulk order", "price match"). Display-only — does not touch
-- any pricing math. Nullable, no default; the app writes "" or a string.
-- Added to both quotes and invoices so the reason carries when a quote is
-- converted / synced.

-- quotes: set on the quote editor. orders: carried by buildOrderFromQuote.
-- invoices: carried by completeOrder (order→invoice) so the reason shows on
-- the invoice + its PDF.
ALTER TABLE public.quotes   ADD COLUMN IF NOT EXISTS discount_description TEXT;
ALTER TABLE public.orders   ADD COLUMN IF NOT EXISTS discount_description TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS discount_description TEXT;
