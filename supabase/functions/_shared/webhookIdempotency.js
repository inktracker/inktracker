// Webhook idempotency guard. Imported by stripeWebhook, qbWebhook,
// billingWebhook so all three share one tested implementation.
//
// Contract:
//   - claimWebhookEvent(supabase, source, eventId) tries to INSERT
//     into processed_webhook_events. Returns true if this is the
//     first time we've seen the event, false if it's a duplicate
//     (Stripe retry, etc).
//   - Caller MUST check the return value and short-circuit on false.
//
// Why an INSERT-with-conflict-detection instead of SELECT-then-INSERT:
//   - SELECT-then-INSERT has a TOCTOU race. Two webhook handlers
//     invoked concurrently would both see "not present", both
//     insert, both run side effects. The duplicate row would crash
//     on the second insert, but only AFTER both ran the email +
//     QB-record side effects.
//   - INSERT...ON CONFLICT DO NOTHING is atomic. Postgres serializes.
//     If the conflict fires, the side effects don't run. Safe under
//     concurrent retry.
//
// The PURE helpers below extract event IDs from each provider's
// payload shape. Wrapped this way because the DB call is the only
// non-deterministic part — extraction is testable.

// ── Pure: extract a dedup key from each provider's webhook event ────

/**
 * Stripe events always have `event.id` (evt_...). Strip the prefix —
 * defensive only; we don't actually rely on the format.
 */
export function extractStripeEventId(event) {
  const id = event?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * QB Webhook payload shape:
 *   { eventNotifications: [{ realmId, dataChangeEvent: { entities: [...] }}] }
 * QB does NOT give us a per-event ID. We synthesize one from the
 * realmId + sorted concat of (entity.name, entity.id, entity.lastUpdated)
 * — uniqueness comes from the lastUpdated timestamp, which QB
 * promises is monotonic per entity.
 *
 * This is a heuristic. If QB ever delivers the same payload twice
 * (same lastUpdated across entities), we'd over-dedup. Acceptable
 * risk — losing a duplicate event is better than processing one
 * twice, and webhook handlers reconcile to a steady state on every
 * call anyway.
 */
export function extractQbEventId(payload) {
  const notifications = payload?.eventNotifications;
  if (!Array.isArray(notifications) || notifications.length === 0) return null;
  const parts = [];
  for (const note of notifications) {
    if (!note?.realmId) continue;
    parts.push(`r:${note.realmId}`);
    const entities = note?.dataChangeEvent?.entities || [];
    for (const ent of entities) {
      if (!ent) continue;
      parts.push(`${ent.name || ""}:${ent.id || ""}:${ent.lastUpdated || ""}`);
    }
  }
  if (parts.length === 0) return null;
  // Stable sort so equivalent payloads produce the same id even if
  // entities arrive in different orders.
  parts.sort();
  return parts.join("|");
}

/**
 * Billing webhook is a Stripe webhook (subscriptions, customers, etc.)
 * so it uses the same shape as the main Stripe webhook.
 */
export function extractBillingEventId(event) {
  return extractStripeEventId(event);
}

// ── DB: atomic dedup INSERT ─────────────────────────────────────────

/**
 * Discriminated outcomes returned by `claimWebhookEventDetailed`.
 *   - first      → atomic INSERT succeeded; caller should process
 *   - duplicate  → unique-violation (23505) tripped; already processed
 *   - error      → unexpected DB error (or thrown); caller decides
 *                  whether to skip or return 5xx to trigger a retry
 *   - no_event_id → caller passed a falsy eventId; no dedup possible
 *                  (caller should process the event as one-shot)
 */
export const CLAIM_OUTCOMES = Object.freeze({
  FIRST:        "first",
  DUPLICATE:    "duplicate",
  ERROR:        "error",
  NO_EVENT_ID:  "no_event_id",
});

/**
 * Like `claimWebhookEvent` but returns the discriminated outcome so
 * callers can distinguish "duplicate" from "DB unhealthy". Used by
 * qbWebhook to return 503 on DB errors (QB then retries with
 * exponential backoff) instead of silently dropping the event.
 *
 * @param {object} supabase
 * @param {string} source
 * @param {string} eventId
 * @param {object} [payload]
 * @returns {Promise<{ status: string, error?: any }>}
 */
export async function claimWebhookEventDetailed(supabase, source, eventId, payload = null) {
  if (!eventId) {
    return { status: CLAIM_OUTCOMES.NO_EVENT_ID };
  }
  try {
    const { error, count } = await supabase
      .from("processed_webhook_events")
      .insert(
        { source, event_id: eventId, payload },
        { count: "exact" },
      );
    if (error) {
      if (error.code === "23505") {
        return { status: CLAIM_OUTCOMES.DUPLICATE };
      }
      console.error(`[webhookIdempotency] ${source}/${eventId} claim failed:`, error.message);
      return { status: CLAIM_OUTCOMES.ERROR, error };
    }
    if ((count ?? 0) > 0) return { status: CLAIM_OUTCOMES.FIRST };
    // Insert succeeded but returned zero rows — extremely unusual.
    // Conservatively treat as duplicate.
    return { status: CLAIM_OUTCOMES.DUPLICATE };
  } catch (err) {
    console.error(`[webhookIdempotency] ${source}/${eventId} threw:`, err?.message || err);
    return { status: CLAIM_OUTCOMES.ERROR, error: err };
  }
}

/**
 * Atomically claim ownership of a webhook event. Returns true if
 * this is the first time we've seen it (caller should process),
 * false if it's already been processed (caller should return 200
 * without side effects).
 *
 * Returns false on ANY DB error too — conservative posture, prefer
 * skipping a possible duplicate over running side effects twice.
 *
 * Backwards-compatible wrapper around `claimWebhookEventDetailed`.
 * New code that needs error-vs-duplicate distinction should call
 * the detailed variant directly.
 *
 * @param {object} supabase  — service-role client
 * @param {string} source    — 'stripe' / 'qb' / 'billing'
 * @param {string} eventId   — provider's event ID (from extract* above)
 * @param {object} [payload] — optional, stored for forensics
 * @returns {Promise<boolean>}
 */
export async function claimWebhookEvent(supabase, source, eventId, payload = null) {
  const detailed = await claimWebhookEventDetailed(supabase, source, eventId, payload);
  if (detailed.status === CLAIM_OUTCOMES.FIRST) return true;
  if (detailed.status === CLAIM_OUTCOMES.NO_EVENT_ID) return true;
  return false;
}
