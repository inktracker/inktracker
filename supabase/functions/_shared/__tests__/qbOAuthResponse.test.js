import { describe, it, expect } from "vitest";
import { validateQbTokenResponse } from "../qbOAuthResponse.js";

describe("validateQbTokenResponse", () => {
  it("accepts a complete, well-formed Intuit token response", () => {
    expect(validateQbTokenResponse({
      access_token: "eyJlbmM…",
      refresh_token: "AB1…",
      expires_in: 3600,
      token_type: "bearer",
    })).toEqual({ ok: true });
  });

  it("rejects null / undefined / non-object input", () => {
    expect(validateQbTokenResponse(null).ok).toBe(false);
    expect(validateQbTokenResponse(undefined).ok).toBe(false);
    expect(validateQbTokenResponse("a string").ok).toBe(false);
    expect(validateQbTokenResponse(123).ok).toBe(false);
  });

  it("rejects when access_token is missing", () => {
    const r = validateQbTokenResponse({ refresh_token: "x", expires_in: 3600 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/access_token/);
  });

  it("rejects when access_token is empty string", () => {
    const r = validateQbTokenResponse({ access_token: "", refresh_token: "x", expires_in: 3600 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/access_token/);
  });

  it("rejects when access_token is wrong type", () => {
    const r = validateQbTokenResponse({ access_token: 12345, refresh_token: "x", expires_in: 3600 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/access_token/);
  });

  it("rejects when refresh_token is missing", () => {
    const r = validateQbTokenResponse({ access_token: "x", expires_in: 3600 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/refresh_token/);
  });

  it("rejects when refresh_token is empty string", () => {
    const r = validateQbTokenResponse({ access_token: "x", refresh_token: "", expires_in: 3600 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/refresh_token/);
  });

  it("rejects when expires_in is missing", () => {
    const r = validateQbTokenResponse({ access_token: "x", refresh_token: "y" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/expires_in/);
  });

  it("rejects when expires_in is zero or negative (token born expired)", () => {
    expect(validateQbTokenResponse({ access_token: "x", refresh_token: "y", expires_in: 0 }).ok).toBe(false);
    expect(validateQbTokenResponse({ access_token: "x", refresh_token: "y", expires_in: -1 }).ok).toBe(false);
  });

  it("rejects when expires_in is a string (Intuit sometimes returns numeric strings)", () => {
    const r = validateQbTokenResponse({ access_token: "x", refresh_token: "y", expires_in: "3600" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/expires_in/);
  });

  it("doesn't require token_type or refresh_token_expires_in (optional fields)", () => {
    // Intuit's docs document these as standard but the minimum viable
    // body for our flow is just the three required fields.
    expect(validateQbTokenResponse({
      access_token: "x",
      refresh_token: "y",
      expires_in: 3600,
    })).toEqual({ ok: true });
  });
});
