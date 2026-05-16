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
 * Atomically claim ownership of a webhook event. Returns true if
 * this is the first time we've seen it (caller should process),
 * false if it's already been processed (caller should return 200
 * without side effects).
 *
 * Returns false on ANY DB error too — conservative posture, prefer
 * skipping a possible duplicate over running side effects twice.
 *
 * @param {object} supabase  — service-role client
 * @param {string} source    — 'stripe' / 'qb' / 'billing'
 * @param {string} eventId   — provider's event ID (from extract* above)
 * @param {object} [payload] — optional, stored for forensics
 * @returns {Promise<boolean>}
 */
export async function claimWebhookEvent(supabase, source, eventId, payload = null) {
  if (!eventId) {
    // No dedup possible — caller has to decide whether to process.
    // We return true (process) because losing an unidentifiable
    // event is worse than running it once (the caller's handler is
    // the only chance to act on it). Logging this case is the
    // caller's responsibility.
    return true;
  }
  try {
    const { error, count } = await supabase
      .from("processed_webhook_events")
      .insert(
        { source, event_id: eventId, payload },
        { count: "exact" },
      );
    if (error) {
      // Postgres unique-violation code is 23505. ON CONFLICT-style
      // upsert would be cleaner but the supabase-js insert option
      // doesn't expose ON CONFLICT DO NOTHING — and we want the
      // explicit error so we can tell duplicate from "DB is down".
      if (error.code === "23505") {
        // Duplicate — already processed. Caller should short-circuit.
        return false;
      }
      // Unexpected DB error. Conservatively skip processing — if
      // the DB is unhealthy we don't want to compound the issue by
      // sending duplicate emails or recording duplicate QB payments.
      console.error(`[webhookIdempotency] ${source}/${eventId} claim failed:`, error.message);
      return false;
    }
    return (count ?? 0) > 0;
  } catch (err) {
    console.error(`[webhookIdempotency] ${source}/${eventId} threw:`, err?.message || err);
    return false;
  }
}
