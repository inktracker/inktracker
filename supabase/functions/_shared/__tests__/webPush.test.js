// Web Push crypto, pinned to the RFC's own published test vector.
//
// This is the one place in the codebase where "looks right" is worthless:
// a subtly wrong HKDF still produces plausible-looking bytes, the push
// service still returns 201, and the notification simply never appears on
// anyone's phone. The failure is silent and remote.
//
// So the core test reproduces RFC 8291 §5 byte-for-byte — same receiver
// keys, same auth secret, same salt, same ephemeral sender key — and
// asserts the exact expected ciphertext. If this passes, the derivation
// chain (ECDH → HKDF w/ auth secret → CEK/nonce → AES-128-GCM → header
// framing) is correct.

import { describe, it, expect } from "vitest";
import {
  encryptPayload,
  buildPushRequest,
  signVapidJwt,
  bytesToB64url,
  b64urlToBytes,
  isGoneStatus,
} from "../webPush.js";

// ── RFC 8291 §5 ─────────────────────────────────────────────────────────
const VECTOR = {
  plaintext: "When I grow up, I want to be a watermelon",
  ua_public: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth_secret: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  as_public: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  as_private: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  expected:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
    "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
    "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

describe("encryptPayload — RFC 8291 test vector", () => {
  it("reproduces the published ciphertext exactly", async () => {
    const body = await encryptPayload({
      payload: VECTOR.plaintext,
      p256dh: VECTOR.ua_public,
      auth: VECTOR.auth_secret,
      salt: b64urlToBytes(VECTOR.salt),
      senderKeys: { publicKey: VECTOR.as_public, privateKey: VECTOR.as_private },
    });
    expect(bytesToB64url(body)).toBe(VECTOR.expected);
  });

  it("frames the aes128gcm header correctly (salt|rs|idlen|keyid)", async () => {
    const body = await encryptPayload({
      payload: "hi",
      p256dh: VECTOR.ua_public,
      auth: VECTOR.auth_secret,
      salt: b64urlToBytes(VECTOR.salt),
      senderKeys: { publicKey: VECTOR.as_public, privateKey: VECTOR.as_private },
    });
    expect(body.subarray(0, 16)).toEqual(b64urlToBytes(VECTOR.salt));
    expect(new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0)).toBe(4096);
    expect(body[20]).toBe(65); // keyid length
    expect(bytesToB64url(body.subarray(21, 86))).toBe(VECTOR.as_public);
  });

  it("produces a different body each call when salt/keys are not pinned", async () => {
    const args = { payload: "same text", p256dh: VECTOR.ua_public, auth: VECTOR.auth_secret };
    const a = await encryptPayload(args);
    const b = await encryptPayload(args);
    // Random salt + fresh ephemeral key per message — identical output would
    // mean we'd frozen one of them, which leaks across messages.
    expect(bytesToB64url(a)).not.toBe(bytesToB64url(b));
  });
});

describe("base64url round-trip", () => {
  it("handles unpadded input from real subscriptions", () => {
    // p256dh is 65 bytes → 88 base64 chars incl. padding; browsers strip it.
    expect(b64urlToBytes(VECTOR.ua_public).length).toBe(65);
    expect(b64urlToBytes(VECTOR.auth_secret).length).toBe(16);
    expect(bytesToB64url(b64urlToBytes(VECTOR.ua_public))).toBe(VECTOR.ua_public);
  });

  it("never emits +, / or = (they'd corrupt a URL-safe field)", () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect(bytesToB64url(bytes)).not.toMatch(/[+/=]/);
  });
});

describe("signVapidJwt", () => {
  const VAPID = {
    // Throwaway pair generated for this test only — not the production key.
    publicKey: VECTOR.as_public,
    privateKey: VECTOR.as_private,
    subject: "mailto:joe@biotamfg.co",
  };

  it("emits a compact ES256 JWS with the right claims", async () => {
    const jwt = await signVapidJwt({
      audience: "https://fcm.googleapis.com",
      subject: VAPID.subject,
      publicKey: VAPID.publicKey,
      privateKey: VAPID.privateKey,
      now: 1_700_000_000,
    });
    const [h, b, sig] = jwt.split(".");
    expect(JSON.parse(new TextDecoder().decode(b64urlToBytes(h)))).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(b)));
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.sub).toBe("mailto:joe@biotamfg.co");
    // 12h window — push services reject > 24h.
    expect(claims.exp - 1_700_000_000).toBe(12 * 60 * 60);
    // ES256 signatures are raw r||s = 64 bytes, never DER.
    expect(b64urlToBytes(sig).length).toBe(64);
  });

  it("binds the token to the endpoint's origin, not its path", async () => {
    const jwt = await signVapidJwt({
      audience: new URL("https://updates.push.services.mozilla.com/wpush/v2/abc123").origin,
      subject: VAPID.subject, publicKey: VAPID.publicKey, privateKey: VAPID.privateKey,
      now: 1_700_000_000,
    });
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(jwt.split(".")[1])));
    expect(claims.aud).toBe("https://updates.push.services.mozilla.com");
  });
});

describe("buildPushRequest", () => {
  const sub = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    p256dh: VECTOR.ua_public,
    auth: VECTOR.auth_secret,
  };
  const vapid = { publicKey: VECTOR.as_public, privateKey: VECTOR.as_private, subject: "mailto:joe@biotamfg.co" };

  it("returns the exact headers a push service requires", async () => {
    const req = await buildPushRequest({ subscription: sub, payload: JSON.stringify({ title: "x" }), vapid, now: 1_700_000_000 });
    expect(req.url).toBe(sub.endpoint);
    expect(req.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(req.headers["Content-Type"]).toBe("application/octet-stream");
    expect(req.headers.TTL).toBe("3600");
    expect(req.headers.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(req.headers.Authorization).toContain(`k=${vapid.publicKey}`);
    expect(req.body).toBeInstanceOf(Uint8Array);
  });

  it("refuses a half-populated subscription instead of sending garbage", async () => {
    await expect(buildPushRequest({
      subscription: { endpoint: sub.endpoint, p256dh: sub.p256dh }, // no auth
      payload: "x", vapid,
    })).rejects.toThrow(/endpoint, p256dh and auth/);
  });
});

describe("isGoneStatus — only retire genuinely dead endpoints", () => {
  it("retires on 404/410", () => {
    expect(isGoneStatus(404)).toBe(true);
    expect(isGoneStatus(410)).toBe(true);
  });

  // The important half: a rate limit or an outage must never delete a live
  // device. That bug is invisible until a shop wonders why push stopped.
  it("keeps the subscription on transient failures", () => {
    for (const s of [201, 400, 401, 429, 500, 502, 503, 504]) {
      expect(isGoneStatus(s)).toBe(false);
    }
  });
});
