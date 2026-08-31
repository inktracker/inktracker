// APNs (Apple Push Notification service) helpers for sendPush's iOS leg.
// Token-based auth: an ES256 JWT signed with a .p8 key, sent as the
// authorization bearer on every push. Pure-ish and unit-tested — the only
// I/O is WebCrypto.
//
// Payload mirrors buildPushPayload's web shape: title/body on the visible
// alert, `url` + `notificationId` in the data for the tap deep-link.

const enc = new TextEncoder();

function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem) {
  const body = String(pem)
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/**
 * Build a signed APNs provider JWT. WebCrypto ECDSA signatures come out in
 * the raw r||s form JOSE wants — no DER conversion needed (unlike the ASC
 * API script, whose DER→JOSE step once cost a silent 401).
 */
export async function makeApnsJwt({ keyId, teamId, privateKeyPem, nowSec = Math.floor(Date.now() / 1000) }) {
  if (!keyId || !teamId || !privateKeyPem) throw new Error("APNs auth not configured");
  const header = b64url(enc.encode(JSON.stringify({ alg: "ES256", kid: keyId })));
  const payload = b64url(enc.encode(JSON.stringify({ iss: teamId, iat: nowSec })));
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}

/** The JSON body APNs delivers. Alert on the lock screen; data for the tap. */
export function buildApnsBody(note, targetUrl) {
  return {
    aps: {
      alert: {
        title: note.title,
        body: note.body ?? "",
      },
      sound: "default",
      // Collapse repeats of the same event on the same entity (mirrors the
      // web payload's tag semantics).
      "thread-id": `${note.event_type}:${note.related_id ?? note.id}`,
    },
    url: targetUrl ?? null,
    notificationId: note.id,
  };
}

/** Request headers for one delivery. info → conserve battery; else prompt. */
export function apnsHeaders({ jwt, topic, severity }) {
  return {
    "authorization": `bearer ${jwt}`,
    "apns-topic": topic,
    "apns-push-type": "alert",
    "apns-priority": severity === "info" ? "5" : "10",
    "content-type": "application/json",
  };
}

/** 410 = token no longer valid for this app — disable the row, don't retry. */
export function isApnsGoneStatus(status, reasonBody) {
  if (status === 410) return true;
  const reason = typeof reasonBody === "object" ? reasonBody?.reason : undefined;
  return status === 400 && (reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic");
}
