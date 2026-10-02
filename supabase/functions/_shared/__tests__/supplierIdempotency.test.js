import { describe, it, expect, vi } from "vitest";
import { decideIdempotencyAction, claimSupplierOrder, finishSupplierOrder, STALE_IN_FLIGHT_MS } from "../supplierIdempotency";

describe("decideIdempotencyAction", () => {
  it("replays a succeeded prior attempt (never re-places)", () => {
    expect(decideIdempotencyAction({ status: "succeeded" })).toBe("replay");
  });
  it("reports in_flight when another request is mid-placement", () => {
    expect(decideIdempotencyAction({ status: "in_flight" })).toBe("in_flight");
  });
  it("allows reclaim/retry after a failed attempt", () => {
    expect(decideIdempotencyAction({ status: "failed" })).toBe("reclaim");
  });
  it("treats unknown/null rows as reclaimable (conservative — not a replay)", () => {
    expect(decideIdempotencyAction(null)).toBe("reclaim");
    expect(decideIdempotencyAction({})).toBe("reclaim");
    expect(decideIdempotencyAction({ status: "weird" })).toBe("reclaim");
  });

  // M7 (audit 2026-10-02): a crash between claim and finish left the row
  // in_flight FOREVER — every retry 409'd and the PO could never be
  // re-submitted. A stale in_flight (older than the TTL) is a dead edge
  // invocation, not a live one, and must become reclaimable.
  it("a STALE in_flight (past the TTL) is reclaim_stale — no permanent lockout", () => {
    const now = Date.parse("2026-10-02T12:00:00Z");
    const dead = new Date(now - STALE_IN_FLIGHT_MS - 60_000).toISOString();
    expect(decideIdempotencyAction({ status: "in_flight", updated_at: dead }, { nowMs: now })).toBe("reclaim_stale");
  });
  it("a FRESH in_flight stays in_flight (live request is never stolen)", () => {
    const now = Date.parse("2026-10-02T12:00:00Z");
    const fresh = new Date(now - 30_000).toISOString();
    expect(decideIdempotencyAction({ status: "in_flight", updated_at: fresh }, { nowMs: now })).toBe("in_flight");
  });
  it("in_flight with NO updated_at stays in_flight (can't prove it's dead → conservative)", () => {
    expect(decideIdempotencyAction({ status: "in_flight" })).toBe("in_flight");
    expect(decideIdempotencyAction({ status: "in_flight", updated_at: "garbage" })).toBe("in_flight");
  });
  it("succeeded ALWAYS replays, no matter how old (a placed order never re-places)", () => {
    const ancient = "2020-01-01T00:00:00Z";
    expect(decideIdempotencyAction({ status: "succeeded", updated_at: ancient })).toBe("replay");
  });
});

describe("finishSupplierOrder — checked + retried, never silent (M7)", () => {
  it("returns true when the outcome write lands", async () => {
    const admin = { from: () => ({ update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }) };
    await expect(finishSupplierOrder(admin, { shopOwner: "s", key: "k", success: true, supplierOrderId: "SO-1" })).resolves.toBe(true);
  });
  it("retries a failing write and returns false after exhausting attempts (CRITICAL logged)", async () => {
    let calls = 0;
    const admin = { from: () => ({ update: () => ({ eq: () => ({ eq: async () => { calls++; return { error: { message: "db down" } }; } }) }) }) };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const ok = await finishSupplierOrder(admin, { shopOwner: "s", key: "k", success: true, supplierOrderId: "SO-9" });
    expect(ok).toBe(false);
    expect(calls).toBe(3);
    expect(err.mock.calls.some((c) => String(c[0]).includes("CRITICAL") && String(c[0]).includes("SO-9"))).toBe(true);
    err.mockRestore();
  });
});

// Minimal fluent-builder mock matching the supabase-js calls the helper makes.
function mockAdmin(handlers) {
  return {
    from() {
      const ctx = { _filters: {} };
      const builder = {
        upsert: (row, opts) => { ctx.op = "upsert"; ctx.row = row; ctx.opts = opts; return builder; },
        update: (patch) => { ctx.op = "update"; ctx.patch = patch; return builder; },
        eq: (col, val) => { ctx._filters[col] = val; return builder; },
        select: () => builder,
        maybeSingle: () => handlers(ctx),
        then: undefined,
      };
      // bare update (finish) is awaited without .select/.maybeSingle
      builder.then = (resolve) => Promise.resolve(handlers(ctx)).then(resolve);
      return builder;
    },
  };
}

describe("claimSupplierOrder", () => {
  it("owns the claim when the insert wins (no conflict)", async () => {
    const admin = mockAdmin((ctx) =>
      ctx.op === "upsert" ? { data: { id: "row1" }, error: null } : { data: null, error: null },
    );
    const r = await claimSupplierOrder(admin, { shopOwner: "a@b.co", key: "k1", supplier: "S&S" });
    expect(r).toEqual({ owned: true });
  });

  it("replays the stored result when a prior attempt succeeded", async () => {
    const admin = mockAdmin((ctx) => {
      if (ctx.op === "upsert") return { data: null, error: null }; // conflict, no row
      return { data: { status: "succeeded", response: { ok: 1 }, supplier_order_id: "SO-9" }, error: null };
    });
    const r = await claimSupplierOrder(admin, { shopOwner: "a@b.co", key: "k1" });
    expect(r).toMatchObject({ owned: false, replay: true, supplierOrderId: "SO-9" });
    expect(r.response).toEqual({ ok: 1 });
  });

  it("reports inFlight when another request is actively placing", async () => {
    const admin = mockAdmin((ctx) => {
      if (ctx.op === "upsert") return { data: null, error: null };
      return { data: { status: "in_flight" }, error: null };
    });
    const r = await claimSupplierOrder(admin, { shopOwner: "a@b.co", key: "k1" });
    expect(r).toEqual({ owned: false, inFlight: true });
  });

  it("reclaims after a failed attempt", async () => {
    let phase = 0;
    const admin = mockAdmin((ctx) => {
      if (ctx.op === "upsert") return { data: null, error: null };
      if (ctx.op === "update") return { data: { id: "row1" }, error: null }; // reclaim won
      // select existing
      phase++;
      return { data: { status: "failed" }, error: null };
    });
    const r = await claimSupplierOrder(admin, { shopOwner: "a@b.co", key: "k1" });
    expect(r).toEqual({ owned: true });
  });

  it("throws (fail closed) on an insert/infra error", async () => {
    const admin = mockAdmin((ctx) =>
      ctx.op === "upsert" ? { data: null, error: new Error("table missing") } : { data: null, error: null },
    );
    await expect(claimSupplierOrder(admin, { shopOwner: "a@b.co", key: "k1" })).rejects.toThrow(/table missing/);
  });

  it("requires shopOwner + key", async () => {
    await expect(claimSupplierOrder({}, { shopOwner: "", key: "k" })).rejects.toThrow(/requires/);
    await expect(claimSupplierOrder({}, { shopOwner: "a@b.co", key: "" })).rejects.toThrow(/requires/);
  });
});

describe("finishSupplierOrder", () => {
  it("never throws even if the bookkeeping write fails — but reports false now (M7)", async () => {
    const admin = {
      from() {
        const p = {
          update: () => p,
          eq: () => p,
          // whole chain is awaited; awaiting rejects → helper retries, then
          // logs CRITICAL and returns false (old contract swallowed to
          // undefined — the lockout bug).
          then: (res, rej) => Promise.reject(new Error("db down")).then(res, rej),
        };
        return p;
      },
    };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      finishSupplierOrder(admin, { shopOwner: "a@b.co", key: "k1", success: true }),
    ).resolves.toBe(false);
    err.mockRestore();
  });
});
