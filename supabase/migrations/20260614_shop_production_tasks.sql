-- Per-shop production checklist tasks.
--
-- ShopFloor + OrderDetailModal render a per-stage checklist for active
-- jobs (Art Approval / Order Goods / Pre-Press / Printing). Until now
-- that list was a module-level constant in the frontend — every shop
-- saw the same default tasks with no way to add their own.
--
-- This column stores the shop's per-stage overrides as JSONB:
--
--   {
--     "Art Approval": ["Receive artwork", "Review specs", ...],
--     "Pre-Press":    ["Burn screens", "Mix ink", ...],
--     ...
--   }
--
-- Frontend reads via src/lib/productionTasks.js — falls back to the
-- shipped DEFAULT_TASKS list when a stage isn't customized, so shops
-- can opt-in incrementally.
--
-- Default `{}` so existing shops aren't suddenly customized; the empty
-- map signals "use shipped defaults everywhere".

alter table shops
  add column if not exists production_tasks jsonb not null default '{}'::jsonb;

comment on column shops.production_tasks is
  'Per-stage production checklist tasks as { stage: string[] }. Empty/missing keys fall back to DEFAULT_TASKS in src/lib/productionTasks.js.';
