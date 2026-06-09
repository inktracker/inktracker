// Tests for the MFA client wrapper.
//
// These are CONTRACT tests on the JS layer — they pin that the wrapper
// calls the right RPC names with the right argument shapes and that
// it surfaces success / failure / error states the way Phase 2-5 UI
// will rely on. The actual SQL behavior (constant-time response,
// row-level locking on consume, hash construction) is exercised by
// the migration's RPCs themselves and validated against a preview
// deploy before the Phase 2 UI ships.

import { describe, it, expect, vi, beforeEach } from "vitest";

// The test environment is plain Node — no localStorage. Phase 3b's
// trusted-device helpers depend on it; stub it once at module load so
// `import { ... } from "../mfa.js"` and per-test reads both succeed.
const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
  clear: () => { _store.clear(); },
};

const rpcMock         = vi.fn();
const fromMock        = vi.fn();

vi.mock("@/api/supabaseClient", () => ({
  supabase: {
    rpc:  (...args) => rpcMock(...args),
    from: (...args) => fromMock(...args),
  },
}));

import {
  generateRecoveryCodes,
  consumeRecoveryCode,
  logMfaEvent,
  countUnusedRecoveryCodes,
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
});

describe("generateRecoveryCodes", () => {
  it("calls the generate_mfa_recovery_codes RPC with no args", async () => {
    rpcMock.mockResolvedValue({
      data:  { status: "ok", codes: ["AAAA-BBBB", "CCCC-DDDD"] },
      error: null,
    });
    const result = await generateRecoveryCodes();
    expect(rpcMock).toHaveBeenCalledWith("generate_mfa_recovery_codes");
    expect(result).toEqual({ ok: true, codes: ["AAAA-BBBB", "CCCC-DDDD"] });
  });

  it("returns ok:false with the error message when the RPC throws", async () => {
    rpcMock.mockResolvedValue({
      data:  null,
      error: { message: "rate limited" },
    });
    const result = await generateRecoveryCodes();
    expect(result).toEqual({ ok: false, error: "rate limited" });
  });

  it("returns ok:false when the RPC reports unauthenticated", async () => {
    // The SECURITY DEFINER function returns { status: 'unauthenticated' }
    // when auth.uid() is NULL (caller has no JWT). The wrapper must
    // surface that as a failure, not a silent success.
    rpcMock.mockResolvedValue({
      data:  { status: "unauthenticated", message: "No authenticated user" },
      error: null,
    });
    const result = await generateRecoveryCodes();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("No authenticated user");
  });

  it("returns an empty codes array when the RPC omits codes", async () => {
    // Defensive: don't let undefined.length crash the UI.
    rpcMock.mockResolvedValue({
      data:  { status: "ok" },
      error: null,
    });
    const result = await generateRecoveryCodes();
    expect(result).toEqual({ ok: true, codes: [] });
  });
});

describe("consumeRecoveryCode", () => {
  it("passes the plaintext code as p_code", async () => {
    rpcMock.mockResolvedValue({
      data:  { status: "consumed" },
      error: null,
    });
    const result = await consumeRecoveryCode("ABCDE-FGHJK");
    expect(rpcMock).toHaveBeenCalledWith("consume_mfa_recovery_code", {
      p_code: "ABCDE-FGHJK",
    });
    expect(result).toEqual({ ok: true });
  });

  it("returns ok:false with 'invalid' when the code didn't match", async () => {
    rpcMock.mockResolvedValue({
      data:  { status: "invalid" },
      error: null,
    });
    const result = await consumeRecoveryCode("WRONG-CODE");
    expect(result).toEqual({ ok: false, error: "invalid" });
  });

  it("surfaces network/error responses", async () => {
    rpcMock.mockResolvedValue({
      data:  null,
      error: { message: "network" },
    });
    const result = await consumeRecoveryCode("ANYTHING");
    expect(result).toEqual({ ok: false, error: "network" });
  });

  it("treats unauthenticated as failure", async () => {
    rpcMock.mockResolvedValue({
      data:  { status: "unauthenticated" },
      error: null,
    });
    const result = await consumeRecoveryCode("X");
    expect(result.ok).toBe(false);
  });
});

describe("logMfaEvent", () => {
  it("calls log_mfa_event with all four parameters in the expected shape", async () => {
    rpcMock.mockResolvedValue({
      data:  { status: "ok" },
      error: null,
    });
    const result = await logMfaEvent("enrolled", {
      ipAddress: "1.2.3.4",
      userAgent: "Mozilla/5.0",
      metadata:  { factor_id: "f1" },
    });
    expect(rpcMock).toHaveBeenCalledWith("log_mfa_event", {
      p_event:      "enrolled",
      p_ip_address: "1.2.3.4",
      p_user_agent: "Mozilla/5.0",
      p_metadata:   { factor_id: "f1" },
    });
    expect(result).toEqual({ ok: true });
  });

  it("defaults all optional params to null when omitted", async () => {
    rpcMock.mockResolvedValue({
      data:  { status: "ok" },
      error: null,
    });
    await logMfaEvent("disabled");
    expect(rpcMock).toHaveBeenCalledWith("log_mfa_event", {
      p_event:      "disabled",
      p_ip_address: null,
      p_user_agent: null,
      p_metadata:   null,
    });
  });

  it("surfaces RPC errors", async () => {
    rpcMock.mockResolvedValue({
      data:  null,
      error: { message: "check constraint violation" },
    });
    const result = await logMfaEvent("invalid_event_name");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("check");
  });
});

describe("countUnusedRecoveryCodes", () => {
  it("queries mfa_recovery_codes with a head-only count + null filter", async () => {
    const isMock     = vi.fn().mockResolvedValue({ count: 7, error: null });
    const selectMock = vi.fn().mockReturnValue({ is: isMock });
    fromMock.mockReturnValue({ select: selectMock });

    const result = await countUnusedRecoveryCodes();
    expect(fromMock).toHaveBeenCalledWith("mfa_recovery_codes");
    expect(selectMock).toHaveBeenCalledWith("*", { count: "exact", head: true });
    expect(isMock).toHaveBeenCalledWith("consumed_at", null);
    expect(result).toEqual({ ok: true, count: 7 });
  });

  it("returns 0 when there are no unused codes (count == 0)", async () => {
    const isMock     = vi.fn().mockResolvedValue({ count: 0, error: null });
    fromMock.mockReturnValue({ select: () => ({ is: isMock }) });

    const result = await countUnusedRecoveryCodes();
    expect(result).toEqual({ ok: true, count: 0 });
  });

  it("returns 0 when count is null (Supabase response edge case)", async () => {
    const isMock     = vi.fn().mockResolvedValue({ count: null, error: null });
    fromMock.mockReturnValue({ select: () => ({ is: isMock }) });

    const result = await countUnusedRecoveryCodes();
    expect(result).toEqual({ ok: true, count: 0 });
  });

  it("surfaces query errors", async () => {
    const isMock     = vi.fn().mockResolvedValue({ count: null, error: { message: "RLS denied" } });
    fromMock.mockReturnValue({ select: () => ({ is: isMock }) });

    const result = await countUnusedRecoveryCodes();
    expect(result).toEqual({ ok: false, error: "RLS denied" });
  });
});

describe("listMfaAuditEvents", () => {
  it("queries mfa_audit_log ordered by created_at desc with default limit", async () => {
    const events = [
      { event: "enrolled",          ip_address: null, user_agent: null, metadata: null, created_at: "2026-06-08" },
      { event: "challenge_succeeded", ip_address: "1.2.3.4", user_agent: "Mac", metadata: null, created_at: "2026-06-07" },
    ];
    const limitMock = vi.fn().mockResolvedValue({ data: events, error: null });
    const orderMock = vi.fn().mockReturnValue({ limit: limitMock });
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

    const result = await listMfaAuditEvents();
    expect(result).toEqual({ ok: true, events: [] });
  });

  it("surfaces query errors", async () => {
    const limitMock = vi.fn().mockResolvedValue({ data: null, error: { message: "denied" } });
    fromMock.mockReturnValue({ select: () => ({ order: () => ({ limit: limitMock }) }) });

    const result = await listMfaAuditEvents();
    expect(result).toEqual({ ok: false, error: "denied" });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Phase 3b — trusted device wrapper.
//
// Pins: localStorage read/write, RPC call shapes, stale-token cleanup,
// and the "registration fails → drop the local token" guarantee.

describe("trusted device — getLocalTrustedDeviceToken", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when no token is stored", () => {
    expect(getLocalTrustedDeviceToken()).toBeNull();
  });

  it("returns the stored token verbatim", () => {
    localStorage.setItem(TRUSTED_DEVICE_STORAGE_KEY, "abc-def-123");
    expect(getLocalTrustedDeviceToken()).toBe("abc-def-123");
  });
});

describe("registerTrustedDevice", () => {
  beforeEach(() => {
    localStorage.clear();
    if (!globalThis.crypto) globalThis.crypto = {};
    globalThis.crypto.randomUUID = vi.fn(() => "00000000-1111-2222-3333-444444444444");
  });

  it("mints a token, calls register_mfa_trusted_device with token + label", async () => {
    rpcMock.mockResolvedValue({
      data:  { status: "ok", id: "row-1" },
      error: null,
    });
    const result = await registerTrustedDevice("Chrome on macOS");
    expect(rpcMock).toHaveBeenCalledWith("register_mfa_trusted_device", {
      p_token: "00000000-1111-2222-3333-444444444444",
      p_device_label: "Chrome on macOS",
    });
    expect(localStorage.getItem(TRUSTED_DEVICE_STORAGE_KEY))
      .toBe("00000000-1111-2222-3333-444444444444");
    expect(result).toEqual({ ok: true, id: "row-1" });
  });

  it("drops the local token when the RPC returns an error", async () => {
    rpcMock.mockResolvedValue({
      data:  null,
      error: { message: "rate limited" },
    });
    const result = await registerTrustedDevice("Chrome");
    expect(localStorage.getItem(TRUSTED_DEVICE_STORAGE_KEY)).toBeNull();
    expect(result).toEqual({ ok: false, error: "rate limited" });
  });

  it("drops the local token when the RPC returns non-ok status", async () => {
    rpcMock.mockResolvedValue({
      data:  { status: "unauthenticated" },
      error: null,
    });
    const result = await registerTrustedDevice("Chrome");
    expect(localStorage.getItem(TRUSTED_DEVICE_STORAGE_KEY)).toBeNull();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unauthenticated");
  });

  it("passes null label when none supplied", async () => {
    rpcMock.mockResolvedValue({ data: { status: "ok", id: "row-2" }, error: null });
    await registerTrustedDevice();
    expect(rpcMock).toHaveBeenCalledWith("register_mfa_trusted_device", {
      p_token: expect.any(String),
      p_device_label: null,
    });
  });
});

describe("checkLocalTrustedDevice", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns trusted:false without an RPC call when no token is stored", async () => {
    const result = await checkLocalTrustedDevice();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, trusted: false });
  });

  it("returns trusted:true when the RPC confirms the token", async () => {
    localStorage.setItem(TRUSTED_DEVICE_STORAGE_KEY, "valid-token");
    rpcMock.mockResolvedValue({
      data:  { status: "ok", trusted: true },
      error: null,
    });
    const result = await checkLocalTrustedDevice();
    expect(rpcMock).toHaveBeenCalledWith("check_mfa_trusted_device", {
      p_token: "valid-token",
    });
    expect(result).toEqual({ ok: true, trusted: true });
    expect(localStorage.getItem(TRUSTED_DEVICE_STORAGE_KEY)).toBe("valid-token");
  });

  it("drops the local token when the RPC says not_trusted (expired or revoked)", async () => {
    localStorage.setItem(TRUSTED_DEVICE_STORAGE_KEY, "stale-token");
    rpcMock.mockResolvedValue({
      data:  { status: "not_trusted", trusted: false },
      error: null,
    });
    const result = await checkLocalTrustedDevice();
    expect(result).toEqual({ ok: true, trusted: false });
    expect(localStorage.getItem(TRUSTED_DEVICE_STORAGE_KEY)).toBeNull();
  });

  it("preserves the token on a network error (lets caller retry later)", async () => {
    localStorage.setItem(TRUSTED_DEVICE_STORAGE_KEY, "x");
    rpcMock.mockResolvedValue({
      data:  null,
      error: { message: "network" },
    });
    const result = await checkLocalTrustedDevice();
    expect(result).toEqual({ ok: false, error: "network" });
    expect(localStorage.getItem(TRUSTED_DEVICE_STORAGE_KEY)).toBe("x");
  });
});

describe("listTrustedDevices", () => {
  it("reads mfa_trusted_devices ordered by created_at desc", async () => {
    const orderMock = vi.fn().mockResolvedValue({
      data:  [{ id: "d1" }, { id: "d2" }],
      error: null,
    });
    const selectMock = vi.fn().mockReturnValue({ order: orderMock });
    fromMock.mockReturnValue({ select: selectMock });

    const result = await listTrustedDevices();
    expect(fromMock).toHaveBeenCalledWith("mfa_trusted_devices");
    expect(selectMock).toHaveBeenCalledWith("id, device_label, last_used_at, expires_at, created_at");
    expect(orderMock).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(result).toEqual({ ok: true, devices: [{ id: "d1" }, { id: "d2" }] });
  });
});

describe("revokeTrustedDevice", () => {
  it("calls revoke_mfa_trusted_device with the row id", async () => {
    rpcMock.mockResolvedValue({ data: { status: "ok" }, error: null });
    const result = await revokeTrustedDevice("row-3");
    expect(rpcMock).toHaveBeenCalledWith("revoke_mfa_trusted_device", { p_id: "row-3" });
    expect(result).toEqual({ ok: true });
  });

  it("surfaces 'not_found' as a failure", async () => {
    rpcMock.mockResolvedValue({ data: { status: "not_found" }, error: null });
    const result = await revokeTrustedDevice("missing");
    expect(result).toEqual({ ok: false, error: "not_found" });
  });
});

describe("revokeAllTrustedDevices", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(TRUSTED_DEVICE_STORAGE_KEY, "still-here");
  });

  it("calls the bulk revoke RPC and clears the local token", async () => {
    rpcMock.mockResolvedValue({
      data:  { status: "ok", count: 3 },
      error: null,
    });
    const result = await revokeAllTrustedDevices();
    expect(rpcMock).toHaveBeenCalledWith("revoke_all_mfa_trusted_devices");
    expect(result).toEqual({ ok: true, count: 3 });
    expect(localStorage.getItem(TRUSTED_DEVICE_STORAGE_KEY)).toBeNull();
  });

  it("returns count=0 when the RPC doesn't supply one", async () => {
    rpcMock.mockResolvedValue({ data: { status: "ok" }, error: null });
    const result = await revokeAllTrustedDevices();
    expect(result).toEqual({ ok: true, count: 0 });
  });
});
