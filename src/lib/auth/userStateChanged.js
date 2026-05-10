// Decide whether AuthContext should swap a freshly-fetched user object into
// React state. Pure function so it's testable without React.
//
// Rule: skip the update only when the meaningful fields are identical. The
// fields below are the ones the app branches on:
//
//   - id, email                 → identity
//   - role                      → drives App.jsx routing
//                                 (post-signup activate_trial flips
//                                 'user' → 'shop'; missing this update
//                                 strands the new user on a spinner)
//   - subscription_tier
//   - subscription_status       → drives feature gating in src/lib/billing.js
//
// If you add another field that App.jsx / billing branches on, add it here
// and to the matching test.

const COMPARED_FIELDS = [
  "id",
  "email",
  "role",
  "subscription_tier",
  "subscription_status",
];

export function userStateChanged(prev, next) {
  if (!prev) return Boolean(next);
  if (!next) return true;
  return COMPARED_FIELDS.some((k) => prev[k] !== next[k]);
}

export const USER_STATE_COMPARED_FIELDS = COMPARED_FIELDS;
