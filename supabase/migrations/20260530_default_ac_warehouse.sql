-- Per-shop default AS Colour warehouse. Auto-routing on item add uses
-- this as the preferred warehouse; falls back to the other warehouse
-- when the default is out of stock.
--
-- 'CA' (Carson) is the most common default — west-coast warehouse,
-- generally larger stockholding. Shops on the east coast set 'NC'.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_ac_warehouse TEXT DEFAULT 'CA';
