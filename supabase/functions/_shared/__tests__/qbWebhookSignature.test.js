import { describe, it, expect } from "vitest";
import { computeQbSignature, verifyQbSignature, timingSafeEqual } from "../qbWebhookSignature.js";

const TOKEN = "test-verifier-token-abc123";
const BODY = JSON.stringify({ eventNotifications: [{ realmId: "9130000", dataChangeEvent: { entities: [] } }] });

describe("computeQbSignature", () => {
  it("is deterministic for the same body + token", async () => {
    const a = await computeQbSignature(BODY, TOKEN);
    const b = await computeQbSignature(BODY, TOKEN);
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/); // base64
  });

  it("differs when the token differs", async () => {
    const a = await computeQbSignature(BODY, TOKEN);
    const b = await computeQbSignature(BODY, "different-token");
    expect(a).not.toBe(b);
  });

  it("differs when the body differs", async () => {
    const a = await computeQbSignature(BODY, TOKEN);
    const b = await computeQbSignature(BODY + " ", TOKEN);
    expect(a).not.toBe(b);
  });
});

describe("verifyQbSignature", () => {
  it("accepts a correctly-signed body", async () => {
    const sig = await computeQbSignature(BODY, TOKEN);
    expect(await verifyQbSignature(BODY, sig, TOKEN)).toBe(true);
  });

  it("rejects when the token doesn't match (the production-vs-dev token bug)", async () => {
    const sig = await computeQbSignature(BODY, TOKEN);
    expect(await verifyQbSignature(BODY, sig, "wrong-token")).toBe(false);
  });

  it("rejects a tampered body", async () => {
    const sig = await computeQbSignature(BODY, TOKEN);
    expect(await verifyQbSignature(BODY + "tampered", sig, TOKEN)).toBe(false);
  });

  it("fails closed with no signature or no token", async () => {
    const sig = await computeQbSignature(BODY, TOKEN);
    expect(await verifyQbSignature(BODY, "", TOKEN)).toBe(false);
    expect(await verifyQbSignature(BODY, sig, "")).toBe(false);
  });
});

describe("timingSafeEqual", () => {
  it("true for equal strings, false otherwise", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false); // length differs
    expect(timingSafeEqual("abc", null)).toBe(false);
  });
});
