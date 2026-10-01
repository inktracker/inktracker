// The global edge-error translation must reach EVERY invoke. supabase-js
// builds a new FunctionsClient on each `supabase.functions` access, so a
// patch on one instance does nothing (the 2026-10-01 bug). Real client,
// fake fetch.
import { describe, it, expect, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

vi.mock("@/lib/query-client", () => ({ queryClientInstance: { invalidateQueries: () => {} } }));

const { installEdgeErrorTranslation } = await import("../supabaseClient.js");

function clientReturning(status, body) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  return createClient("https://example.supabase.co", "anon-key", { global: { fetch } });
}

describe("installEdgeErrorTranslation", () => {
  it("supabase.functions is a fresh object each time (why an instance patch never worked)", () => {
    const c = clientReturning(200, {});
    expect(c.functions).not.toBe(c.functions);
  });

  it("every access gets the function's own message, not 'Edge Function returned a non-2xx status code'", async () => {
    const c = clientReturning(400, { error: "Stripe couldn't do that: Not a valid merchant category" });
    installEdgeErrorTranslation(c);
    const { error } = await c.functions.invoke("stripePayments", { body: {} });
    expect(error.message).toBe("Stripe couldn't do that: Not a valid merchant category");
    expect(error.status).toBe(400);
    expect(error.raw).toBeTruthy();
  });

  it("success passes through untouched; installing twice doesn't double-wrap", async () => {
    const c = clientReturning(200, { ok: true });
    installEdgeErrorTranslation(c);
    installEdgeErrorTranslation(c);
    const res = await c.functions.invoke("x", { body: {} });
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ ok: true });
  });
});
