// Per-shop production checklist tasks. Mirrors the pricing-config pattern:
// a module-level `_pt` variable is populated at auth time from
// `shops.production_tasks` JSONB, and read by ShopFloor + OrderDetailModal
// to render the per-stage checklist.
//
// Shops that haven't configured their own get DEFAULT_TASKS — the same
// list InkTracker has shipped historically.

export const PRODUCTION_STAGES = ["Art Approval", "Order Goods", "Pre-Press", "Printing"];

// Canonical task names on the Order Goods stage that auto-check from
// per-size goods_progress. If a shop renames or removes either, the
// auto-derive in autoCheckOrderGoodsTask stops firing — these are the
// names we check against, and Account UI warns when they're missing.
export const ORDER_GOODS_AUTO_DERIVED_TASKS = [
  "Place blank order",
  "Receive goods",
];

// Return the auto-derived task names that are MISSING from the shop's
// current list for a given stage. Empty array means everything that
// should auto-check is still in place. Only Order Goods has auto-derived
// tasks today; other stages always return [].
export function getMissingAutoDerivedTasks(stage, taskList) {
  if (stage !== "Order Goods") return [];
  const set = new Set(Array.isArray(taskList) ? taskList : []);
  return ORDER_GOODS_AUTO_DERIVED_TASKS.filter((name) => !set.has(name));
}

export const DEFAULT_TASKS = {
  "Art Approval": ["Receive artwork", "Review file specs", "Send proof to customer", "Get approval"],
  // "Place blank order" + "Receive goods" auto-derive from per-size
  // goods_progress (every size at-least-ordered → blank order done;
  // every size received → receive goods done). If a shop renames or
  // removes these, the auto-derive won't fire — operators just check
  // them manually. Keep the canonical names to keep auto-derive working.
  "Order Goods":  ["Place blank order", "Receive goods"],
  "Pre-Press":    ["Burn screens", "Set up registration", "Mix ink colors", "Color match (if needed)"],
  "Printing": [
    "Mount screens on press",
    "Run test prints",
    "Get test approval",
    "Run full batch",
    "Flash/cure prints",
    "Quality inspect",
    "Fold & tag",
    "Count pieces",
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
