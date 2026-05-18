import { describe, it, expect, vi, beforeEach } from "vitest";

// We mock the supabaseClient module so we can stub both `supabase.auth` and
// `base44.functions.invoke` without touching real I/O. The contract under
// test is the wrapper around base44.functions.invoke — we want to lock in
// that it goes through that helper (auth header included automatically),
// not through a raw fetch (which silently fails at the Supabase gateway
// with UNAUTHORIZED_NO_AUTH_HEADER — the 2026-05-18 regression).
const invokeMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock("@/api/supabaseClient", () => ({
  base44:   { functions: { invoke: (...args) => invokeMock(...args) } },
  supabase: { auth:      { getSession: (...args) => getSessionMock(...args) } },
}));

import { syncCustomerToQB } from "../qbCustomerSync.js";

beforeEach(() => {
  invokeMock.mockReset();
  getSessionMock.mockReset();
});

describe("syncCustomerToQB", () => {
  it("returns skipped without an invoke when customer.id is missing", async () => {
    const result = await syncCustomerToQB({ name: "no id" });
    expect(result).toEqual({ skipped: true, reason: "no customer id" });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns skipped without an invoke when there's no session", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    const result = await syncCustomerToQB({ id: "c1", name: "Acme" });
    expect(result).toEqual({ skipped: true, reason: "not signed in" });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("invokes qbSync with action=syncCustomer + accessToken + customer", async () => {
    // This is the contract that prevents the auth-header regression: we
    // MUST go through base44.functions.invoke (which sets Authorization
    // automatically), not raw fetch.
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "tok-123" } } });
    invokeMock.mockResolvedValue({ data: { qbCustomerId: "qb-42" }, error: null });

    const customer = { id: "c1", name: "Acme", email: "a@b.co" };
    const result = await syncCustomerToQB(customer);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("qbSync", {
      action: "syncCustomer",
      accessToken: "tok-123",
      customer,
    });
    expect(result).toEqual({ qbCustomerId: "qb-42" });
  });

  it("returns skipped (does NOT throw) when invoke returns an error", async () => {
    // Fire-and-forget contract — the caller's save flow must not be
    // blocked by a QB sync hiccup.
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "tok" } } });
    invokeMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    const result = await syncCustomerToQB({ id: "c1" });
    expect(result).toEqual({ skipped: true, reason: "boom" });
  });

  it("returns skipped when the data payload itself carries an error field", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "tok" } } });
    invokeMock.mockResolvedValue({ data: { error: "QuickBooks not connected" }, error: null });

    const result = await syncCustomerToQB({ id: "c1" });
    expect(result).toEqual({ skipped: true, reason: "QuickBooks not connected" });
  });

  it("returns skipped (does NOT throw) when the invoke promise itself rejects", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "tok" } } });
    invokeMock.mockRejectedValue(new Error("network down"));

    const result = await syncCustomerToQB({ id: "c1" });
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("network down");
  });
});
