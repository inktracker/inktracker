-- Rename the inventory supplier-link columns to be vendor-agnostic.
--
-- They were added as norcal_* (20260914) but now hold ANY public-Shopify
-- vendor's linked product (NorCal, Ryonet, …), so the norcal_ prefix is
-- misleading. RENAME preserves all existing data (unlike drop/add). Idempotent
-- so it's safe on a DB that already has the new names.
--
-- Rollback: rename each supplier_* column back to its norcal_* name.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'inventory_items' AND column_name = 'norcal_variant_id') THEN
    ALTER TABLE public.inventory_items RENAME COLUMN norcal_variant_id TO supplier_variant_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'inventory_items' AND column_name = 'norcal_product_url') THEN
    ALTER TABLE public.inventory_items RENAME COLUMN norcal_product_url TO supplier_product_url;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'inventory_items' AND column_name = 'norcal_image_url') THEN
    ALTER TABLE public.inventory_items RENAME COLUMN norcal_image_url TO supplier_image_url;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'inventory_items' AND column_name = 'norcal_title') THEN
    ALTER TABLE public.inventory_items RENAME COLUMN norcal_title TO supplier_title;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'inventory_items' AND column_name = 'norcal_size') THEN
    ALTER TABLE public.inventory_items RENAME COLUMN norcal_size TO supplier_size;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'inventory_items' AND column_name = 'norcal_price') THEN
    ALTER TABLE public.inventory_items RENAME COLUMN norcal_price TO supplier_price;
  END IF;
END $$;
