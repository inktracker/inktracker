// QuickBooks webhook signature verification — extracted so it's unit-testable
// AND reusable by the smoke script. QB signs the raw request body with
// HMAC-SHA256 using the per-environment verifier token, base64-encoded, sent in
// the `intuit-signature` header. Uses Web Crypto (crypto.subtle), available in
// both Deno and Node 18+.

// Constant-time string comparison — avoids leaking, via timing, how many
// leading characters of the signature matched.
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// Compute the base64 HMAC-SHA256 signature QB would send for a given body+token.
export async function computeQbSignature(rawBody, token) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const computed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return btoa(String.fromCharCode(...new Uint8Array(computed)));
}

// Verify an incoming signature. Fails closed: no token or no signature → false.
export async function verifyQbSignature(rawBody, signature, token) {
  if (!token || !signature) return false;
  try {
    const expected = await computeQbSignature(rawBody, token);
    return timingSafeEqual(expected, signature);
  } catch {
    return false;
  }
}
