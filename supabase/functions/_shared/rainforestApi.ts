// Thin Rainforest API client (server only — the API key never reaches a
// browser). Secrets: RAINFOREST_API_KEY (sbx_apikey_… / apikey_…),
// RAINFOREST_API_BASE (https://api.sandbox.rainforestpay.com or
// https://api.rainforestpay.com). Responses are unwrapped from `{ data }`.

import { RAINFOREST_API_VERSION } from "./rainforestRequests.js";

// deno-lint-ignore no-explicit-any
type Any = any;

export type RainforestApi = {
  get: (path: string) => Promise<Any>;
  post: (path: string, body: unknown) => Promise<Any>;
  base: string;
};

export class RainforestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function rainforestApi(env: (k: string) => string | undefined): RainforestApi {
  const base = (env("RAINFOREST_API_BASE") ?? "https://api.sandbox.rainforestpay.com").replace(/\/$/, "");
  const key = env("RAINFOREST_API_KEY") ?? "";
  const call = async (method: string, path: string, body?: unknown) => {
    if (!key) throw new RainforestError("RAINFOREST_API_KEY is not set", 500);
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Rainforest-Api-Version": RAINFOREST_API_VERSION,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) throw new RainforestError(`Rainforest ${method} ${path} → ${res.status}: ${text.slice(0, 400)}`, res.status);
    const j = text ? JSON.parse(text) : {};
    return j?.data ?? j;
  };
  return { base, get: (p) => call("GET", p), post: (p, b) => call("POST", p, b ?? {}) };
}

/** Browser script for the components, matched to the API environment. */
export function componentScripts(base: string) {
  const sandbox = /sandbox/.test(base);
  return {
    payment: `https://static.rainforestpay.com/${sandbox ? "sandbox." : ""}payment.js`,
    merchant: `https://static.rainforestpay.com/${sandbox ? "sandbox." : ""}merchant.js`,
  };
}
