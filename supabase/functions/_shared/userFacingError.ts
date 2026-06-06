// User-facing error wrapper for edge functions.
//
// Problem this solves: Supabase JS `.functions.invoke()` returns
// `{ data: null, error: FunctionsHttpError }` on any non-2xx response,
// and `FunctionsHttpError.message` is just `"Edge Function returned a
// non-2xx status code"` — not the actual error message the function
// sent in its body. Frontend callers that surface `err.message` end
// up showing that generic string to users instead of helpful copy
// like "Your QuickBooks connection has expired."
//
// Fix: for KNOWN user-facing failure modes (token expired, subscription
// blocked, malformed token response, etc.) the edge function returns
// HTTP 200 with `{ success: false, error_code, error }`. Frontend
// callers already read `data.error` (see SendQuoteModal.jsx:280) so
// the clean message reaches the user without any caller changes.
//
// 5xx is reserved for genuine server bugs (DB outage, unexpected
// exception). 4xx is reserved for auth/method failures the SDK
// handles natively. 200 + success:false is "the call worked, but the
// operation is blocked — here's why."
//
// Usage at the throw site:
//   throw new UserFacingError("qb_disconnected", "Please reconnect QB.");
//
// Usage at the top-level catch in any edge function:
//   if (err instanceof UserFacingError) {
//     return Response.json(
//       { success: false, error_code: err.code, error: err.message },
//       { status: 200, headers: CORS },
//     );
//   }

export const USER_FACING_CODES = Object.freeze({
  // QuickBooks
  QB_NOT_CONNECTED:        "qb_not_connected",        // no tokens stored
  QB_DISCONNECTED:         "qb_disconnected",         // refresh returned invalid_grant
  QB_REFRESH_FAILED:       "qb_refresh_failed",       // refresh non-2xx (transient)
  QB_MALFORMED_TOKEN:      "qb_malformed_token",      // refresh body shape invalid
  // Subscription
  SUBSCRIPTION_BLOCKED:    "subscription_blocked",    // expired / canceled / trial ended / no tier
});

export class UserFacingError extends Error {
  public code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "UserFacingError";
  }
}

/**
 * Detect a UserFacingError without relying on `instanceof` — which can
 * silently fail across module boundaries when the same class is
 * imported from two copies of the file. Edge functions bundle the
 * shared modules per-function, so cross-bundle `instanceof` is brittle.
 */
export function isUserFacingError(err: unknown): err is UserFacingError {
  return (
    !!err &&
    typeof err === "object" &&
    (err as { name?: string }).name === "UserFacingError" &&
    typeof (err as { code?: unknown }).code === "string"
  );
}
