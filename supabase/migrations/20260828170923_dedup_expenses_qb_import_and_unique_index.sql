-- Dedup the QB expense import: the deleted pullExpenses feature (removed in
-- "Drop QB-replicating Performance reports", 2026-05-10) re-inserted the same
-- QB transactions on every trigger — its known-ids dedup lookup silently hit
-- PostgREST's default 1,000-row cap, so with ~1,804 QB transactions ~800
-- looked "new" on every run. ~20 triggers during tax season stacked 113,724
-- rows (~63 copies). Copies are identical per (shop_owner, qb_expense_id) —
-- keep the earliest. Pre-dedup snapshot: expenses_backup_prededup_20260828
-- (RLS enabled, no policies — service-role only).
delete from expenses
where id in (
  select id from (
    select id,
           row_number() over (
             partition by shop_owner, qb_expense_id
             order by created_at, id
           ) as rn
    from expenses
    where qb_expense_id is not null
  ) ranked
  where ranked.rn > 1
);

-- DB-level guarantee that a QB transaction can only land once per shop,
-- so any future import path is idempotent-by-construction (upsert target).
-- Partial: manual expenses (qb_expense_id is null) are unconstrained.
-- (Superseded by the next migration: converted to a FULL index so
-- PostgREST upserts can infer it as the conflict arbiter.)
create unique index if not exists expenses_shop_owner_qb_expense_id_uniq
  on expenses (shop_owner, qb_expense_id)
  where qb_expense_id is not null;
