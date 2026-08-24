// Web Push encryption + VAPID signing (RFC 8291 / RFC 8188 / RFC 8292).
//
// Implemented directly on Web Crypto rather than pulling in the `web-push`
// npm package: that library reaches for node's `https` and `crypto` modules,
// and betting a delivery path on Deno's node-compat shims in the Supabase
// edge runtime is a worse trade than ~120 lines of well-specified crypto we
// can pin to the RFC's own test vector (see __tests__/webPush.test.js).
//
// Everything here is pure — no fetch, no env, no Deno globals — so it runs
// under vitest exactly as it runs in the edge function. The caller does the
// HTTP.
//
// Shape of an encrypted Web Push message (aes128gcm, RFC 8188 §2):
//
//   ┌────────────┬────────┬───────┬──────────────┬─────────────────────┐
//   │ salt (16)  │ rs (4) │ idlen │ keyid (65)   │ AES-128-GCM payload │
//   └────────────┴────────┴───────┴──────────────┴─────────────────────┘
//                                  ^ our ephemeral P-256 public key
//
// The receiver derives the same key from its own private key + our ephemeral
// public key + the shared auth secret, so only that browser can read it.

const enc = new TextEncoder();

// ── base64url ───────────────────────────────────────────────────────────
// Push subscription fields (p256dh, auth) arrive base64url WITHOUT padding.
// atob/btoa need standard base64 with padding, so convert both ways.

export function b64urlToBytes(s) {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = pad + "=".repeat((4 - (pad.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes) {
  let bin = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // Chunked: String.fromCharCode(...arr) blows the argument limit on large
  // payloads (a notification body is small, but this is also used on keys
  // and ciphertext, and a silent RangeError here would be miserable).
  for (let i = 0; i < arr.length; i += 0x8000) {
    bin += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// ── HKDF (RFC 5869), single-block only ──────────────────────────────────
// Every derivation here wants ≤ 32 bytes, so one HMAC block is enough and
// the counter is always 0x01.

async function hmacSha256(keyBytes, data) {
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

async function hkdf(salt, ikm, info, length) {
  const prk = await hmacSha256(salt, ikm);
  const okm = await hmacSha256(prk, concat(info, new Uint8Array([1])));
  return okm.subarray(0, length);
}

// ── EC helpers ──────────────────────────────────────────────────────────
// A raw P-256 public key is 65 bytes: 0x04 || X(32) || Y(32).

function rawPublicToJwk(raw) {
  if (raw.length !== 65 || raw[0] !== 0x04) {
    throw new Error(`expected 65-byte uncompressed P-256 point, got ${raw.length}`);
  }
  return {
    kty: "EC", crv: "P-256",
    x: bytesToB64url(raw.subarray(1, 33)),
    y: bytesToB64url(raw.subarray(33, 65)),
  };
}

async function importPublicKey(raw, usage = []) {
  return crypto.subtle.importKey(
    "jwk", { ...rawPublicToJwk(raw), ext: true },
    { name: "ECDH", namedCurve: "P-256" }, true, usage,
  );
}

async function exportRawPublic(key) {
  return new Uint8Array(await crypto.subtle.exportKey("raw", key));
}

/**
 * Build a P-256 keypair for ECDH. Tests inject a fixed pair (RFC vector);
 * production generates a fresh ephemeral pair per message, which is what
 * makes each message independently secure.
 */
async function ephemeralKeyPair(fixed) {
  if (fixed) {
    const pubRaw = b64urlToBytes(fixed.publicKey);
    const priv = await crypto.subtle.importKey(
      "jwk",
      { ...rawPublicToJwk(pubRaw), d: fixed.privateKey, ext: true },
      { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"],
    );
    return { privateKey: priv, publicRaw: pubRaw };
  }
  const kp = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
  );
  return { privateKey: kp.privateKey, publicRaw: await exportRawPublic(kp.publicKey) };
}

/**
 * Encrypt a payload for a Web Push subscription (RFC 8291).
 *
 * @param {object}  args
 * @param {string}  args.payload      UTF-8 string to deliver
 * @param {string}  args.p256dh       subscription key, base64url
 * @param {string}  args.auth         subscription auth secret, base64url
 * @param {Uint8Array} [args.salt]    16 bytes; random when omitted (tests pin it)
 * @param {{publicKey:string,privateKey:string}} [args.senderKeys] test-only
 * @returns {Promise<Uint8Array<ArrayBuffer>>} the full aes128gcm body
 */
export async function encryptPayload({ payload, p256dh, auth, salt = undefined, senderKeys = undefined }) {
  const uaPublicRaw = b64urlToBytes(p256dh);
  const authSecret = b64urlToBytes(auth);
  const useSalt = salt ?? crypto.getRandomValues(new Uint8Array(16));

  const { privateKey: asPrivate, publicRaw: asPublicRaw } = await ephemeralKeyPair(senderKeys);
  const uaPublic = await importPublicKey(uaPublicRaw);

  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaPublic }, asPrivate, 256),
  );

  // RFC 8291 §3.4 — mix in the auth secret and BOTH public keys, so the
  // derived key is bound to this specific sender/receiver pair.
  const keyInfo = concat(
    enc.encode("WebPush: info"), new Uint8Array([0]), uaPublicRaw, asPublicRaw,
  );
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  // RFC 8188 §2.2 — content encryption key + nonce.
  const cek = await hkdf(useSalt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(useSalt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // Single record, so the padding delimiter is 0x02 ("last record").
  const plaintext = concat(enc.encode(payload), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, plaintext),
  );

  // Header: salt || record size (4, big-endian) || keyid length || keyid.
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(useSalt, rs, new Uint8Array([asPublicRaw.length]), asPublicRaw, ciphertext);
}

// ── VAPID (RFC 8292) ────────────────────────────────────────────────────

function derToJose(der) {
  // WebCrypto's ECDSA sign already returns raw r||s (unlike OpenSSL's DER),
  // so this is only needed if a caller hands us a DER signature. Kept small
  // and defensive: if it doesn't look like DER, pass it through untouched.
  if (der[0] !== 0x30) return der;
  let off = 2;
  if (der[1] & 0x80) off += der[1] & 0x7f;
  const out = new Uint8Array(64);
  for (const half of [0, 32]) {
    off++; // 0x02 INTEGER tag
    let len = der[off++];
    let start = off;
    while (len > 32) { start++; len--; }
    out.set(der.subarray(start, start + len), half + (32 - len));
    off = start + len;
  }
  return out;
}

/**
 * Sign a VAPID JWT proving we own the application server key.
 *
 * @param {object} args
 * @param {string} args.audience  scheme://host of the push endpoint
 * @param {string} args.subject   mailto: or https: contact for the operator
 * @param {string} args.publicKey  VAPID public key, base64url (65 raw bytes)
 * @param {string} args.privateKey VAPID private key, base64url (32 raw bytes)
 * @param {number} [args.now]      unix seconds; injectable for tests
 * @returns {Promise<string>} compact JWS
 */
export async function signVapidJwt({ audience, subject, publicKey, privateKey, now }) {
  const iat = now ?? Math.floor(Date.now() / 1000);
  // 12h. RFC 8292 caps it at 24h; push services reject longer, and a short
  // window limits replay if a token leaks from a log.
  const exp = iat + 12 * 60 * 60;

  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = bytesToB64url(enc.encode(JSON.stringify({ aud: audience, exp, sub: subject })));
  const signingInput = enc.encode(`${header}.${body}`);

  const pubRaw = b64urlToBytes(publicKey);
  const key = await crypto.subtle.importKey(
    "jwk",
    { ...rawPublicToJwk(pubRaw), d: privateKey, ext: true },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, signingInput),
  );
  return `${header}.${body}.${bytesToB64url(derToJose(sig))}`;
}

/**
 * Everything needed to POST one Web Push message. Pure: the caller fetches.
 *
 * @returns {Promise<{url:string, headers:Record<string,string>, body:Uint8Array<ArrayBuffer>}>}
 */
export async function buildPushRequest({
  subscription, payload, vapid, ttlSeconds = 3600, urgency = "normal",
  salt = undefined, senderKeys = undefined, now = undefined,
}) {
  const { endpoint, p256dh, auth } = subscription;
  if (!endpoint || !p256dh || !auth) {
    throw new Error("subscription requires endpoint, p256dh and auth");
  }
  const body = await encryptPayload({ payload, p256dh, auth, salt, senderKeys });
  const audience = new URL(endpoint).origin;
  const jwt = await signVapidJwt({
    audience, subject: vapid.subject,
    publicKey: vapid.publicKey, privateKey: vapid.privateKey, now,
  });

  return {
    url: endpoint,
    headers: {
      Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttlSeconds),
      Urgency: urgency,
    },
    body,
  };
}

/**
 * Should this subscription be retired?
 *
 * 404/410 are the push service saying the endpoint is permanently gone
 * (browser uninstalled, permission revoked, profile wiped). Anything else —
 * 429, 500, network — is transient and must NOT retire a live device.
 */
export function isGoneStatus(status) {
  return status === 404 || status === 410;
}
