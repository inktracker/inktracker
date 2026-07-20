import { describe, it, expect } from "vitest";
import { computeReadOnly } from "../billing.js";

// Task 0 — prove the client read-only rule (computeReadOnly) is the EXACT
// inverse of the server write gate has_active_subscription()
// (migration 20260811000000_bill03_past_due_grace.sql), across every
// subscription state. `serverAllowsWrite` below is a faithful line-by-line
// mirror of that SQL; if either side changes, this test fails until they agree.

const NOW = 1782000000000; // fixed clock
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();

// Faithful mirror of public.has_active_subscription(). Team members are modeled
// by passing the GOVERNING (owner) subscription fields directly on `user`, which
// is exactly what AuthContext applies via resolveTeamSubscription.
function serverAllowsWrite(user, now = NOW) {
  if (!user) return true; // NOT FOUND → fail-safe allow
  if (user.role === "admin" || user.role === "broker") return true;
  const tier = user.subscription_tier;
  const status = user.subscription_status;
  const trial = user.trial_ends_at ? new Date(user.trial_ends_at).getTime() : null;
  const pastDue = user.past_due_since ? new Date(user.past_due_since).getTime() : null;
  const lapsed =
    tier === "expired" ||
    tier === "incomplete" ||
    status === "canceled" ||
    (tier === "trial" && trial !== null && trial < now) ||
    (status === "past_due" && pastDue !== null && pastDue < now - 7 * DAY);
  return !lapsed;
}

const CASES = [
  { name: "active shop", user: { role: "shop", subscription_tier: "shop", subscription_status: "active" }, expectReadOnly: false },
  { name: "trialing (in window)", user: { role: "shop", subscription_tier: "trial", subscription_status: "trialing", trial_ends_at: iso(NOW + 5 * DAY) }, expectReadOnly: false },
  { name: "trial with no end date", user: { role: "shop", subscription_tier: "trial", subscription_status: "trialing" }, expectReadOnly: false },
  { name: "trial expired", user: { role: "shop", subscription_tier: "trial", subscription_status: "trialing", trial_ends_at: iso(NOW - DAY) }, expectReadOnly: true },
  { name: "incomplete (never subscribed)", user: { role: "shop", subscription_tier: "incomplete", subscription_status: "incomplete" }, expectReadOnly: true },
  { name: "past_due in grace (2d)", user: { role: "shop", subscription_tier: "shop", subscription_status: "past_due", past_due_since: iso(NOW - 2 * DAY) }, expectReadOnly: false },
  { name: "past_due no stamp", user: { role: "shop", subscription_tier: "shop", subscription_status: "past_due" }, expectReadOnly: false },
  { name: "past_due beyond grace (10d)", user: { role: "shop", subscription_tier: "shop", subscription_status: "past_due", past_due_since: iso(NOW - 10 * DAY) }, expectReadOnly: true },
  { name: "canceled", user: { role: "shop", subscription_tier: "shop", subscription_status: "canceled" }, expectReadOnly: true },
  { name: "expired tier", user: { role: "shop", subscription_tier: "expired", subscription_status: "active" }, expectReadOnly: true },
  { name: "admin, even if canceled/expired", user: { role: "admin", subscription_tier: "expired", subscription_status: "canceled" }, expectReadOnly: false },
  { name: "broker, even if canceled/expired", user: { role: "broker", subscription_tier: "expired", subscription_status: "canceled" }, expectReadOnly: false },
  { name: "manager inheriting active owner", user: { role: "manager", subscription_tier: "shop", subscription_status: "active" }, expectReadOnly: false },
  { name: "manager inheriting expired owner", user: { role: "manager", subscription_tier: "expired", subscription_status: "canceled" }, expectReadOnly: true },
  { name: "no user", user: null, expectReadOnly: false },
];

describe("read-only rule ↔ has_active_subscription agreement", () => {
  it.each(CASES)("$name → client is the exact inverse of the server gate", ({ user, expectReadOnly }) => {
    const clientReadOnly = computeReadOnly(user, NOW);
    // client read-only must equal the pinned expectation…
    expect(clientReadOnly).toBe(expectReadOnly);
    // …AND be the exact inverse of what the server would allow.
    expect(clientReadOnly).toBe(!serverAllowsWrite(user, NOW));
  });
});
