// QuickBooks event audit log.
//
// Every QB interaction (outbound write, outbound read, inbound webhook,
// reconcile pass) writes one row to qb_event_log. The log becomes the
// answer to "what happened to this quote in QB?" — operators see the
// timeline in the QuoteDetailModal "QB Events" tab.
//
// Three-phase model:
//   1. logEventStarted    — write a 'started' row BEFORE calling QB.
//      The row carries the request body + idempotency key. If the
//      function crashes mid-flight, the 'started' row stays in the log
//      forever and surfaces "this attempt never completed" to the
//      operator. (Without this, a mid-flight crash leaves zero trace.)
//   2. logEventCompleted  — UPDATE the started row with status +
//      response_body + duration_ms.
//   3. logEvent            — convenience for events that have no
//      "before" phase (e.g. inbound webhooks where we receive the
//      event in one piece and process it synchronously).
//
// Best-effort semantics: a failure to write the log NEVER causes the
// caller's QB operation to fail. We log to console.error and move on.
// The audit log is observability, not correctness — the caller's
// own success/failure path is what the user sees.

/**
 * @typedef {Object} EventContext
 * @property {string}  shop_owner       Required. Tenant scope.
 * @property {string}  action           Required. Logical operation name.
 * @property {string}  [quote_id]       UUID from quotes.id, if any.
 * @property {string}  [invoice_id]     UUID from invoices.id, if any.
 * @property {string}  [qb_invoice_id]  QB realm-scoped invoice id.
 * @property {string}  [qb_customer_id] QB realm-scoped customer id.
 * @property {string}  [direction]      'outbound' (default) | 'inbound'.
 * @property {string}  [idempotency_key]
 * @property {object}  [request_body]   What we sent / what QB sent us.
 */

/**
 * Write a 'started' row to qb_event_log. Returns the inserted row's
 * id so the caller can pass it to logEventCompleted, or null if the
 * write failed (caller continues — best-effort).
 *
 * @param {object} supabase   service-role client
 * @param {EventContext} ctx
 * @returns {Promise<string|null>}  qb_event_log.id, or null on failure
 */
export async function logEventStarted(supabase, ctx) {
  if (!ctx?.shop_owner || !ctx?.action) {
    console.error("[qbAudit] logEventStarted: missing shop_owner or action", ctx);
    return null;
  }
  try {
    const row = buildStartedRow(ctx);
    const { data, error } = await supabase
      .from("qb_event_log")
      .insert(row)
      .select("id")
      .single();
    if (error) {
      console.error("[qbAudit] logEventStarted failed:", error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.error("[qbAudit] logEventStarted threw:", err?.message || err);
    return null;
  }
}

/**
 * @typedef {Object} CompletionUpdate
 * @property {'success'|'error'|'skipped'|'duplicate'} status
 * @property {object} [response_body]
 * @property {string} [error_message]
 * @property {string} [qb_invoice_id]   May only be known after the call returns.
 * @property {string} [qb_customer_id]
 * @property {number} [duration_ms]
 */

/**
 * Update the 'started' row with the call's outcome. No-op (logged) if
 * eventId is null — caller didn't need to know whether the started
 * write succeeded.
 *
 * @param {object} supabase
 * @param {string|null} eventId
 * @param {CompletionUpdate} update
 */
export async function logEventCompleted(supabase, eventId, update) {
  if (!eventId) return;
  if (!update?.status) {
    console.error("[qbAudit] logEventCompleted: missing status");
    return;
  }
  try {
    const patch = buildCompletionPatch(update);
    const { error } = await supabase
      .from("qb_event_log")
      .update(patch)
      .eq("id", eventId);
    if (error) console.error("[qbAudit] logEventCompleted failed:", error.message);
  } catch (err) {
    console.error("[qbAudit] logEventCompleted threw:", err?.message || err);
  }
}

/**
 * One-shot event log — no started/completed phases. For inbound
 * webhooks and other already-resolved events.
 *
 * @param {object} supabase
 * @param {EventContext & CompletionUpdate} ctx
 */
export async function logEvent(supabase, ctx) {
  if (!ctx?.shop_owner || !ctx?.action || !ctx?.status) {
    console.error("[qbAudit] logEvent: missing shop_owner / action / status", ctx);
    return;
  }
  try {
    const row = buildOneShotRow(ctx);
    const { error } = await supabase.from("qb_event_log").insert(row);
    if (error) console.error("[qbAudit] logEvent failed:", error.message);
  } catch (err) {
    console.error("[qbAudit] logEvent threw:", err?.message || err);
  }
}

/**
 * Wrap a QB operation with full audit lifecycle. Writes a started row,
 * runs fn(), writes the completion row, and re-throws on error so the
 * caller still sees the failure. The completion row's response_body
 * is whatever fn() returned (or, on failure, null + error_message).
 *
 * @param {object} supabase
 * @param {EventContext} ctx
 * @param {() => Promise<any>} fn
 * @returns {Promise<any>}  whatever fn returned
 */
export async function withQbAudit(supabase, ctx, fn) {
  const startedAt = Date.now();
  const eventId = await logEventStarted(supabase, ctx);
  try {
    const result = await fn();
    await logEventCompleted(supabase, eventId, {
      status: "success",
      response_body: redactForAudit(result),
      qb_invoice_id: result?.qbInvoiceId || ctx.qb_invoice_id,
      qb_customer_id: result?.qbCustomerId || result?.customerRef || ctx.qb_customer_id,
      duration_ms: Date.now() - startedAt,
    });
    return result;
  } catch (err) {
    await logEventCompleted(supabase, eventId, {
      status: "error",
      error_message: err?.message || String(err),
      duration_ms: Date.now() - startedAt,
    });
    throw err;
  }
}

// ── Pure builders (tested via vitest, no Supabase needed) ─────────────

export function buildStartedRow(ctx) {
  return {
    shop_owner:       ctx.shop_owner,
    quote_id:         ctx.quote_id        ?? null,
    invoice_id:       ctx.invoice_id      ?? null,
    qb_invoice_id:    ctx.qb_invoice_id   ?? null,
    qb_customer_id:   ctx.qb_customer_id  ?? null,
    action:           ctx.action,
    direction:        ctx.direction       ?? "outbound",
    status:           "started",
    request_body:     redactForAudit(ctx.request_body),
    idempotency_key:  ctx.idempotency_key ?? null,
  };
}

export function buildCompletionPatch(update) {
  return {
    status:         update.status,
    response_body:  redactForAudit(update.response_body),
    error_message:  update.error_message ?? null,
    qb_invoice_id:  update.qb_invoice_id  ?? undefined,
    qb_customer_id: update.qb_customer_id ?? undefined,
    duration_ms:    update.duration_ms    ?? null,
  };
}

export function buildOneShotRow(ctx) {
  return {
    shop_owner:       ctx.shop_owner,
    quote_id:         ctx.quote_id        ?? null,
    invoice_id:       ctx.invoice_id      ?? null,
    qb_invoice_id:    ctx.qb_invoice_id   ?? null,
    qb_customer_id:   ctx.qb_customer_id  ?? null,
    action:           ctx.action,
    direction:        ctx.direction       ?? "inbound",
    status:           ctx.status,
    request_body:     redactForAudit(ctx.request_body),
    response_body:    redactForAudit(ctx.response_body),
    error_message:    ctx.error_message   ?? null,
    idempotency_key:  ctx.idempotency_key ?? null,
    duration_ms:      ctx.duration_ms     ?? null,
  };
}

// Cap audit payloads so a runaway QB response doesn't blow up the
// table. 32 KB serialized is enough for any single invoice; anything
// larger is almost certainly a paginated pull response we shouldn't
// be logging in full. Truncated payloads carry a marker so the
// operator knows they're seeing a tail-cut version.
const MAX_AUDIT_BYTES = 32 * 1024;

export function redactForAudit(value) {
  if (value === null || value === undefined) return null;
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { __unserializable: true };
  }
  if (serialized.length <= MAX_AUDIT_BYTES) return value;
  return {
    __truncated:    true,
    __original_size: serialized.length,
    preview:        serialized.slice(0, MAX_AUDIT_BYTES),
  };
}
