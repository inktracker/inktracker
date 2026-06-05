// QuickBooks idempotency wrapper.
//
// Contract:
//   withQbIdempotency(supabase, key, ctx, fn) → fn's result
//
// Behavior:
//   - First caller with a given key: INSERTs 'in_flight' row, runs
//     fn(), UPDATEs row to 'completed' with the result, returns the
//     result.
//   - Subsequent caller with the SAME key (within 5 min TTL):
//       - if the first call has finished (status='completed'): returns
//         the cached result. No duplicate QB write.
//       - if the first call is still 'in_flight': returns the
//         in-flight signal so the caller can surface "already
//         processing, please wait" instead of firing a second write.
//       - if the first call 'failed': also returns the cached failure
//         so the second caller doesn't blindly retry a bad call.
//         (The caller can choose to mint a new key to actually retry.)
//   - No key (key is null/empty): just runs fn() with no caching.
//     The frontend should always mint a key for write operations,
//     but the wrapper degrades gracefully if it doesn't.
//
// Why a separate table instead of conditioning on quote.qb_invoice_id:
//   - The race we're fixing is two parallel requests, neither of
//     which has written qb_invoice_id yet. They both pass the "no
//     existing invoice" check and both create. An idempotency table
//     with a unique PRIMARY KEY constraint is the only way to make
//     this safe under concurrent writes — Postgres serializes the
//     insert, the loser sees the conflict, the loser waits / reads
//     the winner's result.
//
// TTL: 5 minutes. Long enough to cover frontend retries (Vercel
// function timeout is 60s, even a chain of retries fits) and short
// enough that a stale key from a previous edit session doesn't block
// a legitimate new attempt.

const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;

export const IDEMPOTENCY_OUTCOMES = Object.freeze({
  EXECUTED:   "executed",   // we ran fn() and stored the result
  CACHED:     "cached",     // we returned a prior completed result
  IN_FLIGHT:  "in_flight",  // someone else is mid-flight, we did NOT run fn()
});

/**
 * @typedef {Object} IdempotencyContext
 * @property {string} shop_owner   Required.
 * @property {string} action       Required. Same as qb_event_log.action.
 */

/**
 * @typedef {Object} IdempotencyResult
 * @property {string} outcome           One of IDEMPOTENCY_OUTCOMES.
 * @property {any}    result            fn's result (executed/cached) OR null (in_flight).
 * @property {boolean} fromCache        Convenience: outcome === 'cached'.
 * @property {boolean} inFlight         Convenience: outcome === 'in_flight'.
 */

/**
 * Run fn() under idempotency protection keyed by `key`.
 *
 * @param {object} supabase                  service-role client
 * @param {string|null} key                  idempotency key from caller
 * @param {IdempotencyContext} ctx
 * @param {() => Promise<any>} fn
 * @returns {Promise<IdempotencyResult>}
 */
export async function withQbIdempotency(supabase, key, ctx, fn) {
  if (!key) {
    const result = await fn();
    return { outcome: IDEMPOTENCY_OUTCOMES.EXECUTED, result, fromCache: false, inFlight: false };
  }
  if (!ctx?.shop_owner || !ctx?.action) {
    throw new Error("withQbIdempotency: ctx.shop_owner and ctx.action are required");
  }

  const claim = await tryClaimKey(supabase, key, ctx);

  if (claim.outcome === IDEMPOTENCY_OUTCOMES.CACHED) {
    return {
      outcome:  IDEMPOTENCY_OUTCOMES.CACHED,
      result:   claim.cachedResult,
      fromCache: true,
      inFlight: false,
    };
  }
  if (claim.outcome === IDEMPOTENCY_OUTCOMES.IN_FLIGHT) {
    return {
      outcome:  IDEMPOTENCY_OUTCOMES.IN_FLIGHT,
      result:   null,
      fromCache: false,
      inFlight: true,
    };
  }

  // We won the claim. Run fn(); persist result regardless of outcome.
  try {
    const result = await fn();
    await persistCompletion(supabase, key, "completed", result, null);
    return { outcome: IDEMPOTENCY_OUTCOMES.EXECUTED, result, fromCache: false, inFlight: false };
  } catch (err) {
    await persistCompletion(supabase, key, "failed", null, err?.message || String(err));
    throw err;
  }
}

// ── Internals ─────────────────────────────────────────────────────────

/**
 * @returns {Promise<{outcome: string, cachedResult?: any}>}
 *   outcome: EXECUTED (we won; caller should run fn) |
 *            CACHED   (return cachedResult) |
 *            IN_FLIGHT(someone else is running it)
 */
async function tryClaimKey(supabase, key, ctx) {
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();

  const { error } = await supabase
    .from("qb_idempotency")
    .insert({
      key,
      shop_owner: ctx.shop_owner,
      action:     ctx.action,
      status:     "in_flight",
      result:     null,
      expires_at: expiresAt,
    });

  if (!error) {
    // We claimed it cleanly.
    return { outcome: IDEMPOTENCY_OUTCOMES.EXECUTED };
  }

  // Unique-violation = key already exists. Read the existing row to
  // decide whether to return cached, signal in-flight, or treat the
  // existing row as expired and overwrite.
  if (error.code !== "23505") {
    // Unexpected DB error. Don't block the write — degrade gracefully
    // to no-caching. The caller's QB call still runs.
    console.error("[qbIdempotency] claim insert failed:", error.message);
    return { outcome: IDEMPOTENCY_OUTCOMES.EXECUTED };
  }

  const existing = await readExisting(supabase, key);
  if (!existing) {
    // Conflict but row not visible — extremely unlikely. Treat as cleared.
    return { outcome: IDEMPOTENCY_OUTCOMES.EXECUTED };
  }

  // Expired in-flight rows are stale (the original caller crashed
  // before persisting). Conditionally REPLACE the row only if it's
  // still in the same expired state — without the predicates two
  // concurrent retries could both pass the JS check and both update,
  // both proceed to call QB, both create. The `.eq + .lt` predicates
  // collapse the race because Postgres serializes the WHERE-bound
  // update. Whichever caller wins the update gets count=1; the loser
  // sees count=0 and waits as in-flight.
  if (existing.status === "in_flight" && existing.expires_at && new Date(existing.expires_at).getTime() < Date.now()) {
    const nowIso = new Date().toISOString();
    const { error: updErr, count } = await supabase
      .from("qb_idempotency")
      .update(
        { status: "in_flight", expires_at: expiresAt, result: null, error_message: null },
        { count: "exact" },
      )
      .eq("key", key)
      .eq("status", "in_flight")
      .lt("expires_at", nowIso);
    if (updErr) {
      console.error("[qbIdempotency] stale-row reclaim update failed:", updErr.message);
      return { outcome: IDEMPOTENCY_OUTCOMES.EXECUTED };
    }
    if ((count ?? 0) > 0) return { outcome: IDEMPOTENCY_OUTCOMES.EXECUTED };
    // Lost the race — another retry got there first. Signal in-flight
    // so the caller doesn't fire its own QB write.
    return { outcome: IDEMPOTENCY_OUTCOMES.IN_FLIGHT };
  }

  if (existing.status === "in_flight") {
    return { outcome: IDEMPOTENCY_OUTCOMES.IN_FLIGHT };
  }

  // completed OR failed — return the cached outcome. Either way, the
  // second caller doesn't fire a duplicate write.
  return { outcome: IDEMPOTENCY_OUTCOMES.CACHED, cachedResult: existing.result };
}

async function readExisting(supabase, key) {
  const { data, error } = await supabase
    .from("qb_idempotency")
    .select("status, result, expires_at, error_message")
    .eq("key", key)
    .maybeSingle();
  if (error) {
    console.error("[qbIdempotency] readExisting failed:", error.message);
    return null;
  }
  return data || null;
}

async function persistCompletion(supabase, key, status, result, errorMessage) {
  try {
    const { error } = await supabase
      .from("qb_idempotency")
      .update({
        status,
        result:        status === "completed" ? sanitizeResult(result) : null,
        error_message: errorMessage,
        completed_at:  new Date().toISOString(),
      })
      .eq("key", key);
    if (error) console.error("[qbIdempotency] persistCompletion failed:", error.message);
  } catch (err) {
    console.error("[qbIdempotency] persistCompletion threw:", err?.message || err);
  }
}

// jsonb column won't accept undefined; coerce. Also bound the payload
// since the cache is meant to hand back small contract-shaped results
// (qbInvoiceId, paymentLink, etc.) — not full QB invoice bodies.
const MAX_CACHED_BYTES = 8 * 1024;
function sanitizeResult(value) {
  if (value === null || value === undefined) return null;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_CACHED_BYTES) {
      console.error(`[qbIdempotency] result exceeded ${MAX_CACHED_BYTES} bytes — caching summary only`);
      return { __truncated: true, __original_size: serialized.length };
    }
    return value;
  } catch {
    return null;
  }
}

export { IDEMPOTENCY_TTL_MS };
