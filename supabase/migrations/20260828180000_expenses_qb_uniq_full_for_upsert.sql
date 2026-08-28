-- Replace the partial unique index with a full one: PostgREST's
-- on_conflict upsert can only infer a non-partial arbiter index, and the
-- rebuilt pullExpenses action relies on ON CONFLICT DO NOTHING for its
-- idempotency. NULL qb_expense_id rows (manual expenses) remain
-- unconstrained — Postgres unique indexes treat NULLs as distinct.
drop index if exists expenses_shop_owner_qb_expense_id_uniq;
create unique index expenses_shop_owner_qb_expense_id_uniq
  on expenses (shop_owner, qb_expense_id);
