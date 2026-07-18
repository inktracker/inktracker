import { describe, it, expect, vi } from "vitest";
import { withQbRowSerialization } from "../qbIdempotency.js";

/**
 * Mock supabase simulating the qb_idempotency table (same shape as the
 * mock in qbIdempotency.test.js, plus `delete` — the lock releases by
 * deleting its row rather than marking it completed).
 */
function makeSupabase(initialRows = []) {
  const rows = new Map(initialRows.map((r) => [r.key, { ...r }]));
  return {
    rows,
    from(table) {
      if (table !== "qb_idempotency") throw new Error(`unexpected table: ${table}`);
      return {
        insert(row) {
          if (rows.has(row.key)) {
            return Promise.resolve({ error: { code: "23505", message: "duplicate" } });
          }
          rows.set(row.key, { ...row });
          return Promise.resolve({ error: null });
        },
        update(patch, opts = {}) {
          const preds = [];
          const exec = () => {
            let count = 0;
            for (const [k, r] of rows.entries()) {
              if (preds.every((p) => p(r))) {
                rows.set(k, { ...r, ...patch });
                count++;
              }
            }
            return { error: null, count: opts.count === "exact" ? count : null };
          };
          const builder = {
            eq(col, val) { preds.push((r) => r[col] === val); return builder; },
            lt(col, val) { preds.push((r) => r[col] < val); return builder; },
            then(resolve, reject) {
              try { resolve(exec()); } catch (e) { reject(e); }
            },
          };
          return builder;
        },
        delete() {
          return {
            eq(_col, key) {
              rows.delete(key);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

const ctx = { shop_owner: "shop@x.com", action: "create_invoice_lock" };
const KEY = "create_invoice_row:row-1";

describe("withQbRowSerialization", () => {
  it("no key → runs fn unlocked", async () => {
    const sb = makeSupabase();
    const fn = vi.fn().mockResolvedValue("ran");
    const out = await withQbRowSerialization(sb, null, ctx, fn);
    expect(out).toEqual({ acquired: true, result: "ran" });
    expect(sb.rows.size).toBe(0);
  });

  it("uncontended → claims, runs, and DELETEs the lock row on success", async () => {
    const sb = makeSupabase();
    const fn = vi.fn().mockResolvedValue({ qbInvoiceId: "3744" });
    const out = await withQbRowSerialization(sb, KEY, ctx, fn);
    expect(out.acquired).toBe(true);
    expect(out.result).toEqual({ qbInvoiceId: "3744" });
    expect(sb.rows.has(KEY)).toBe(false);
  });

  it("releases the lock even when fn throws", async () => {
    const sb = makeSupabase();
    const fn = vi.fn().mockRejectedValue(new Error("QB exploded"));
    await expect(withQbRowSerialization(sb, KEY, ctx, fn)).rejects.toThrow("QB exploded");
    expect(sb.rows.has(KEY)).toBe(false);
  });

  it("contended → waits for the holder's release, then runs (the two-button race)", async () => {
    const sb = makeSupabase([{
      key: KEY, shop_owner: ctx.shop_owner, action: ctx.action,
      status: "in_flight",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }]);
    const fn = vi.fn().mockResolvedValue("second-sync-ran");
    // Fake sleep: the "holder" finishes (row deleted) during the first poll.
    const sleep = vi.fn().mockImplementation(() => { sb.rows.delete(KEY); return Promise.resolve(); });
    const out = await withQbRowSerialization(sb, KEY, ctx, fn, { sleep, pollMs: 1 });
    expect(sleep).toHaveBeenCalled();
    expect(out).toEqual({ acquired: true, result: "second-sync-ran" });
  });

  it("holder never releases → times out WITHOUT running fn (never write concurrently)", async () => {
    const sb = makeSupabase([{
      key: KEY, shop_owner: ctx.shop_owner, action: ctx.action,
      status: "in_flight",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }]);
    const fn = vi.fn();
    const sleep = vi.fn().mockResolvedValue(undefined);
    const out = await withQbRowSerialization(sb, KEY, ctx, fn, { sleep, waitMs: 0 });
    expect(out).toEqual({ acquired: false, result: null });
    expect(fn).not.toHaveBeenCalled();
  });

  it("expired lock (crashed holder) → reclaimed immediately", async () => {
    const sb = makeSupabase([{
      key: KEY, shop_owner: ctx.shop_owner, action: ctx.action,
      status: "in_flight",
      expires_at: new Date(Date.now() - 1000).toISOString(),
    }]);
    const fn = vi.fn().mockResolvedValue("reclaimed-and-ran");
    const out = await withQbRowSerialization(sb, KEY, ctx, fn);
    expect(out).toEqual({ acquired: true, result: "reclaimed-and-ran" });
  });

  it("unexpected insert error → degrades to running fn unlocked (availability first)", async () => {
    const sb = makeSupabase();
    sb.from = () => ({
      insert: () => Promise.resolve({ error: { code: "XX000", message: "db down" } }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    });
    const fn = vi.fn().mockResolvedValue("ran-anyway");
    const out = await withQbRowSerialization(sb, KEY, ctx, fn);
    expect(out).toEqual({ acquired: true, result: "ran-anyway" });
  });

  it("requires ctx.shop_owner and ctx.action when a key is present", async () => {
    const sb = makeSupabase();
    await expect(withQbRowSerialization(sb, KEY, {}, vi.fn())).rejects.toThrow(/shop_owner/);
  });
});
