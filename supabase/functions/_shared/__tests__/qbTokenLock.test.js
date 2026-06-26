import { describe, it, expect, vi } from "vitest";
import { claimRefreshLease, refreshQbTokenSerialized } from "../qbTokenLock.js";

// Chainable mock of the supabase admin query builder. `queue` holds the result
// returned by each TERMINAL op in call order: claim ends with .select(),
// release ends by awaiting the chain (.then). Records update() payloads.
function makeAdmin(queue = []) {
  let i = 0;
  const updates = [];
  const next = () => (i < queue.length ? queue[i++] : { data: [], error: null });
  const chain = {
    from() { return chain; },
    update(payload) { updates.push(payload); return chain; },
    eq() { return chain; },
    or() { return chain; },
    select() { return Promise.resolve(next()); },
    then(res, rej) { return Promise.resolve(next()).then(res, rej); },
  };
  chain._updates = updates;
  return chain;
}

const FRESH = { access_token: "NEW_ACC", refresh_token: "NEW_REF", expires_in: 3600 };
const buildFields = (fresh, prev) => ({
  qb_access_token: fresh.access_token,
  qb_refresh_token: fresh.refresh_token ?? prev,
  qb_token_expires_at: "2026-09-01T00:00:00.000Z",
});
const baseDeps = (over = {}) => ({
  decideRefresh: vi.fn(() => true),
  refreshFn: vi.fn(async () => FRESH),
  buildFields,
  persist: vi.fn(async () => {}),
  reload: vi.fn(async () => null),
  sleepFn: () => Promise.resolve(),
  nowFn: () => 1_000_000,
  ...over,
});

const PROFILE = {
  id: "p1", qb_access_token: "OLD_ACC", qb_refresh_token: "OLD_REF",
  qb_token_expires_at: "2026-01-01T00:00:00.000Z", qb_realm_id: "R1",
};

describe("claimRefreshLease", () => {
  it("returns true when the conditional update affects a row", async () => {
    const admin = makeAdmin([{ data: [{ profile_id: "p1" }], error: null }]);
    expect(await claimRefreshLease(admin, "p1", 1_000_000)).toBe(true);
    expect(admin._updates[0]).toHaveProperty("qb_token_refresh_lock");
  });
  it("returns false when no row was claimed (someone else holds it)", async () => {
    const admin = makeAdmin([{ data: [], error: null }]);
    expect(await claimRefreshLease(admin, "p1")).toBe(false);
  });
  it("returns false on error (caller falls back to unlocked refresh)", async () => {
    const admin = makeAdmin([{ data: null, error: { message: "boom" } }]);
    expect(await claimRefreshLease(admin, "p1")).toBe(false);
  });
});

describe("refreshQbTokenSerialized", () => {
  it("short-circuits when the token isn't near expiry (no refresh, no lease)", async () => {
    const deps = baseDeps({ decideRefresh: vi.fn(() => false) });
    const admin = makeAdmin();
    const out = await refreshQbTokenSerialized(admin, PROFILE, deps);
    expect(out).toEqual({ accessToken: "OLD_ACC", realmId: "R1" });
    expect(deps.refreshFn).not.toHaveBeenCalled();
    expect(admin._updates).toHaveLength(0);
  });

  it("winner refreshes, persists, and clears the lease in the same write", async () => {
    const deps = baseDeps();
    const admin = makeAdmin([{ data: [{ profile_id: "p1" }], error: null }]); // claim acquired
    const out = await refreshQbTokenSerialized(admin, PROFILE, deps);
    expect(out.accessToken).toBe("NEW_ACC");
    expect(deps.refreshFn).toHaveBeenCalledWith("OLD_REF");
    expect(deps.persist).toHaveBeenCalledTimes(1);
    // persisted fields include the rotated token AND a null lock
    const [, fields] = deps.persist.mock.calls[0];
    expect(fields.qb_access_token).toBe("NEW_ACC");
    expect(fields.qb_token_refresh_lock).toBeNull();
  });

  it("contended loser reuses the winner's freshly-persisted token (no second refresh)", async () => {
    // decideRefresh: stale initially, fresh after reload.
    const decideRefresh = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const reload = vi.fn(async () => ({ ...PROFILE, qb_access_token: "WINNER_ACC", qb_token_expires_at: "2026-12-01T00:00:00.000Z" }));
    const deps = baseDeps({ decideRefresh, reload });
    const admin = makeAdmin([{ data: [], error: null }]); // claim NOT acquired
    const out = await refreshQbTokenSerialized(admin, PROFILE, deps);
    expect(out.accessToken).toBe("WINNER_ACC");
    expect(deps.refreshFn).not.toHaveBeenCalled();
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("releases the lease and rethrows when the refresh itself fails", async () => {
    const err = new Error("invalid_grant");
    const deps = baseDeps({ refreshFn: vi.fn(async () => { throw err; }) });
    // claim acquired, then a release write (awaited).
    const admin = makeAdmin([{ data: [{ profile_id: "p1" }], error: null }, { data: [], error: null }]);
    await expect(refreshQbTokenSerialized(admin, PROFILE, deps)).rejects.toThrow("invalid_grant");
    // last update cleared the lease
    expect(admin._updates.at(-1)).toEqual({ qb_token_refresh_lock: null });
  });

  it("last-resort: refreshes unlocked rather than hard-failing on persistent contention", async () => {
    const decideRefresh = vi.fn(() => true);          // never becomes fresh
    const reload = vi.fn(async () => PROFILE);          // reload stays stale
    const deps = baseDeps({ decideRefresh, reload });
    const admin = makeAdmin([
      { data: [], error: null }, { data: [], error: null }, { data: [], error: null },
      { data: [], error: null }, { data: [], error: null },                         // 5 failed claims
    ]);
    const out = await refreshQbTokenSerialized(admin, PROFILE, deps);
    expect(out.accessToken).toBe("NEW_ACC");
    expect(deps.refreshFn).toHaveBeenCalledTimes(1); // single fallback refresh
    expect(deps.persist).toHaveBeenCalledTimes(1);
  });
});
