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
