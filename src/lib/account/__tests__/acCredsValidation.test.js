import { describe, it, expect } from "vitest";
import { validateAcCredsSave, acConnectionWarning } from "../acCredsValidation.js";

const NONE = { hasKey: false, hasEmail: false, hasPassword: false };
const COMPLETE = { hasKey: true, hasEmail: true, hasPassword: true };
const KEY_ONLY = { hasKey: true, hasEmail: false, hasPassword: false };

describe("validateAcCredsSave — fresh connect (nothing stored)", () => {
  it("accepts all three fields", () => {
    expect(validateAcCredsSave({ key: "k", email: "a@b.co", password: "p" }, NONE).ok).toBe(true);
  });

  it("rejects key only — the silent no-prices trap", () => {
    const r = validateAcCredsSave({ key: "k", email: "", password: "" }, NONE);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/email and password/);
    expect(r.error).toMatch(/no prices/);
  });

  it("rejects key + email without password", () => {
    const r = validateAcCredsSave({ key: "k", email: "a@b.co", password: "" }, NONE);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/password/);
    expect(r.error).not.toMatch(/email and/);
  });

  it("rejects email + password without key", () => {
    const r = validateAcCredsSave({ key: "", email: "a@b.co", password: "p" }, NONE);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Subscription Key/);
  });

  it("passes an untouched form through (no AC change)", () => {
    expect(validateAcCredsSave({ key: "", email: "", password: "" }, NONE).ok).toBe(true);
  });
});

describe("validateAcCredsSave — editing an existing connection", () => {
  it("allows rotating just the password when the stored set is complete", () => {
    expect(validateAcCredsSave({ key: "", email: "", password: "new" }, COMPLETE).ok).toBe(true);
  });

  it("allows updating just the email when the stored set is complete", () => {
    expect(validateAcCredsSave({ key: "", email: "new@b.co", password: "" }, COMPLETE).ok).toBe(true);
  });

  it("legacy key-only shop adding just the email is still blocked (password missing)", () => {
    const r = validateAcCredsSave({ key: "", email: "a@b.co", password: "" }, KEY_ONLY);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/password/);
  });

  it("legacy key-only shop completing email + password is accepted", () => {
    expect(validateAcCredsSave({ key: "", email: "a@b.co", password: "p" }, KEY_ONLY).ok).toBe(true);
  });

  it("replacing the key on a complete connection stays valid", () => {
    expect(validateAcCredsSave({ key: "newkey", email: "", password: "" }, COMPLETE).ok).toBe(true);
  });
});

describe("acConnectionWarning", () => {
  it("silent when not connected or fully connected", () => {
    expect(acConnectionWarning(NONE)).toBeNull();
    expect(acConnectionWarning(COMPLETE)).toBeNull();
  });

  it("warns a key-only connection about both missing fields and the wizard re-sync", () => {
    const w = acConnectionWarning(KEY_ONLY);
    expect(w).toMatch(/email and password/);
    expect(w).toMatch(/re-sync your wizard styles/);
  });

  it("names only the missing field", () => {
    expect(acConnectionWarning({ hasKey: true, hasEmail: true, hasPassword: false })).toMatch(/password/);
    expect(acConnectionWarning({ hasKey: true, hasEmail: true, hasPassword: false })).not.toMatch(/email and/);
  });
});
