-- qb_push_pending — Edit Order phase 2 (tier 3: orders whose invoice is
-- in QuickBooks).
--
-- When a tier-3 order edit updates the local invoice, local truth is
-- NEWER than QuickBooks — the exact opposite of the "Modified in
-- QuickBooks → Match" flow, whose banner would tell the shop to revert
-- their own fresh edit. This flag records the direction: local changes
-- are awaiting a push. Set by the order editor's save; cleared by
-- qbSync's write-back after a successful push (the resync/update path).
-- While set, the invoice modal shows "Push update to QuickBooks" and
-- suppresses the Match banner; the order modal shows a "QB out of date"
-- badge.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS qb_push_pending boolean;

COMMENT ON COLUMN public.invoices.qb_push_pending IS
  'Local invoice edited after its QB invoice was created; a push to QuickBooks is pending. Set by the order editor, cleared by qbSync write-back. Suppresses the Match-to-QuickBooks banner (direction conflict).';
