-- Per-shop brand color. Drives the customer-facing wizard's primary
-- CTA, step indicators, and active highlights (Phase 1). Will extend
-- to /QuotePayment, /ArtApproval, the quote email, and the PDFs in
-- Phase 2 — single column powers all of them.
--
-- Stored as a hex string ("#0d9488", "#1a1a1a", etc.). NULL means
-- "use the default" (teal, which is also the app-wide accent today)
-- — existing shops get no visible change until they pick a color.
--
-- A CHECK constraint at the DB layer means we never persist garbage
-- like "tealish" or "red-600" that the frontend would have to defend
-- against everywhere it reads the value.

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS brand_color TEXT
    CHECK (brand_color IS NULL OR brand_color ~* '^#[0-9a-f]{6}$');

COMMENT ON COLUMN public.shops.brand_color IS
  'Hex color (e.g. "#0d9488") that drives the shop''s customer-facing surfaces. NULL falls back to the app default teal.';
