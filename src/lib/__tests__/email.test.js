import { describe, it, expect } from "vitest";
import { isValidEmail } from "../email";

describe("isValidEmail", () => {
  it("V1 — accepts a basic email", () => {
    expect(isValidEmail("dani@example.com")).toBe(true);
  });

  it("V2 — accepts plus addressing + subdomains", () => {
    expect(isValidEmail("joe+filter@inktracker.app")).toBe(true);
    expect(isValidEmail("a@b.co.uk")).toBe(true);
  });

  it("V3 — rejects a person's name (the original QB bug)", () => {
    expect(isValidEmail("Danielle Walton")).toBe(false);
  });

  it("V4 — rejects empty / whitespace / non-string", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("   ")).toBe(false);
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail(42)).toBe(false);
  });

  it("V5 — rejects missing @ or missing TLD", () => {
    expect(isValidEmail("hello.world")).toBe(false);
    expect(isValidEmail("no-at-sign")).toBe(false);
    expect(isValidEmail("missing-tld@local")).toBe(false);
  });

  it("V6 — rejects whitespace around the @", () => {
    expect(isValidEmail("joe @inktracker.app")).toBe(false);
    expect(isValidEmail("joe@ ink.app")).toBe(false);
  });
});
