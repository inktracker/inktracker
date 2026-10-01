// Thin Stripe API client for InkTracker payments (server only — the key
// never reaches a browser). Secret: STRIPE_CONNECT_SECRET_KEY, the
// PLATFORM key (sk_test_… in test mode, sk_live_… live). Deliberately a
// separate secret from the subscription-billing key so payments can be
// tested in test mode while billing stays live.
//
// `account` makes the call ON a shop's connected account (Stripe-Account
// header); `idempotencyKey` makes a POST safe to repeat.

import { formEncode } from "./stripeForm.js";

// deno-lint-ignore no-explicit-any
type Any = any;

export const STRIPE_API_VERSION = "2024-06-20";

export type StripeOpts = { account?: string | null; idempotencyKey?: string };
export type StripeApi = {
  get: (path: string, query?: Any, opts?: StripeOpts) => Promise<Any>;
  post: (path: string, params?: Any, opts?: StripeOpts) => Promise<Any>;
  live: boolean;
};

export class StripeError extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function stripeApi(env: (k: string) => string | undefined, fetchImpl: typeof fetch = fetch): StripeApi {
  const key = env("STRIPE_CONNECT_SECRET_KEY") ?? "";
  const call = async (method: string, path: string, params: Any, opts: StripeOpts = {}) => {
    if (!key) throw new StripeError("STRIPE_CONNECT_SECRET_KEY is not set", 500);
    const qs = method === "GET" && params ? formEncode(params) : "";
    const res = await fetchImpl(`https://api.stripe.com${path}${qs ? `?${qs}` : ""}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Stripe-Version": STRIPE_API_VERSION,
        ...(opts.account ? { "Stripe-Account": opts.account } : {}),
        ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(method === "POST" ? { body: formEncode(params ?? {}) } : {}),
    });
    const text = await res.text();
    let j: Any = {};
    try { j = text ? JSON.parse(text) : {}; } catch { /* non-JSON error body */ }
    if (!res.ok) {
      throw new StripeError(`Stripe ${method} ${path} → ${res.status}: ${String(j?.error?.message ?? text).slice(0, 400)}`, res.status, j?.error?.code ?? null);
    }
    return j;
  };
  return {
    live: key.startsWith("sk_live_") || key.startsWith("rk_live_"),
    get: (p, q, o) => call("GET", p, q, o),
    post: (p, b, o) => call("POST", p, b, o),
  };
}
