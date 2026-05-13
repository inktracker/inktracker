import { describe, it, expect } from "vitest";
import {
  interpretActivationResponse,
  activationRetryDelayMs,
  ACTIVATION_STATES,
  MAX_ACTIVATION_ATTEMPTS,
} from "../trialActivation";

describe("interpretActivationResponse — happy paths", () => {
  it("maps status='activated' to SUCCESS (non-retryable)", () => {
    const r = interpretActivationResponse({
      rpcResult: { status: "activated", role: "shop" },
      rpcError: null,
    });
    expect(r.state).toBe(ACTIVATION_STATES.SUCCESS);
    expect(r.retryable).toBe(false);
  });

  it("maps status='already_active' to SUCCESS (idempotent re-call after trigger ran)", () => {
    // This is the COMMON case after the migration — the trigger
    // sets role='shop' on signup, so any client-side activate_trial
    // call lands here.
    const r = interpretActivationResponse({
      rpcResult: {
        status: "already_active",
        role: "shop",
        subscription_tier: "trial",
        trial_ends_at: "2026-05-26T07:22:21Z",
      },
      rpcError: null,
    });
    expect(r.state).toBe(ACTIVATION_STATES.SUCCESS);
    expect(r.retryable).toBe(false);
  });
});

describe("interpretActivationResponse — permanent failures", () => {
  it("maps status='no_profile' to PERMANENT — auth row exists but no profile row", () => {
    const r = interpretActivationResponse({
      rpcResult: { status: "no_profile", message: "No profile row found" },
      rpcError: null,
    });
    expect(r.state).toBe(ACTIVATION_STATES.PERMANENT);
    expect(r.retryable).toBe(false);
    expect(r.message).toMatch(/profile/);
    expect(r.message).toMatch(/joe@biotamfg.co/); // user has an action to take
  });

  it("maps status='wrong_role' to PERMANENT — broker/employee/manager", () => {
    const r = interpretActivationResponse({
      rpcResult: {
        status: "wrong_role",
        role: "broker",
        message: "This account is a broker — activate_trial does not apply",
      },
      rpcError: null,
    });
    expect(r.state).toBe(ACTIVATION_STATES.PERMANENT);
    expect(r.retryable).toBe(false);
    expect(r.message).toMatch(/broker/);
  });

  it("maps status='bad_input' to PERMANENT — caller bug, do not auto-retry", () => {
    const r = interpretActivationResponse({
      rpcResult: { status: "bad_input" },
      rpcError: null,
    });
    expect(r.state).toBe(ACTIVATION_STATES.PERMANENT);
    expect(r.retryable).toBe(false);
  });
});

describe("interpretActivationResponse — transient failures (retryable)", () => {
  it("maps a 'fetch failed' supabase error to RETRYABLE", () => {
    const r = interpretActivationResponse({
      rpcResult: null,
      rpcError: { message: "TypeError: Failed to fetch" },
    });
    expect(r.state).toBe(ACTIVATION_STATES.RETRYABLE);
    expect(r.retryable).toBe(true);
    expect(r.message).toMatch(/Failed to fetch/);
  });

  it("maps a 'network' error to RETRYABLE", () => {
    const r = interpretActivationResponse({
      rpcResult: null,
      rpcError: { message: "NetworkError when attempting to fetch resource" },
    });
    expect(r.state).toBe(ACTIVATION_STATES.RETRYABLE);
  });

  it("maps a 'timeout' error to RETRYABLE", () => {
    const r = interpretActivationResponse({
      rpcResult: null,
      rpcError: { message: "Request timeout" },
    });
    expect(r.state).toBe(ACTIVATION_STATES.RETRYABLE);
  });

  it("maps an unknown rpcResult.status to RETRYABLE (safe default)", () => {
    const r = interpretActivationResponse({
      rpcResult: { status: "huh_what" },
      rpcError: null,
    });
    expect(r.state).toBe(ACTIVATION_STATES.RETRYABLE);
    expect(r.retryable).toBe(true);
  });

  it("maps a null rpcResult AND null rpcError to RETRYABLE (RPC returned nothing)", () => {
    const r = interpretActivationResponse({ rpcResult: null, rpcError: null });
    expect(r.state).toBe(ACTIVATION_STATES.RETRYABLE);
  });
});

describe("interpretActivationResponse — non-retryable supabase errors", () => {
  it("maps a permission-denied error to PERMANENT (no retry will help)", () => {
    const r = interpretActivationResponse({
      rpcResult: null,
      rpcError: { message: "permission denied for function activate_trial" },
    });
    expect(r.state).toBe(ACTIVATION_STATES.PERMANENT);
    expect(r.retryable).toBe(false);
  });

  it("maps a function-not-found error to PERMANENT (migration didn't run)", () => {
    const r = interpretActivationResponse({
      rpcResult: null,
      rpcError: { message: "function public.activate_trial(uuid) does not exist" },
    });
    expect(r.state).toBe(ACTIVATION_STATES.PERMANENT);
    expect(r.retryable).toBe(false);
  });
});

describe("activationRetryDelayMs — backoff schedule", () => {
  it("returns increasing delays for attempts 1-4", () => {
    expect(activationRetryDelayMs(1)).toBe(500);
    expect(activationRetryDelayMs(2)).toBe(1000);
    expect(activationRetryDelayMs(3)).toBe(2000);
    expect(activationRetryDelayMs(4)).toBe(4000);
  });

  it("returns null after attempt 4 (exhausts retries)", () => {
    expect(activationRetryDelayMs(5)).toBeNull();
    expect(activationRetryDelayMs(99)).toBeNull();
  });

  it("returns 500ms default for non-integer / negative inputs", () => {
    expect(activationRetryDelayMs(0)).toBe(500);
    expect(activationRetryDelayMs(-1)).toBe(500);
    expect(activationRetryDelayMs(undefined)).toBe(500);
    expect(activationRetryDelayMs("two")).toBe(500);
  });

  it("total backoff time is bounded (sum of all delays + initial)", () => {
    // 0 + 500 + 1000 + 2000 + 4000 = 7500ms total wait across all retries
    let total = 0;
    for (let i = 1; i <= MAX_ACTIVATION_ATTEMPTS; i++) {
      const d = activationRetryDelayMs(i);
      if (d === null) break;
      total += d;
    }
    expect(total).toBeLessThan(10_000); // under 10 seconds total
  });
});

describe("MAX_ACTIVATION_ATTEMPTS", () => {
  it("is exported as a hard cap so callers can't loop forever", () => {
    expect(MAX_ACTIVATION_ATTEMPTS).toBe(5);
    expect(typeof MAX_ACTIVATION_ATTEMPTS).toBe("number");
  });
});
