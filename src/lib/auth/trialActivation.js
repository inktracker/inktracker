// Pure logic for interpreting the activate_trial RPC response and
// deciding what the UI should do next. Extracted so the React effect
// stays small and the decisions are unit-testable.
//
// The RPC (see supabase/migrations/20260517_harden_trial_activation.sql)
// returns a jsonb object with a `status` field:
//
//   activated      — was 'user', now 'shop'. Refetch profile.
//   already_active — was already 'shop'/'admin'. Refetch profile.
//   no_profile     — auth row exists but no profile row. Hard error.
//   wrong_role     — broker/employee/manager. Hard error.
//   bad_input      — caller bug (no auth id). Hard error.
//
// We also handle network/transport errors from supabase-js itself —
// those have an `error.message` shape. Those are retryable; the
// statuses above are not.

export const ACTIVATION_STATES = Object.freeze({
  // The user is now activated — refetch and continue.
  SUCCESS:    "success",
  // Transient failure (network, RPC timeout). Caller should retry.
  RETRYABLE:  "retryable",
  // Permanent failure. Show error to user; no automatic retry will help.
  PERMANENT:  "permanent",
});

const SUPABASE_RETRYABLE_HINTS = [
  "fetch",
  "network",
  "timeout",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "Failed to fetch",
];

/**
 * Map a (rpcResult, rpcError) tuple from supabase.rpc("activate_trial", …)
 * into a UI-ready state.
 *
 * @param {object}      args
 * @param {object|null} args.rpcResult  the parsed `data` from supabase.rpc
 * @param {object|null} args.rpcError   the `error` from supabase.rpc, if any
 * @returns {{ state: string, message: string, retryable: boolean }}
 */
export function interpretActivationResponse({ rpcResult, rpcError }) {
  // Transport error from supabase-js. Almost always retryable.
  if (rpcError) {
    const msg = String(rpcError.message ?? rpcError);
    const looksRetryable = SUPABASE_RETRYABLE_HINTS.some((hint) =>
      msg.toLowerCase().includes(hint.toLowerCase()),
    );
    return {
      state: looksRetryable ? ACTIVATION_STATES.RETRYABLE : ACTIVATION_STATES.PERMANENT,
      message: `Couldn't reach the activation service: ${msg}`,
      retryable: looksRetryable,
    };
  }

  // RPC returned but with no body — shouldn't happen with the
  // current SQL function, but be defensive.
  if (!rpcResult || typeof rpcResult !== "object") {
    return {
      state: ACTIVATION_STATES.RETRYABLE,
      message: "Activation returned no data. Try again.",
      retryable: true,
    };
  }

  switch (rpcResult.status) {
    case "activated":
    case "already_active":
      return {
        state: ACTIVATION_STATES.SUCCESS,
        message: "Account activated.",
        retryable: false,
      };

    case "no_profile":
      return {
        state: ACTIVATION_STATES.PERMANENT,
        message:
          "We couldn't find a profile for your account. Sign up may have failed partway through — please contact joe@biotamfg.co.",
        retryable: false,
      };

    case "wrong_role":
      return {
        state: ACTIVATION_STATES.PERMANENT,
        message:
          rpcResult.message ??
          "This account type doesn't get a free trial. Contact joe@biotamfg.co if you're not sure why you're seeing this.",
        retryable: false,
      };

    case "bad_input":
      // Caller bug — should never reach a real user. Surface as
      // permanent so we don't infinite-retry our own bug.
      return {
        state: ACTIVATION_STATES.PERMANENT,
        message: "Activation call was malformed. Please contact support.",
        retryable: false,
      };

    default:
      // Unknown status — be conservative and let the user retry.
      return {
        state: ACTIVATION_STATES.RETRYABLE,
        message: `Unexpected activation response (${rpcResult.status ?? "no status"}). Try again.`,
        retryable: true,
      };
  }
}

/**
 * Backoff schedule for the activation retry loop. Caps at 5 attempts
 * over ~10 seconds total. Returns ms delay before the next attempt,
 * or `null` once retries are exhausted.
 *
 * @param {number} attemptNumber  1-indexed (1 = first retry, after the initial call)
 * @returns {number|null}
 */
export function activationRetryDelayMs(attemptNumber) {
  // 1: 500ms, 2: 1s, 3: 2s, 4: 4s, 5+: null (stop)
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) return 500;
  if (attemptNumber > 4) return null;
  return 500 * Math.pow(2, attemptNumber - 1);
}

export const MAX_ACTIVATION_ATTEMPTS = 5;
