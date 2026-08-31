import { describe, it, expect } from "vitest";
import { makeApnsJwt, buildApnsBody, apnsHeaders, isApnsGoneStatus } from "../apns";

// Throwaway P-256 key generated for tests only.
async function makeTestKeyPem() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const der = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  let s = "";
  for (const b of new Uint8Array(der)) s += String.fromCharCode(b);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(s)}\n-----END PRIVATE KEY-----`;
  return { pem, publicKey: pair.publicKey };
}

function b64urlToBytes(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

describe("makeApnsJwt", () => {
  it("produces a verifiable ES256 JWT with kid/iss/iat", async () => {
    const { pem, publicKey } = await makeTestKeyPem();
    const jwt = await makeApnsJwt({ keyId: "KEY123", teamId: "7545WWK837", privateKeyPem: pem, nowSec: 1_700_000_000 });
    const [h, p, sig] = jwt.split(".");
    expect(JSON.parse(new TextDecoder().decode(b64urlToBytes(h)))).toEqual({ alg: "ES256", kid: "KEY123" });
    expect(JSON.parse(new TextDecoder().decode(b64urlToBytes(p)))).toEqual({ iss: "7545WWK837", iat: 1_700_000_000 });
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      b64urlToBytes(sig),
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });

  it("refuses to run unconfigured", async () => {
    await expect(makeApnsJwt({ keyId: "", teamId: "T", privateKeyPem: "x" })).rejects.toThrow("not configured");
  });
});

describe("buildApnsBody / apnsHeaders", () => {
  const note = { id: 42, event_type: "order_comment", severity: "info", title: "Joe mentioned you on ORD-1", body: "screens ready", related_id: "row-1" };

  it("carries alert + collapse id + deep-link data", () => {
    expect(buildApnsBody(note, "/Orders?id=row-1")).toEqual({
      aps: {
        alert: { title: "Joe mentioned you on ORD-1", body: "screens ready" },
        sound: "default",
        "thread-id": "order_comment:row-1",
      },
      url: "/Orders?id=row-1",
      notificationId: 42,
    });
  });

  it("maps severity to APNs priority and stamps the topic", () => {
    expect(apnsHeaders({ jwt: "J", topic: "app.inktracker.mobile", severity: "info" })["apns-priority"]).toBe("5");
    expect(apnsHeaders({ jwt: "J", topic: "app.inktracker.mobile", severity: "alert" })["apns-priority"]).toBe("10");
    expect(apnsHeaders({ jwt: "J", topic: "app.inktracker.mobile", severity: "info" })["apns-topic"]).toBe("app.inktracker.mobile");
  });
});

describe("isApnsGoneStatus", () => {
  it("treats 410 and bad-token 400s as gone, transient errors as not", () => {
    expect(isApnsGoneStatus(410, {})).toBe(true);
    expect(isApnsGoneStatus(400, { reason: "BadDeviceToken" })).toBe(true);
    expect(isApnsGoneStatus(400, { reason: "DeviceTokenNotForTopic" })).toBe(true);
    expect(isApnsGoneStatus(400, { reason: "BadMessageId" })).toBe(false);
    expect(isApnsGoneStatus(500, {})).toBe(false);
    expect(isApnsGoneStatus(403, { reason: "InvalidProviderToken" })).toBe(false);
  });
});
