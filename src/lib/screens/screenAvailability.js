// Subtle screen-availability tracking. A screen-print shop owns a finite
// number of physical screens; each active (non-terminal) job ties some up
// until it's completed and the screens are reclaimed. This derives how many
// are free from the shop's stated total minus what live jobs commit — no
// manual per-burn upkeep. Feature is OFF unless the shop sets `screensOwned`.
//
// All pure so it's unit-testable; the caller supplies the orders + owned count.
import { calcSetupScreenCount } from "@/components/shared/pricing";
import { TERMINAL_ORDER_STATUSES } from "@/lib/orders/consolidateBlankNeeds";

/**
 * New screens a job's line items require. A reorder needs 0 (screens already
 * exist from the first run). Honors a manual `override` (the shop paired or
 * corrected the count) exactly as the setup-fee billing does.
 */
export function screensForLineItems(lineItems, { isReorder = false, override } = {}) {
  if (isReorder) return 0;
  if (Number.isInteger(override) && override >= 0) return override;
  return calcSetupScreenCount(lineItems);
}

/** Screens an order currently commits (0 once terminal — reclaimed). */
export function screensForOrder(order) {
  if (!order || TERMINAL_ORDER_STATUSES.has(order.status)) return 0;
  return screensForLineItems(order.line_items, {
    isReorder: !!order.is_reorder,
    override: order.setup_screens_override,
  });
}

/** New screens a quote-in-progress would burn (for the editor's heads-up). */
export function screensForQuote(quote) {
  if (!quote) return 0;
  return screensForLineItems(quote.line_items, {
    isReorder: !!quote.is_reorder,
    override: quote.setup_screens_override,
  });
}

/** Total screens tied up by all active (non-terminal) orders. */
export function committedScreens(orders) {
  return (Array.isArray(orders) ? orders : []).reduce((sum, o) => sum + screensForOrder(o), 0);
}

// Live quote-pipeline statuses = "upcoming jobs" not yet converted to orders.
// Draft (not real yet) and Declined (lost) are excluded; a won quote that's
// been converted carries "Converted to Order" and is counted as an order.
export const UPCOMING_QUOTE_STATUSES = new Set(["Sent", "Pending", "Approved", "Approved and Paid"]);

/**
 * Screens the upcoming pipeline would need — a forward "potentially needed"
 * tally from the color counts of prints on live (un-converted) quotes. A
 * reorder quote contributes 0 (its screens already exist).
 */
export function upcomingScreenDemand(quotes, statuses = UPCOMING_QUOTE_STATUSES) {
  return (Array.isArray(quotes) ? quotes : []).reduce(
    (sum, q) => sum + (statuses.has(q?.status) ? screensForQuote(q) : 0),
    0,
  );
}

const nonNegInt = (v) => Math.max(0, Math.round(Number(v) || 0));

/**
 * Normalize the shop's per-mesh screen inventory into clean rows plus rolled-up
 * totals. Each row: { mesh, total, coated } — how many screens of that mesh the
 * shop owns and how many are currently coated (emulsion applied, ready to burn).
 * Coated is clamped to never exceed total. Blank/garbage rows are dropped.
 * @returns {{byMesh:Array, owned:number, coated:number}}
 */
export function normalizeScreenInventory(inventory) {
  const byMesh = (Array.isArray(inventory) ? inventory : [])
    .map((r) => {
      const total = nonNegInt(r?.total);
      return { mesh: String(r?.mesh ?? "").trim(), total, coated: Math.min(total, nonNegInt(r?.coated)) };
    })
    .filter((r) => r.total > 0 || r.mesh);
  return {
    byMesh,
    owned: byMesh.reduce((s, r) => s + r.total, 0),
    coated: byMesh.reduce((s, r) => s + r.coated, 0),
  };
}

/**
 * Whole-shop availability snapshot. Prefers the detailed per-mesh `inventory`
 * (which also yields the coated count + mesh breakdown); falls back to the flat
 * `owned` number when no inventory rows are set.
 * @returns {{enabled:boolean, owned:number, committed:number, free:number,
 *            coated:number|null, byMesh:Array}}
 *   `enabled` is false (UI stays silent) unless owned > 0. `free` can go
 *   negative — the over-committed signal. `coated` is null when unknown (flat
 *   count only, no inventory).
 */
export function computeScreenAvailability({ orders, owned, inventory } = {}) {
  const inv = normalizeScreenInventory(inventory);
  const hasInventory = inv.byMesh.length > 0;
  const flat = Number(owned);
  const ownedTotal = hasInventory ? inv.owned : (Number.isInteger(flat) && flat > 0 ? flat : 0);
  const enabled = ownedTotal > 0;
  const committed = committedScreens(orders);
  return {
    enabled,
    owned: enabled ? ownedTotal : 0,
    committed,
    free: (enabled ? ownedTotal : 0) - committed,
    coated: hasInventory ? inv.coated : null,
    byMesh: inv.byMesh,
  };
}
