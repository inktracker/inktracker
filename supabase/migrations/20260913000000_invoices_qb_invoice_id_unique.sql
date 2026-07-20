-- One InkTracker invoice row per QB invoice, as a DB invariant.
--
-- Background (tester note 2026-07-18 → PR #653): the "same QB invoice
-- as two rows" class — an order-born INV-... row and a pulled Q-...
-- row sharing one qb_invoice_id — was only guarded in application
-- code. The two existing partial unique indexes key on invoice_id and
-- order_id, and the duplicate pair differs on invoice_id while one
-- side's order_id is NULL, so neither fired. PR #653 closed the write
-- path (completion now stamps qb_invoice_id so the pull adopts); this
-- index is the backstop that makes recurrence impossible.
--
-- Scoped to (shop_owner, qb_invoice_id): QB invoice ids are per-realm,
-- and distinct shops can share a realm (the 2026-07 outlier audit's
-- shared-realm scenario), so a global unique on qb_invoice_id would be
-- wrong. -rN revision invoices carry their own QB ids, so revisions
-- don't collide.
--
-- SELF-GUARDING: if prod already contains duplicates (pre-#653 rows),
-- CREATE UNIQUE INDEX would abort — and a failed migration blocks the
-- whole deploy chain. So this migration checks first and SKIPS with a
-- loud NOTICE instead of failing. Run
--   ./scripts/with-secrets.sh node scripts/scan-qb-invoice-dups.mjs
-- to list the duplicates, repair them, then re-run this migration (or
-- execute the CREATE UNIQUE INDEX below by hand). Until then the
-- application-level guards from #653 remain the protection.

DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT count(*) INTO dup_count
  FROM (
    SELECT shop_owner, qb_invoice_id
    FROM public.invoices
    WHERE qb_invoice_id IS NOT NULL AND qb_invoice_id <> ''
    GROUP BY shop_owner, qb_invoice_id
    HAVING count(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE NOTICE 'invoices_qb_invoice_id_unique SKIPPED: % duplicate (shop_owner, qb_invoice_id) group(s) exist. Run scripts/scan-qb-invoice-dups.mjs, repair, then re-run this migration.', dup_count;
    RETURN;
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS invoices_shop_qb_invoice_id_key
    ON public.invoices (shop_owner, qb_invoice_id)
    WHERE qb_invoice_id IS NOT NULL AND qb_invoice_id <> '';
  RAISE NOTICE 'invoices_qb_invoice_id_unique: index created.';
END $$;
