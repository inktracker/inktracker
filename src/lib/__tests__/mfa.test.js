// Contract tests for the MFA wrapper.
//
// Pins the argument shapes + status-code interpretation for every
// exported function. The actual SQL behavior (rate limits, expiry,
// hash construction) is exercised by the RPC functions themselves
// and verified live against a real signed-in test user before deploy.

import { describe, it, expect, vi, beforeEach } from "vitest";

// The test environment is plain Node — no localStorage. Phase 3b's
// trusted-device helpers depend on it; stub it once at module load so
// both `import { ... }` and per-test reads succeed.
const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
  clear: () => { _store.clear(); },
};

const rpcMock         = vi.fn();
const fromMock        = vi.fn();
const invokeMock      = vi.fn();
const getUserMock     = vi.fn();

vi.mock("@/api/supabaseClient", () => ({
  supabase: {
    rpc:  (...args) => rpcMock(...args),
    from: (...args) => fromMock(...args),
    functions: { invoke: (...args) => invokeMock(...args) },
    auth: { getUser: (...args) => getUserMock(...args) },
  },
}));

import {
  isMfaEmailEnabled,
  isMfaEmailEnabledForCurrentSession,
  enableMfaEmail,
  disableMfaEmail,
  requestMfaSignInCode,
  verifyMfaSignInCode,
  logMfaEvent,
  listMfaAuditEvents,
  TRUSTED_DEVICE_STORAGE_KEY,
  getLocalTrustedDeviceToken,
  registerTrustedDevice,
  checkLocalTrustedDevice,
  listTrustedDevices,
  revokeTrustedDevice,
  revokeAllTrustedDevices,
} from "../mfa.js";

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
  invokeMock.mockReset();
  getUserMock.mockReset();
});

// ─────────────────────────────────────────────────────────────────────
// Email-MFA flag

describe("isMfaEmailEnabled", () => {
  it("returns enabled:false when there is no signed-in user", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const result = await isMfaEmailEnabled();
    expect(result).toEqual({ ok: true, enabled: false });
  });

  it("reads profiles.mfa_email_enabled for the current user", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: { mfa_email_enabled: true }, error: null });
    const eqMock          = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock      = vi.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ select: selectMock });

    const result = await isMfaEmailEnabled();
    expect(fromMock).toHaveBeenCalledWith("profiles");
    expect(selectMock).toHaveBeenCalledWith("mfa_email_enabled");
    expect(eqMock).toHaveBeenCalledWith("auth_id", "u-1");
    expect(result).toEqual({ ok: true, enabled: true });
  });

  it("returns enabled:false when the profile row is missing", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
    fromMock.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    });
    const result = await isMfaEmailEnabled();
    expect(result).toEqual({ ok: true, enabled: false });
  });

  it("surfaces query errors", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
    fromMock.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: "denied" } }) }) }),
    });
    const result = await isMfaEmailEnabled();
    expect(result).toEqual({ ok: false, error: "denied" });
  });

  it("surfaces auth.getUser errors", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: "auth_broken" } });
    const result = await isMfaEmailEnabled();
    expect(result).toEqual({ ok: false, error: "auth_broken" });
  });
});

describe("isMfaEmailEnabledForCurrentSession", () => {
  it("returns true when the profile flag is set", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u-1" } } });
    fromMock.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { mfa_email_enabled: true } }) }) }),
    });
    expect(await isMfaEmailEnabledForCurrentSession()).toBe(true);
  });

  it("returns false on network failure (under-protect rather than block)", async () => {
    getUserMock.mockRejectedValue(new Error("network"));
    expect(await isMfaEmailEnabledForCurrentSession()).toBe(false);
  });

  it("returns false when no user is signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    expect(await isMfaEmailEnabledForCurrentSession()).toBe(false);
  });
});

describe("enableMfaEmail", () => {
  it("calls enable_mfa_email and returns ok on success", async () => {
    rpcMock.mockResolvedValue({ data: { status: "ok" }, error: null });
    const result = await enableMfaEmail();
    expect(rpcMock).toHaveBeenCalledWith("enable_mfa_email");
    expect(result).toEqual({ ok: true });
  });

  it("returns ok:false with the RPC status on non-ok response", async () => {
    rpcMock.mockResolvedValue({ data: { status: "no_profile" }, error: null });
    const result = await enableMfaEmail();
    expect(result).toEqual({ ok: false, error: "no_profile" });
  });

  it("surfaces error responses", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await enableMfaEmail();
    expect(result).toEqual({ ok: false, error: "boom" });
  });
});

describe("disableMfaEmail", () => {
  it("calls disable_mfa_email", async () => {
    rpcMock.mockResolvedValue({ data: { status: "ok" }, error: null });
    const result = await disableMfaEmail();
    expect(rpcMock).toHaveBeenCalledWith("disable_mfa_email");
    expect(result).toEqual({ ok: true });
  });

  it("surfaces non-ok status as error", async () => {
    rpcMock.mockResolvedValue({ data: { status: "unauthenticated" }, error: null });
    const result = await disableMfaEmail();
    expect(result).toEqual({ ok: false, error: "unauthenticated" });
  });
});

describe("requestMfaSignInCode", () => {
  it("invokes the sendMfaSignInCode edge function with an empty body", async () => {
    invokeMock.mockResolvedValue({ data: { status: "ok" }, error: null });
    const result = await requestMfaSignInCode();
    expect(invokeMock).toHaveBeenCalledWith("sendMfaSignInCode", { body: {} });
    expect(result).toEqual({ ok: true });
  });

  it("surfaces rate_limited with retryAfterSeconds for the countdown", async () => {
    invokeMock.mockResolvedValue({
      data: { status: "rate_limited", retry_after_seconds: 42 },
      error: null,
    });
    const result = await requestMfaSignInCode();
    expect(result).toEqual({ ok: false, error: "rate_limited", retryAfterSeconds: 42 });
  });

  it("returns ok:false with edge-function error message on hard failure", async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await requestMfaSignInCode();
    expect(result).toEqual({ ok: false, error: "boom" });
  });

  it("returns ok:false when the response body has no data", async () => {
    invokeMock.mockResolvedValue({ data: null, error: null });
    const result = await requestMfaSignInCode();
    expect(result).toEqual({ ok: false, error: "no_response" });
  });
});

describe("verifyMfaSignInCode", () => {
  it("calls verify_mfa_signin_code with p_code", async () => {
    rpcMock.mockResolvedValue({ data: { status: "ok" }, error: null });
    const result = await verifyMfaSignInCode("123456");
    expect(rpcMock).toHaveBeenCalledWith("verify_mfa_signin_code", { p_code: "123456" });
    expect(result).toEqual({ ok: true });
  });

  it("surfaces 'expired' and 'invalid' as the failure error", async () => {
    for (const status of ["expired", "invalid"]) {
      rpcMock.mockResolvedValueOnce({ data: { status }, error: null });
      const r = await verifyMfaSignInCode("999999");
      expect(r).toEqual({ ok: false, error: status });
    }
  });

  it("surfaces network errors", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "network" } });
    const result = await verifyMfaSignInCode("000000");
    expect(result).toEqual({ ok: false, error: "network" });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Audit log

describe("logMfaEvent", () => {
  it("calls log_mfa_event with all four parameters in the expected shape", async () => {
    rpcMock.mockResolvedValue({ data: { status: "ok" }, error: null });
    const result = await logMfaEvent("lockout", {
      ipAddress: "1.2.3.4",
      userAgent: "Mozilla/5.0",
      metadata: { attempts: 10 },
    });
    expect(rpcMock).toHaveBeenCalledWith("log_mfa_event", {
      p_event: "lockout",
      p_ip_address: "1.2.3.4",
      p_user_agent: "Mozilla/5.0",
      p_metadata: { attempts: 10 },
    });
    expect(result).toEqual({ ok: true });
  });

  it("defaults all optional params to null", async () => {
    rpcMock.mockResolvedValue({ data: { status: "ok" }, error: null });
    await logMfaEvent("session_invalidated");
    expect(rpcMock).toHaveBeenCalledWith("log_mfa_event", {
      p_event: "session_invalidated",
      p_ip_address: null,
      p_user_agent: null,
      p_metadata: null,
    });
  });
});

describe("listMfaAuditEvents", () => {
  it("queries mfa_audit_log ordered by created_at desc with default limit", async () => {
    const events = [{ event: "mfa_enabled", created_at: "2026-06-08" }];
    const limitMock  = vi.fn().mockResolvedValue({ data: events, error: null });
    const orderMock  = vi.fn().mockReturnValue({ limit: limitMock });
    const selectMock = vi.fn().mockReturnValue({ order: orderMock });
    fromMock.mockReturnValue({ select: selectMock });

    const result = await listMfaAuditEvents();
    expect(fromMock).toHaveBeenCalledWith("mfa_audit_log");
    expect(selectMock).toHaveBeenCalledWith("event, ip_address, user_agent, metadata, created_at");
    expect(orderMock).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(limitMock).toHaveBeenCalledWith(20);
    expect(result).toEqual({ ok: true, events });
  });

  it("honors a custom limit", async () => {
    const limitMock = vi.fn().mockResolvedValue({ data: [], error: null });
    fromMock.mockReturnValue({ select: () => ({ order: () => ({ limit: limitMock }) }) });
    await listMfaAuditEvents(5);
    expect(limitMock).toHaveBeenCalledWith(5);
  });

  it("returns empty list when data is null", async () => {
    const limitMock = vi.fn().mockResolvedValue({ data: null, error: null });
    fromMock.mockReturnValue({ select: () => ({ order: () => ({ limit: limitMock }) }) });
    expect(await listMfaAuditEvents()).toEqual({ ok: true, events: [] });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Trusted device (Phase 3b — unchanged contract)

describe("trusted device — getLocalTrustedDeviceToken", () => {
  beforeEach(() => { localStorage.clear(); });
  it("returns null when no token is stored", () => {
    expect(getLocalTrustedDeviceToken()).toBeNull();
  });
  it("returns the stored token verbatim", () => {
    localStorage.setItem(TRUSTED_DEVICE_STORAGE_KEY, "abc");
    expect(getLocalTrustedDeviceToken()).toBe("abc");
  });
});

describe("registerTrustedDevice", () => {
  beforeEach(() => {
    localStorage.clear();
    if (!globalThis.crypto) globalThis.crypto = {};
    globalThis.crypto.randomUUID = vi.fn(() => "00000000-1111-2222-3333-444444444444");
  });

  it("mints a token, calls register_mfa_trusted_device with token + label", async () => {
    rpcMock.mockResolvedValue({ data: { status: "ok", id: "row-1" }, error: null });
    const result = await registerTrustedDevice("Chrome on macOS");
    expect(rpcMock).toHaveBeenCalledWith("register_mfa_trusted_device", {
      p_token: "00000000-1111-2222-3333-444444444444",
      p_device_label: "Chrome on macOS",
    });
    expect(localStorage.getItem(TRUSTED_DEVICE_STORAGE_KEY)).toBe("00000000-1111-2222-3333-444444444444");
    expect(result).toEqual({ ok: true, id: "row-1" });
  });

  it("drops the local token when the RPC returns an error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "rate limited" } });
    await registerTrustedDevice("Chrome");
    expect(localStorage.getItem(TRUSTED_DEVICE_STORAGE_KEY)).toBeNull();
  });

  it("drops the local token when the RPC returns non-ok status", async () => {
    rpcMock.mockResolvedValue({ data: { status: "unauthenticated" }, error: null });
    await registerTrustedDevice("Chrome");
    expect(localStorage.getItem(TRUSTED_DEVICE_STORAGE_KEY)).toBeNull();
  });
});

describe("checkLocalTrustedDevice", () => {
  beforeEach(() => { localStorage.clear(); });

  it("returns trusted:false without an RPC call when no token is stored", async () => {
    const result = await checkLocalTrustedDevice();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, trusted: false });
  });

  it("returns trusted:true when the RPC confirms the token", async () => {
    localStorage.setItem(TRUSTED_DEVICE_STORAGE_KEY, "valid-token");
    rpcMock.mockResolvedValue({ data: { status: "ok", trusted: true }, error: null });
    const result = await checkLocalTrustedDevice();
    expect(rpcMock).toHaveBeenCalledWith("check_mfa_trusted_device", { p_token: "valid-token" });
    expect(result).toEqual({ ok: true, trusted: true });
  });

  it("drops the local token when the RPC says not_trusted", async () => {
    localStorage.setItem(TRUSTED_DEVICE_STORAGE_KEY, "stale-token");
    rpcMock.mockResolvedValue({ data: { status: "not_trusted", trusted: false }, error: null });
    await checkLocalTrustedDevice();
    expect(localStorage.getItem(TRUSTED_DEVICE_STORAGE_KEY)).toBeNull();
  });

  it("preserves the token on a network error", async () => {
    localStorage.setItem(TRUSTED_DEVICE_STORAGE_KEY, "x");
    rpcMock.mockResolvedValue({ data: null, error: { message: "network" } });
    const result = await checkLocalTrustedDevice();
    expect(result).toEqual({ ok: false, error: "network" });
    expect(localStorage.getItem(TRUSTED_DEVICE_STORAGE_KEY)).toBe("x");
  });
});

describe("listTrustedDevices", () => {
  it("reads mfa_trusted_devices ordered by created_at desc", async () => {
    const orderMock  = vi.fn().mockResolvedValue({ data: [{ id: "d1" }], error: null });
    const selectMock = vi.fn().mockReturnValue({ order: orderMock });
    fromMock.mockReturnValue({ select: selectMock });

    const result = await listTrustedDevices();
    expect(fromMock).toHaveBeenCalledWith("mfa_trusted_devices");
    expect(selectMock).toHaveBeenCalledWith("id, device_label, last_used_at, expires_at, created_at");
    expect(orderMock).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(result).toEqual({ ok: true, devices: [{ id: "d1" }] });
  });
});

describe("revokeTrustedDevice", () => {
  it("calls revoke_mfa_trusted_device with the row id", async () => {
    rpcMock.mockResolvedValue({ data: { status: "ok" }, error: null });
    const result = await revokeTrustedDevice("row-3");
    expect(rpcMock).toHaveBeenCalledWith("revoke_mfa_trusted_device", { p_id: "row-3" });
    expect(result).toEqual({ ok: true });
  });
});

describe("revokeAllTrustedDevices", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(TRUSTED_DEVICE_STORAGE_KEY, "still-here");
  });

  it("calls the bulk revoke RPC and clears the local token", async () => {
    rpcMock.mockResolvedValue({ data: { status: "ok", count: 3 }, error: null });
    const result = await revokeAllTrustedDevices();
    expect(rpcMock).toHaveBeenCalledWith("revoke_all_mfa_trusted_devices");
    expect(result).toEqual({ ok: true, count: 3 });
    expect(localStorage.getItem(TRUSTED_DEVICE_STORAGE_KEY)).toBeNull();
  });
});
