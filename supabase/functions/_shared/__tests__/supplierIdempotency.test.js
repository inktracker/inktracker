import { describe, it, expect, vi } from "vitest";
import { decideIdempotencyAction, claimSupplierOrder, finishSupplierOrder } from "../supplierIdempotency";

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
  it("never throws even if the bookkeeping write fails", async () => {
    const admin = {
      from() {
        const p = {
          update: () => p,
          eq: () => p,
          // whole chain is awaited; awaiting rejects → helper swallows it
          then: (res, rej) => Promise.reject(new Error("db down")).then(res, rej),
        };
        return p;
      },
    };
    await expect(
      finishSupplierOrder(admin, { shopOwner: "a@b.co", key: "k1", success: true }),
    ).resolves.toBeUndefined();
  });
});
