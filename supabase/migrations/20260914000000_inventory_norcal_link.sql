-- NorCal supplier linkage on inventory items (NorCal integration — Slice 1).
--
-- NorCal Screen Print Supply runs on Shopify (norcalsps.com). A shop can link
-- one of its supplies to a specific NorCal product VARIANT so the app can show
-- the live NorCal price/image and (Slice 2) build a one-click pre-filled NorCal
-- cart permalink from the shop's low-stock list.
--
-- All columns are nullable and additive — an unlinked item behaves exactly as
-- before. Shopify variant ids are large integers; stored as text to avoid any
-- precision/round-trip concerns through JSON.
--
-- No RLS change needed: inventory_items is already shop_owner-scoped and these
-- columns inherit that policy.
--
-- Rollback: ALTER TABLE public.inventory_items DROP COLUMN norcal_variant_id,
--   norcal_product_url, norcal_image_url, norcal_title, norcal_size, norcal_price;

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS norcal_variant_id  text,
  ADD COLUMN IF NOT EXISTS norcal_product_url text,
  ADD COLUMN IF NOT EXISTS norcal_image_url   text,
  ADD COLUMN IF NOT EXISTS norcal_title       text,
  ADD COLUMN IF NOT EXISTS norcal_size        text,
  ADD COLUMN IF NOT EXISTS norcal_price       numeric;
