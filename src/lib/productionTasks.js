// Per-shop production checklist tasks. Mirrors the pricing-config pattern:
// a module-level `_pt` variable is populated at auth time from
// `shops.production_tasks` JSONB, and read by ShopFloor + OrderDetailModal
// to render the per-stage checklist.
//
// Shops that haven't configured their own get DEFAULT_TASKS — the same
// list InkTracker has shipped historically.

export const PRODUCTION_STAGES = ["Art Approval", "Order Goods", "Pre-Press", "Printing"];

// Canonical task names that auto-check from per-size goods_progress,
// keyed by the stage they now live on. Ordering ("Place blank order")
// stays on Order Goods; receiving ("Receive goods") moved to Pre-Press
// (2026-09-28) so Order Goods purely means "still needs ordering" and
// it's obvious at a glance what's outstanding. If a shop renames or
// removes either, the auto-derive in autoCheckGoodsTask stops firing for
// it — these are the names we check against, and the Account UI warns.
export const AUTO_DERIVED_TASKS_BY_STAGE = {
  // Art Approval: set by the customer's sign-off / a sent proof, not by taps.
  "Art Approval": ["Send proof to customer", "Get approval"],
  "Order Goods": ["Place blank order"],
  "Pre-Press":   ["Receive goods"],
};

// Flattened list of every auto-derived task name across stages (used by
// callers that only care whether a name is auto-derived at all).
export const ORDER_GOODS_AUTO_DERIVED_TASKS = [
  ...AUTO_DERIVED_TASKS_BY_STAGE["Order Goods"],
  ...AUTO_DERIVED_TASKS_BY_STAGE["Pre-Press"],
];

// Return the auto-derived task names that are MISSING from the shop's
// current list for a given stage. Empty array means everything that
// should auto-check on this stage is still in place. Stages with no
// auto-derived tasks always return [].
export function getMissingAutoDerivedTasks(stage, taskList) {
  const expected = AUTO_DERIVED_TASKS_BY_STAGE[stage] || [];
  if (expected.length === 0) return [];
  const set = new Set(Array.isArray(taskList) ? taskList : []);
  return expected.filter((name) => !set.has(name));
}

// Default task list per production stage. Refreshed 2026-05-31 to
// match Joe's operator-tested checklist — trimmed from the original
// (which had a handful of less-used items like "Set up registration",
// "Mount screens on press", "Count pieces", "Color match (if needed)",
// "Flash/cure prints") to a leaner set that mirrors how Biota actually
// works the floor. Shops can still add anything they want per stage
// via Account → Production Tasks; defaults are just the starting
// point for new shops.
//
// "Art Approval" intentionally retains the original 4 items — they're
// the unchanged customer-facing approval loop.
export const DEFAULT_TASKS = {
  "Art Approval": ["Receive artwork", "Review file specs", "Send proof to customer", "Get approval"],
  // "Place blank order" auto-derives from per-size goods_progress (every
  // size at-least-ordered → done). "Receive goods" moved to Pre-Press
  // (below) so Order Goods is purely "order the blanks" — an order still
  // in this stage clearly needs ordering. Keep the canonical names so
  // auto-derive keeps working; a shop that renames them just ticks
  // manually.
  "Order Goods":  ["Place blank order"],
  // "Receive goods" leads Pre-Press: goods are received here (every size
  // received → done) before film/screens/ink prep.
  "Pre-Press":    ["Receive goods", "Output/Pull Film", "Burn screens", "Mix ink colors"],
  "Printing": [
    "Run test prints",
    "Get test approval",
    "Quality inspect",
    "Fold & tag",
    "Check quantities",
    "Bag/box order",
    "Stage for pickup/shipping",
  ],
};

// Module-level state populated by AuthContext on login. null = fall back
// to DEFAULT_TASKS (works on the public order/quote pages too where no
// shop config is loaded).
let _pt = null;

export function loadShopProductionTasks(config) {
  _pt = config && typeof config === "object" ? config : null;
}

// Return the list of tasks for a given stage, preferring shop config and
// falling back to defaults. Returns a fresh array each call so callers
// can safely sort/filter without mutating the source.
export function getStageTasks(stage) {
  const fromShop = _pt?.[stage];
  if (Array.isArray(fromShop) && fromShop.length > 0) {
    return fromShop.filter((t) => typeof t === "string" && t.trim().length > 0);
  }
  return [...(DEFAULT_TASKS[stage] || [])];
}

// Full map of stage → tasks, for the Account editor UI. Always returns
// every stage so the editor has a row for each, even if the shop hasn't
// customized one yet.
export function getAllStageTasks() {
  const out = {};
  for (const stage of PRODUCTION_STAGES) {
    out[stage] = getStageTasks(stage);
  }
  return out;
}
