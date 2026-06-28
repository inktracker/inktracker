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
export function decideIdempotencyAction(existing) {
  const status = existing?.status;
  if (status === "succeeded") return "replay";
  if (status === "in_flight") return "in_flight";
  return "reclaim"; // 'failed', unknown, or null → retryable
}

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
    .select("status, response, supplier_order_id")
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
  // Best-effort: the order already happened (or didn't); never throw out of
  // the success path just because the bookkeeping write hiccupped.
  try {
    await admin.from(TABLE).update(patch).eq("shop_owner", shopOwner).eq("idempotency_key", key);
  } catch (_e) {
    // swallow — surfaced via logs by the caller if needed
  }
}
