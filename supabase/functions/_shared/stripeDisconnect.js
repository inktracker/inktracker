// Disconnect a shop's Stripe account from InkTracker's platform (when the
// shop deletes its InkTracker account). Decision logic, unit-tested; the
// network call is injected.
//
// Stripe's rules (docs.stripe.com, checked 2026-10-01):
//   - POST connect.stripe.com/oauth/deauthorize {client_id, stripe_user_id}
//     disconnects "an account with access to the Stripe Dashboard" — that's
//     every Standard account, the ones InkTracker created (Account Links)
//     as well as ones a shop connected by OAuth. It needs the platform's
//     client_id, which is why sign-up requires STRIPE_CONNECT_CLIENT_ID.
//   - DELETE /v1/accounts is NOT an option: live Standard accounts can't be
//     deleted (and deleting would destroy the shop's own Stripe account).

export const DISCONNECT = Object.freeze({
  DISCONNECTED: "disconnected",
  ALREADY: "already_disconnected",
  TEST_ACCOUNT: "test_account_skipped",
  MANUAL: "manual",
  NONE: "none",
});

// What Stripe says when the platform no longer has the account (the shop
// disconnected first, or it's gone): nothing left to do.
const ALREADY_GONE = /not connected|no such|does not have access|not authorized for this account|invalid_client/i;

/**
 * @param {object} a
 * @param {string|null} a.accountId     processor_accounts.merchant_id
 * @param {boolean|null} a.accountLive  processor_accounts.stripe_livemode
 * @param {boolean} a.keyLive           is the platform key a live key
 * @param {string} a.clientId           STRIPE_CONNECT_CLIENT_ID
 * @param {(accountId: string, clientId: string) => Promise<unknown>} a.deauthorize
 * @returns {Promise<{ status: string, detail?: string }>}
 */
export async function disconnectStripeAccount({ accountId, accountLive, keyLive, clientId, deauthorize }) {
  if (!accountId) return { status: DISCONNECT.NONE };
  // A test-mode account doesn't exist under the live key (and holds no real
  // access to anything): nothing to disconnect.
  if (accountLive === false && keyLive) return { status: DISCONNECT.TEST_ACCOUNT };
  if (!clientId) {
    return { status: DISCONNECT.MANUAL, detail: `STRIPE_CONNECT_CLIENT_ID isn't set — remove ${accountId} in Stripe (Connect → Accounts)` };
  }
  try {
    await deauthorize(accountId, clientId);
    return { status: DISCONNECT.DISCONNECTED };
  } catch (err) {
    const msg = String(err?.message ?? err);
    if (ALREADY_GONE.test(msg)) return { status: DISCONNECT.ALREADY };
    return { status: DISCONNECT.MANUAL, detail: `${msg.slice(0, 200)} — remove ${accountId} in Stripe (Connect → Accounts)` };
  }
}
