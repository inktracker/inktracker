// Pair detection for QuickBooks-side merges that still need finishing
// in InkTracker.
//
// Context: a QB-side customer merge consolidates QB records, but
// InkTracker's local `customers` table doesn't know about it. The
// shop ends up with TWO local records (one pointing at a now-inactive
// QB customer, one pointing at the active survivor) and their local
// quotes / orders / notes / saved_imprints stay split between them.
//
// This module pairs each inactive-side local record with the
// corresponding survivor local record (when one exists) so the
// Customers page can surface a banner and offer to finish the merge
// without the operator having to remember to reconcile.
//
// Pure functions only. No fetch, no React. The QB call that produces
// the input `inactiveQbRecords` lives in qbSync (`scanInactiveCustomers`).

/**
 * @typedef {Object} LocalCustomer
 * @property {string|number} id
 * @property {string} [name]
 * @property {string} [company]
 * @property {string} [qb_customer_id]
 *
 * @typedef {Object} InactiveQbRecord
 * @property {string} qb_customer_id   The Id of the customer that's now Active=false in QB
 * @property {string} [displayName]    QB's DisplayName (for banner copy)
 * @property {string|null} [mergedIntoId]  The Id QB points to as the survivor
 *
 * @typedef {Object} ReconcilePair
 * @property {LocalCustomer} inactive       The local record linked to the inactive QB customer
 * @property {LocalCustomer|null} survivor  The local record linked to the survivor in QB (null if not in InkTracker yet)
 * @property {string|null} mergedIntoId     The QB ID the inactive one was merged into
 * @property {string|null} qbDisplayName    QB's DisplayName for the inactive record (banner copy)
 */

/**
 * Pair each QB-inactive record with the local InkTracker records that
 * are affected:
 *
 *   - `inactive`  → the local row whose qb_customer_id matches the
 *                   inactive QB record's Id (always present — we only
 *                   surface pairs where we have local data to merge)
 *   - `survivor`  → the local row whose qb_customer_id matches the
 *                   inactive record's MergedIntoId (may be null when
 *                   the QB survivor was added after our last pull)
 *
 * @param {LocalCustomer[]} customers
 * @param {InactiveQbRecord[]} inactiveQbRecords
 * @returns {ReconcilePair[]}
 */
export function findReconcileNeeded(customers, inactiveQbRecords) {
  if (!Array.isArray(customers) || !Array.isArray(inactiveQbRecords)) return [];

  // Index local rows by qb_customer_id (string-keyed, since QB ships
  // numeric IDs as strings sometimes and as numbers others).
  const byQbId = new Map();
  for (const c of customers) {
    if (c && c.qb_customer_id != null && String(c.qb_customer_id) !== "") {
      byQbId.set(String(c.qb_customer_id), c);
    }
  }

  const pairs = [];
  const seenInactiveIds = new Set();
  for (const r of inactiveQbRecords) {
    if (!r || r.qb_customer_id == null) continue;
    const inactiveQbId = String(r.qb_customer_id);
    if (seenInactiveIds.has(inactiveQbId)) continue;
    seenInactiveIds.add(inactiveQbId);

    const inactiveLocal = byQbId.get(inactiveQbId);
    if (!inactiveLocal) continue; // no local data to reconcile

    const mergedIntoId = r.mergedIntoId != null ? String(r.mergedIntoId) : null;
    const survivorLocal = mergedIntoId ? (byQbId.get(mergedIntoId) || null) : null;

    pairs.push({
      inactive: inactiveLocal,
      survivor: survivorLocal,
      mergedIntoId,
      qbDisplayName: r.displayName || null,
    });
  }
  return pairs;
}

/**
 * Split detected pairs into the two categories the UI needs to render
 * differently:
 *
 *   - `actionable` — both inactive AND survivor have local InkTracker
 *                    records. One-click reconcile possible.
 *   - `survivorMissing` — only the inactive has a local record. The
 *                    QB survivor isn't in our DB yet; operator needs
 *                    to pull customers from QB first (or it was added
 *                    in QB after our last sync).
 *
 * @param {ReconcilePair[]} pairs
 * @returns {{actionable: ReconcilePair[], survivorMissing: ReconcilePair[]}}
 */
export function partitionReconcilePairs(pairs) {
  const actionable = [];
  const survivorMissing = [];
  for (const p of pairs || []) {
    if (p && p.survivor) actionable.push(p);
    else if (p) survivorMissing.push(p);
  }
  return { actionable, survivorMissing };
}

/**
 * Turn detected pairs into the auto-follow execution plan (policy
 * confirmed by Joe 2026-06-11: a QB-side merge is a decision the shop
 * already made — InkTracker mirrors it automatically with an
 * after-the-fact notification; only SUSPECTED duplicates still require
 * confirmation).
 *
 *   - merges   — survivor exists locally → run the safe local merge
 *   - repoints — survivor known in QB but absent locally → update the
 *                inactive-side record's qb_customer_id to the survivor
 *                (the exact manual fix from the Choo Choo's incident)
 *   - review   — inactive with NO MergedIntoId (deactivated, not
 *                merged) → can't infer intent; surface for the shop
 *
 * @param {ReconcilePair[]} pairs
 * @returns {{merges: ReconcilePair[], repoints: ReconcilePair[], review: ReconcilePair[]}}
 */
export function planReconcileActions(pairs) {
  const merges = [];
  const repoints = [];
  const review = [];
  for (const p of pairs || []) {
    if (!p || !p.inactive) continue;
    if (p.survivor) merges.push(p);
    else if (p.mergedIntoId) repoints.push(p);
    else review.push(p);
  }
  return { merges, repoints, review };
}
