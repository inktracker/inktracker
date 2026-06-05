import { describe, it, expect, vi } from "vitest";
import {
  withQbIdempotency,
  IDEMPOTENCY_OUTCOMES,
  IDEMPOTENCY_TTL_MS,
} from "../qbIdempotency.js";

/**
 * Mock supabase that simulates the qb_idempotency table.
 * Keeps an in-memory row keyed by `key` to mirror the unique
 * primary key constraint.
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
          // Chainable WHERE-predicate builder so tests can exercise
          // both the legacy `.update(p).eq("key", k)` pattern AND the
          // new conditional-update path that chains `.eq().eq().lt()`
          // for the stale-row reclaim race fix.
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
            gt(col, val) { preds.push((r) => r[col] > val); return builder; },
            then(resolve, reject) {
              try { resolve(exec()); } catch (e) { reject(e); }
            },
          };
          return builder;
        },
        select() {
          return {
            eq(_col, key) {
              return {
                maybeSingle: vi.fn().mockResolvedValue({
                  data: rows.get(key) ?? null,
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };
}

const ctx = { shop_owner: "shop@x.com", action: "create_invoice" };

// ─────────────────────────────────────────────────────────────────────
// First-call (EXECUTED) path
// ─────────────────────────────────────────────────────────────────────

describe("withQbIdempotency — first call (QI1–QI3)", () => {
  it("QI1 — no key: runs fn unconditionally, no DB write, outcome=EXECUTED", async () => {
    const sb = makeSupabase();
    const fn = vi.fn().mockResolvedValue({ qbInvoiceId: "1" });
    const result = await withQbIdempotency(sb, null, ctx, fn);

    expect(fn).toHaveBeenCalledOnce();
    expect(result.outcome).toBe(IDEMPOTENCY_OUTCOMES.EXECUTED);
    expect(result.result).toEqual({ qbInvoiceId: "1" });
    expect(result.fromCache).toBe(false);
    expect(sb.rows.size).toBe(0); // no row written when no key
  });

  it("QI2 — first key: claims row, runs fn, persists completed with result", async () => {
    const sb = makeSupabase();
    const fn = vi.fn().mockResolvedValue({ qbInvoiceId: "INV-1" });
    const result = await withQbIdempotency(sb, "k-1", ctx, fn);

    expect(result.outcome).toBe(IDEMPOTENCY_OUTCOMES.EXECUTED);
    expect(result.result).toEqual({ qbInvoiceId: "INV-1" });
    const stored = sb.rows.get("k-1");
    expect(stored.status).toBe("completed");
    expect(stored.result).toEqual({ qbInvoiceId: "INV-1" });
    expect(stored.shop_owner).toBe(ctx.shop_owner);
    expect(stored.action).toBe(ctx.action);
  });

  it("QI3 — fn throws: row marked failed, error rethrown to caller", async () => {
    const sb = makeSupabase();
    const fn = vi.fn().mockRejectedValue(new Error("QB 500"));
    await expect(withQbIdempotency(sb, "k-fail", ctx, fn)).rejects.toThrow("QB 500");

    const stored = sb.rows.get("k-fail");
    expect(stored.status).toBe("failed");
    expect(stored.error_message).toBe("QB 500");
    expect(stored.result).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Second-call paths: CACHED, IN_FLIGHT
// ─────────────────────────────────────────────────────────────────────

describe("withQbIdempotency — replay paths (QR1–QR4)", () => {
  it("QR1 — completed prior call → returns cached result, fn NOT called", async () => {
    const sb = makeSupabase([{
      key: "k-done",
      shop_owner: ctx.shop_owner,
      action: ctx.action,
      status: "completed",
      result: { qbInvoiceId: "CACHED-9999" },
      expires_at: new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString(),
    }]);
    const fn = vi.fn();
    const result = await withQbIdempotency(sb, "k-done", ctx, fn);

    expect(fn).not.toHaveBeenCalled();
    expect(result.outcome).toBe(IDEMPOTENCY_OUTCOMES.CACHED);
    expect(result.fromCache).toBe(true);
    expect(result.result).toEqual({ qbInvoiceId: "CACHED-9999" });
  });

  it("QR2 — in_flight prior call (not expired) → IN_FLIGHT, fn NOT called", async () => {
    const sb = makeSupabase([{
      key: "k-busy",
      shop_owner: ctx.shop_owner,
      action: ctx.action,
      status: "in_flight",
      result: null,
      expires_at: new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString(),
    }]);
    const fn = vi.fn();
    const result = await withQbIdempotency(sb, "k-busy", ctx, fn);

    expect(fn).not.toHaveBeenCalled();
    expect(result.outcome).toBe(IDEMPOTENCY_OUTCOMES.IN_FLIGHT);
    expect(result.inFlight).toBe(true);
    expect(result.result).toBe(null);
  });

  it("QR3 — failed prior call → returns CACHED with null result (caller can mint new key to retry)", async () => {
    const sb = makeSupabase([{
      key: "k-bad",
      shop_owner: ctx.shop_owner,
      action: ctx.action,
      status: "failed",
      result: null,
      error_message: "previous attempt died",
      expires_at: new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString(),
    }]);
    const fn = vi.fn();
    const result = await withQbIdempotency(sb, "k-bad", ctx, fn);

    expect(fn).not.toHaveBeenCalled();
    expect(result.outcome).toBe(IDEMPOTENCY_OUTCOMES.CACHED);
    expect(result.result).toBe(null);
  });

  it("QR4b — in_flight EXPIRED but another retry won the conditional UPDATE → signal IN_FLIGHT, do NOT run fn", async () => {
    // Simulates the race the conditional UPDATE was added to close:
    // two concurrent retries both see the same expired in-flight row.
    // Whichever gets the UPDATE first wins (count=1, proceeds). The
    // loser sees count=0 and must wait — running fn() would create a
    // duplicate QB invoice.
    const rows = new Map();
    rows.set("k-race", {
      key: "k-race",
      shop_owner: ctx.shop_owner,
      action: ctx.action,
      status: "in_flight",
      result: null,
      // Already "stolen" by the winning retry: the in-flight row is
      // FRESH, not expired. Our conditional UPDATE's `.lt(expires_at,
      // now)` predicate sees no expired row → count=0 → IN_FLIGHT.
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    const sb = {
      rows,
      from() {
        return {
          insert(row) {
            return Promise.resolve({ error: { code: "23505", message: "duplicate" } });
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
            const b = {
              eq(col, val) { preds.push((r) => r[col] === val); return b; },
              lt(col, val) { preds.push((r) => r[col] < val); return b; },
              gt(col, val) { preds.push((r) => r[col] > val); return b; },
              then(resolve, reject) {
                try { resolve(exec()); } catch (e) { reject(e); }
              },
            };
            return b;
          },
          select() {
            return {
              eq(_col, key) {
                return {
                  maybeSingle: () => Promise.resolve({ data: rows.get(key) ?? null, error: null }),
                };
              },
            };
          },
        };
      },
    };
    const fn = vi.fn().mockResolvedValue({ qbInvoiceId: "WOULD_BE_DUPLICATE" });
    // The JS-side stale check would have triggered if we read the row
    // first — but the row is now fresh (just-replaced by the winner).
    // Skip the JS check by passing a manually-stale row to readExisting
    // is awkward; instead just verify the conditional UPDATE returning
    // count=0 lands as IN_FLIGHT.
    rows.set("k-race", { ...rows.get("k-race"), expires_at: new Date(Date.now() - 60_000).toISOString() });
    // Now overwrite mid-flight: another retry replaced expires_at to fresh
    // BETWEEN readExisting and our UPDATE. The conditional `.lt` on the
    // actual (fresh) row excludes it, so count=0.
    sb.from = () => ({
      insert: () => Promise.resolve({ error: { code: "23505" } }),
      update: () => {
        const b = {
          eq() { return b; },
          lt() { return b; },
          then(r) { r({ error: null, count: 0 }); },
        };
        return b;
      },
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: rows.get("k-race"), error: null }),
        }),
      }),
    });
    const result = await withQbIdempotency(sb, "k-race", ctx, fn);
    expect(fn).not.toHaveBeenCalled();
    expect(result.outcome).toBe(IDEMPOTENCY_OUTCOMES.IN_FLIGHT);
  });

  it("QR4 — in_flight EXPIRED → treated as stale, lock re-acquired, fn runs", async () => {
    const sb = makeSupabase([{
      key: "k-stale",
      shop_owner: ctx.shop_owner,
      action: ctx.action,
      status: "in_flight",
      result: null,
      expires_at: new Date(Date.now() - 60_000).toISOString(), // 1 min ago
    }]);
    const fn = vi.fn().mockResolvedValue({ qbInvoiceId: "RECOVERED" });
    const result = await withQbIdempotency(sb, "k-stale", ctx, fn);

    expect(fn).toHaveBeenCalledOnce();
    expect(result.outcome).toBe(IDEMPOTENCY_OUTCOMES.EXECUTED);
    expect(result.result).toEqual({ qbInvoiceId: "RECOVERED" });
    expect(sb.rows.get("k-stale").status).toBe("completed");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Contract / edge cases
// ─────────────────────────────────────────────────────────────────────

describe("withQbIdempotency — contracts (QC1–QC2)", () => {
  it("QC1 — ctx missing shop_owner or action with key set: throws (programming error)", async () => {
    const sb = makeSupabase();
    await expect(
      withQbIdempotency(sb, "k", {}, vi.fn()),
    ).rejects.toThrow(/shop_owner.*action/i);
  });

  it("QC2 — TTL is exactly 5 minutes", () => {
    expect(IDEMPOTENCY_TTL_MS).toBe(5 * 60 * 1000);
  });
});
