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
import { publicErrorPage, isBrowserNavigation } from "../_shared/publicErrors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Egress economics (2026-07-31 Free-cap blowout): every proxy hit used to
// mint a DIFFERENT signed URL and stamp the 302 no-store, so browsers could
// never cache anything — each proof view/refresh re-downloaded print-res
// originals, and the ~289 MB artwork bucket left Supabase ~19×/cycle
// (5.5 GB). Browser caching is the only lever that reduces billed egress
// (Supabase bills CDN-cached egress too), so:
//
//   - the 302 is now cacheable for REDIRECT_CACHE_SECS (private: it carries
//     a per-recipient tokened path, keep it out of shared caches),
//   - a browser that reuses the cached redirect hits the SAME signed URL,
//     and the storage response under that URL is browser-cacheable,
//   - SIGNED_TTL is 2× the redirect cache so a redirect served at the very
//     end of its cache life still points at a URL with ≥1h of validity.
//
// Security model unchanged: token check still runs on every cache MISS, and
// a revoked token stops new signings within the cache window's worst case
// (1h) — same order as the signed URL lifetime we already accepted.
const SIGNED_TTL = 2 * 60 * 60;        // 2h
const REDIRECT_CACHE_SECS = 60 * 60;   // 1h browser cache on the 302

// Optional server-side thumbnails (Supabase Image Transformations — PRO,
// enabled 2026-07-31). Callers append `&w=<width>` for grid/thumb contexts
// so a 200px tile stops downloading a print-res original. Whitelisted so a
// caller can't mint unbounded distinct transform variants (each unique
// width is a separate origin-image transform + cache entry), and applied
// only to raster formats the transformer supports — PDFs, SVGs, and
// anything else pass through untransformed. Enlarge/download surfaces
// simply omit `w` and get the original, so approval quality is unchanged.
const THUMB_WIDTHS = new Set([320, 640, 1024]);
const RASTER_RE = /\.(jpe?g|png|gif|webp)$/i;

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

// Every artwork path THIS row legitimately references — URL-embedded forms,
// bare uploadFile paths (<13-digit ts>-<6 char>.<ext>), and any "path" field
// value. Used to authorize the requested path so a valid token only unlocks
// its own row's artwork.
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
  // Legacy order-modal uploads stored only { path: "<uuid>_<ts>_<rand>.ext" }
  // with no /artwork/ url — those refs matched NEITHER pattern above, so the
  // customer approval page 404'd every one of them. Any explicit "path" field
  // on the row is an authorized reference.
  for (const m of blob.matchAll(/"path"\s*:\s*"([A-Za-z0-9._\-/]+)"/g)) {
    out.add(m[1]);
  }
  return out;
}

function fail(status: number, req?: Request) {
  // Same opaque 404 for not-found / bad-token / unauthorized-path so we never
  // leak which one it was (mirrors the quote/order token gate).
  //
  // A customer can NAVIGATE here — proof links are emailed, and people click
  // and open images directly. Those get a styled, plain-English page instead
  // of unstyled "Not found" black-on-white, which reads as broken. Subresource
  // fetches (<img src>) keep the terse body: no human reads it, and the
  // browser renders its own broken-image state regardless.
  if (req && isBrowserNavigation(req)) return publicErrorPage(status);
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
    if (!reqPath || (type !== "quote" && type !== "order") || !id || !token) return fail(404, req);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Rate-limit by client IP (a server-derived key, never client-supplied) so
    // this signing proxy can't be flooded — every hit does 2 DB reads + mints a
    // signed URL. The ceiling is deliberately high: a proof page embeds several
    // artwork <img>s and customers refresh, and an office NAT can share one IP,
    // so only abusive/scraping volume trips it, never real proof viewing.
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const { data: underLimit } = await admin.rpc("check_request_rate", {
      p_key: `artwork_proof:${ip}`,
      p_limit_per_hr: 1000,
    });
    if (underLimit === false) {
      return new Response("Too many requests", { status: 429, headers: CORS });
    }

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
    if (!row || !row.public_token || !safeEquals(token, row.public_token)) return fail(404, req);

    if (!authorizedPaths(row).has(reqPath)) return fail(404, req);

    // Thumbnail transform when requested + applicable (see THUMB_WIDTHS
    // note). Falls back to the untransformed original if transform signing
    // fails for any reason — a broken thumbnail must never take down a
    // proof image that would have worked plain.
    const wParam = parseInt(url.searchParams.get("w") || "", 10);
    const wantTransform = THUMB_WIDTHS.has(wParam) && RASTER_RE.test(reqPath);

    let signedUrl = "";
    if (wantTransform) {
      const { data } = await admin.storage
        .from("artwork")
        .createSignedUrl(reqPath, SIGNED_TTL, { transform: { width: wParam, quality: 80 } });
      if (data?.signedUrl) signedUrl = data.signedUrl;
    }
    if (!signedUrl) {
      const { data, error } = await admin.storage
        .from("artwork").createSignedUrl(reqPath, SIGNED_TTL);
      if (error || !data?.signedUrl) return fail(404, req);
      signedUrl = data.signedUrl;
    }

    // 302 to the signed URL. Browser-cacheable (see the header note above) so
    // repeat views of the same artwork reuse the same signed URL instead of
    // re-downloading the original on every render. `private` keeps the
    // tokened mapping out of shared/proxy caches.
    return new Response(null, {
      status: 302,
      headers: {
        ...CORS,
        Location: signedUrl,
        "Cache-Control": `private, max-age=${REDIRECT_CACHE_SECS}`,
      },
    });
  } catch (err) {
    console.error("[artworkProof] error:", (err as Error).message);
    return fail(404, req);
  }
});
