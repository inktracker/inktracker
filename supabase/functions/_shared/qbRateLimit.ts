// QB rate-limit helpers. Lives in _shared so it can be unit-tested
// without standing up an edge function.
//
// Intuit returns HTTP 429 with a Retry-After header when an app exceeds
// its per-realm or per-app quota on the Builder tier (500 req/min app,
// 100 req/min realm at time of writing). Retry-After can be either an
// integer (seconds) or an HTTP-date per RFC 7231. We cap the parsed
// value because an honest 5+ minute pause would exceed the edge
// function's execution budget, and a hostile header could otherwise
// hang us indefinitely.

export const QB_RATE_LIMIT_RETRY_AFTER_CAP_MS = 10_000;

export function parseRetryAfterMs(header: string | null | undefined): number | null {
  if (header == null) return null;
  const trimmed = String(header).trim();
  if (!trimmed) return null;
  // Numeric form (seconds) is checked first AND exclusively — if the
  // string parses as a number, never fall through to Date.parse, which
  // would otherwise accept "-1" as a year and produce a bogus delta.
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum)) {
    if (asNum < 0) return null;
    return Math.min(asNum * 1000, QB_RATE_LIMIT_RETRY_AFTER_CAP_MS);
  }
  const t = Date.parse(trimmed);
  if (!Number.isNaN(t)) {
    const delta = Math.max(0, t - Date.now());
    return Math.min(delta, QB_RATE_LIMIT_RETRY_AFTER_CAP_MS);
  }
  return null;
}

export class QbRateLimitError extends Error {
  retryAfterSeconds: number;
  label: string;
  constructor(label: string, retryAfterSeconds: number) {
    super(`QB ${label} rate-limited (429), retry in ${retryAfterSeconds}s`);
    this.name = "QbRateLimitError";
    this.label = label;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
