// Supplier-order idempotency helpers (audit INT-01 / INT-02). Guards
// ssPlaceOrder / acPlaceOrder against placing the SAME real-money order twice
// (double-click, network-timeout retry, two tabs).
//
// Flow per request, using the service-role `admin` client:
//   1. claimSupplierOrder() — atomically claim (shop_owner, idempotency_key).
//        owned        → we hold the claim; place the order, then finish*().
//        replay       → a prior attempt already SUCCEEDED; return its stored
//                       result, DO NOT place again.
//        inFlight     → another request is mid-placement; return 409.
//   2. finishSupplierOrder() — record 'succeeded' (+ response/order id) or
//        'failed' (releases the key so a genuine failure can be retried).
//
// FAIL CLOSED: if the idempotency infra itself errors (table missing, DB
// blip), claimSupplierOrder throws and the caller must refuse the order.
// Blocking one order is acceptable; double-charging a shop is not.
//
// The pure decision (decideIdempotencyAction) is unit-tested in
// __tests__/supplierIdempotency.test.js — the canonical behavior contract.

/**
 * Decide what to do given the EXISTING idempotency row found on a UNIQUE
 * conflict (i.e. our insert lost the race / the key was seen before).
 * @param {{status?: string}|null} existing
 * @returns {"replay"|"in_flight"|"reclaim"}
 *   replay   = a prior attempt succeeded; return its stored result.
 *   in_flight = another request is actively placing this order right now.
 *   reclaim  = the prior attempt failed (or row vanished); safe to retry.
 */
export function decideIdempotencyAction(existing, { nowMs, staleMs = STALE_IN_FLIGHT_MS } = {}) {
  const status = existing?.status;
  if (status === "succeeded") return "replay";
  if (status === "in_flight") {
    // STALE in_flight → reclaimable. A crash/timeout between claiming and
    // finishSupplierOrder used to leave the row in_flight FOREVER: every
    // retry answered 409 and the PO could never be submitted again (audit
    // 2026-10-02 M7). An edge invocation can't outlive minutes, so an
    // in_flight older than STALE_IN_FLIGHT_MS is a dead attempt, not a live
    // one. Reclaim is still guarded (status+age CAS in claimSupplierOrder),
    // and the retry is operator-driven — if the dead attempt might have
    // reached the supplier, the operator re-submits 10+ minutes later and
    // the supplier order history is the place to verify. Permanent lockout
    // was the worse failure. No updated_at on the row → can't tell age →
    // conservative in_flight.
    const updatedMs = Date.parse(existing?.updated_at ?? "");
    if (Number.isFinite(updatedMs) && Number.isFinite(nowMs ?? Date.now())) {
      const age = (nowMs ?? Date.now()) - updatedMs;
      if (age > staleMs) return "reclaim_stale";
    }
    return "in_flight";
  }
  return "reclaim"; // 'failed', unknown, or null → retryable
}

/** An in_flight claim older than this is a dead attempt (edge fns live seconds,
 * the supplier POST timeout is 30s). 10 minutes leaves a wide safety margin. */
export const STALE_IN_FLIGHT_MS = 10 * 60 * 1000;

const TABLE = "supplier_order_idempotency";

/**
 * Atomically claim (shop_owner, idempotency_key). See module docs for the
 * returned shapes. Throws on infra error (caller must fail closed).
 *
 * @param {any} admin  service-role supabase client
 * @param {{shopOwner: string, key: string, supplier?: string}} args
 * @returns {Promise<{owned: boolean, replay?: boolean, inFlight?: boolean,
 *   response?: any, supplierOrderId?: string|null}>}
 */
export async function claimSupplierOrder(admin, { shopOwner, key, supplier }) {
  if (!shopOwner || !key) {
    throw new Error("idempotency claim requires shopOwner + key");
  }

  // Insert our claim; if the key already exists, ON CONFLICT DO NOTHING means
  // no row comes back and we fall through to inspect the existing row.
  const { data: inserted, error: insErr } = await admin
    .from(TABLE)
    .upsert(
      { shop_owner: shopOwner, idempotency_key: key, supplier: supplier ?? null, status: "in_flight" },
      { onConflict: "shop_owner,idempotency_key", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  if (insErr) throw insErr; // fail closed
  if (inserted) return { owned: true };

  // Conflict: someone got there first. Inspect their row.
  const { data: existing, error: selErr } = await admin
    .from(TABLE)
    .select("status, response, supplier_order_id, updated_at")
    .eq("shop_owner", shopOwner)
    .eq("idempotency_key", key)
    .maybeSingle();
  if (selErr) throw selErr; // fail closed

  const action = decideIdempotencyAction(existing);
  if (action === "replay") {
    return {
      owned: false,
      replay: true,
      response: existing?.response ?? null,
      supplierOrderId: existing?.supplier_order_id ?? null,
    };
  }
  if (action === "in_flight") {
    return { owned: false, inFlight: true };
  }

  if (action === "reclaim_stale") {
    // Dead in_flight attempt (see decideIdempotencyAction). CAS on status AND
    // age so a genuinely live request (which would have touched updated_at
    // recently) can never be stolen.
    const cutoffIso = new Date(Date.now() - STALE_IN_FLIGHT_MS).toISOString();
    const { data: reclaimedStale, error: rsErr } = await admin
      .from(TABLE)
      .update({ status: "in_flight", supplier: supplier ?? null })
      .eq("shop_owner", shopOwner)
      .eq("idempotency_key", key)
      .eq("status", "in_flight")
      .lt("updated_at", cutoffIso)
      .select("id")
      .maybeSingle();
    if (rsErr) throw rsErr; // fail closed
    if (reclaimedStale) return { owned: true, reclaimedStale: true };
    return { owned: false, inFlight: true };
  }

  // reclaim: the prior attempt failed — flip it back to in_flight, but only if
  // it's STILL failed (guards against racing another retry).
  const { data: reclaimed, error: rcErr } = await admin
    .from(TABLE)
    .update({ status: "in_flight", supplier: supplier ?? null })
    .eq("shop_owner", shopOwner)
    .eq("idempotency_key", key)
    .eq("status", "failed")
    .select("id")
    .maybeSingle();
  if (rcErr) throw rcErr; // fail closed
  if (reclaimed) return { owned: true };

  // Lost the reclaim race → someone else is now in flight.
  return { owned: false, inFlight: true };
}

/**
 * Record the outcome of an order we owned the claim for.
 * @param {any} admin
 * @param {{shopOwner: string, key: string, success: boolean, response?: any,
 *   supplierOrderId?: string|null}} args
 */
export async function finishSupplierOrder(admin, { shopOwner, key, success, response, supplierOrderId }) {
  const patch = success
    ? { status: "succeeded", response: response ?? null, supplier_order_id: supplierOrderId ?? null }
    : { status: "failed", response: response ?? null };
  // Never throws (the order already happened or didn't), but NOT silent and
  // NOT single-shot: the old version neither read supabase-js's {error} (which
  // doesn't throw) nor retried, so a hiccupped outcome write left the row
  // in_flight — a successful REAL-MONEY order whose row then 409'd every
  // retry, with nothing in the logs (audit 2026-10-02 M7). Retry 3×, then log
  // CRITICAL with the supplier order id so the operator can reconcile.
  // Returns true when the outcome was recorded.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { error } = await admin.from(TABLE).update(patch).eq("shop_owner", shopOwner).eq("idempotency_key", key);
      if (!error) return true;
      console.error(`[supplierIdempotency] finish write attempt ${attempt + 1} failed:`, error.message);
    } catch (e) {
      console.error(`[supplierIdempotency] finish write attempt ${attempt + 1} threw:`, e?.message || e);
    }
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }
  console.error(
    `[supplierIdempotency] CRITICAL: could not record ${patch.status} for key ${key} (shop ${shopOwner}` +
    `${supplierOrderId ? `, supplier order ${supplierOrderId}` : ""}) — the claim stays in_flight and becomes ` +
    `stale-reclaimable after ${Math.round(STALE_IN_FLIGHT_MS / 60000)} minutes; verify against the supplier's order history.`
  );
  return false;
}
