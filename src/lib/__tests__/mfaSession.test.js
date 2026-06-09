import { describe, it, expect, beforeEach } from "vitest";

// Plain Node test env — stub sessionStorage so the module can read /
// write without throwing. Same approach mfa.test.js uses for localStorage.
const store = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};

import {
  markMfaSessionVerified,
  isMfaSessionVerified,
  clearMfaSessionVerified,
  clearAllMfaSessionFlags,
} from "@/lib/mfaSession";

describe("mfaSession", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("returns false when nothing is stored", () => {
    expect(isMfaSessionVerified("u1")).toBe(false);
  });

  it("returns false when userId is falsy even if a flag exists", () => {
    markMfaSessionVerified("u1");
    expect(isMfaSessionVerified(undefined)).toBe(false);
    expect(isMfaSessionVerified("")).toBe(false);
    expect(isMfaSessionVerified(null)).toBe(false);
  });

  it("scopes flags per user", () => {
    markMfaSessionVerified("u1");
    expect(isMfaSessionVerified("u1")).toBe(true);
    expect(isMfaSessionVerified("u2")).toBe(false);
  });

  it("clears one user without touching others", () => {
    markMfaSessionVerified("u1");
    markMfaSessionVerified("u2");
    clearMfaSessionVerified("u1");
    expect(isMfaSessionVerified("u1")).toBe(false);
    expect(isMfaSessionVerified("u2")).toBe(true);
  });

  it("clearAll wipes every mfa flag but leaves unrelated keys alone", () => {
    markMfaSessionVerified("u1");
    markMfaSessionVerified("u2");
    sessionStorage.setItem("not_mfa", "keepme");
    clearAllMfaSessionFlags();
    expect(isMfaSessionVerified("u1")).toBe(false);
    expect(isMfaSessionVerified("u2")).toBe(false);
    expect(sessionStorage.getItem("not_mfa")).toBe("keepme");
  });

  it("no-ops on null userId for write/clear (no throws)", () => {
    expect(() => markMfaSessionVerified(null)).not.toThrow();
    expect(() => clearMfaSessionVerified(null)).not.toThrow();
  });
});
