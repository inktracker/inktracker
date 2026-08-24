// Pure payload/route logic for sendPush.
//
// Extracted from the handler on purpose: edge-function bodies are ~0%
// covered by vitest (that's where the approveArtwork leak hid), so the
// parts that make DECISIONS about what a shop owner sees live here, where
// they can be tested like any other module.

// Where a notification should open. related_entity is free text written by
// whichever edge function inserted the row, so map it EXPLICITLY — never
// interpolate it into a path. An unexpected value must land somewhere
// harmless, not build a broken (or attacker-shaped) URL.
// Null-prototype: a plain object literal would resolve inherited keys, so
// related_entity="constructor" returns Object's constructor — truthy — and
// targetUrl happily builds "function Object() { [native code] }?focus=…".
// Caught by the prototype-chain test below; keep the null prototype AND the
// hasOwn check in targetUrl.
export const ENTITY_ROUTES = Object.assign(Object.create(null), {
  quote: "/Quotes",
  order: "/Orders",
  invoice: "/Invoices",
  expense: "/Expenses",
  customer: "/Customers",
});

const FALLBACK_ROUTE = "/Notifications";

/**
 * Resolve the in-app destination for a notification.
 *
 * @param {string|null|undefined} entity  notifications.related_entity
 * @param {string|null|undefined} id      notifications.related_id
 * @returns {string} an app-relative path, always starting with "/"
 */
export function targetUrl(entity, id) {
  const base = entity && Object.prototype.hasOwnProperty.call(ENTITY_ROUTES, entity)
    ? ENTITY_ROUTES[entity]
    : null;
  if (!base) return FALLBACK_ROUTE;
  if (id === null || id === undefined || id === "") return base;
  return `${base}?focus=${encodeURIComponent(String(id))}`;
}

/**
 * Build the JSON the service worker receives.
 *
 * The body can carry customer names and dollar amounts — that's the point
 * of a useful notification — which is why it only ever travels inside the
 * RFC 8291 encrypted payload, never in a header or query string.
 *
 * @param {object} note  a row from public.notifications
 * @returns {string} JSON string
 */
export function buildPushPayload(note) {
  return JSON.stringify({
    title: note.title,
    body: note.body ?? "",
    url: targetUrl(note.related_entity, note.related_id),
    // Collapse repeats of the same event on the same entity so a shop
    // doesn't wake up to a stack of identical banners.
    tag: `${note.event_type}:${note.related_id ?? note.id}`,
    severity: note.severity,
    notificationId: note.id,
  });
}

/**
 * How hard to push. 'info' can wait for the next time the device wakes;
 * warnings and alerts are money moments (a lead landed, a payment came in)
 * and should surface promptly.
 */
export function urgencyFor(severity) {
  return severity === "info" ? "normal" : "high";
}

/**
 * Is this notification fresh enough to push?
 *
 * Guards two things at once: a replayed/forged id for an OLD row does
 * nothing, and a backfill that inserts historical rows can't carpet-bomb
 * someone's phone.
 *
 * @param {string} createdAt  ISO timestamp from the row
 * @param {number} [nowMs]    injectable for tests
 * @param {number} [maxAgeMs]
 */
export function isFreshEnough(createdAt, nowMs = Date.now(), maxAgeMs = 10 * 60 * 1000) {
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return false;
  return nowMs - t <= maxAgeMs;
}
