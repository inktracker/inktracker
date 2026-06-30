// artworkProof — token-gated signing proxy for the (soon-private) artwork bucket.
//
// Anonymous customer surfaces (the emailed proof <img>, the QuotePayment and
// ArtApproval pages) can't sign artwork themselves once the bucket is private.
// This GET endpoint lets them embed a stable URL:
//
//   /functions/v1/artworkProof?type=quote&id=<quoteId>&token=<public_token>&path=<artwork-path>
//
// It validates the token against the quote/order's public_token, confirms the
// requested path is actually referenced by THAT row (so a valid token can't pull
// another tenant's artwork out of the flat bucket), then 302-redirects to a fresh
// short-lived signed URL. Because it signs on every request, an emailed <img>
// keeps working indefinitely without ever exposing a public or long-lived URL.

import { createClient } from "npm:@supabase/supabase-js@2.102.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SIGNED_TTL = 60 * 60; // 1h — fresh on every proxy hit, so expiry never matters

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Constant-time string compare (avoid leaking token validity via timing).
function safeEquals(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// Resolve a bucket-relative artwork path from a bare path / public URL / signed URL.
function resolveArtworkPath(input: string): string | null {
  if (!input) return null;
  const s = String(input);
  if (!/^https?:\/\//i.test(s)) return s.replace(/^\/+/, "");
  const m = s.match(/\/storage\/v1\/object\/(?:public|sign)\/artwork\/([^?]+)/);
  if (m && m[1]) {
    try { return decodeURIComponent(m[1]); } catch { return m[1]; }
  }
  return null;
}

// Every artwork path THIS row legitimately references — both URL-embedded forms
// and bare upload paths (<13-digit ts>-<6 char>.<ext>). Used to authorize the
// requested path so a valid token only unlocks its own row's artwork.
function authorizedPaths(row: unknown): Set<string> {
  const out = new Set<string>();
  let blob = "";
  try { blob = JSON.stringify(row); } catch { return out; }
  for (const m of blob.matchAll(/\/artwork\/([A-Za-z0-9._\-/]+?)(?=["?\\])/g)) {
    try { out.add(decodeURIComponent(m[1])); } catch { out.add(m[1]); }
  }
  for (const m of blob.matchAll(/"(\d{13}-[a-z0-9]{6}\.[A-Za-z0-9]+)"/g)) {
    out.add(m[1]);
  }
  return out;
}

function fail(status: number) {
  // Same opaque 404 for not-found / bad-token / unauthorized-path so we never
  // leak which one it was (mirrors the quote/order token gate).
  return new Response("Not found", { status, headers: CORS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);
    const type = url.searchParams.get("type");        // "quote" | "order"
    const id = url.searchParams.get("id") || "";
    const token = url.searchParams.get("token") || "";
    const pathParam = url.searchParams.get("path") || "";

    const reqPath = resolveArtworkPath(pathParam);
    if (!reqPath || (type !== "quote" && type !== "order") || !id || !token) return fail(404);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const table = type === "quote" ? "quotes" : "orders";

    // Look up by uuid id, then by the human id column (quote_id / order_id).
    let row: any = null;
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRe.test(id)) {
      const { data } = await admin.from(table).select("*").eq("id", id).maybeSingle();
      row = data;
    }
    if (!row) {
      const idCol = type === "quote" ? "quote_id" : "order_id";
      const { data } = await admin.from(table).select("*").eq(idCol, id).maybeSingle();
      row = data;
    }
    if (!row || !row.public_token || !safeEquals(token, row.public_token)) return fail(404);

    if (!authorizedPaths(row).has(reqPath)) return fail(404);

    const { data: signed, error } = await admin.storage
      .from("artwork").createSignedUrl(reqPath, SIGNED_TTL);
    if (error || !signed?.signedUrl) return fail(404);

    // 302 to the freshly-signed URL. no-store so the redirect itself isn't cached
    // (the signed URL it points to is short-lived).
    return new Response(null, {
      status: 302,
      headers: { ...CORS, Location: signed.signedUrl, "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[artworkProof] error:", (err as Error).message);
    return fail(404);
  }
});
