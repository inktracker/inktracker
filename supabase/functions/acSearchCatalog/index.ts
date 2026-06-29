// AS Colour catalog search — Supabase Edge Function
//
// Body: { query?: string, category?: string, limit?: number, page?: number }
// Returns: { products: NormalisedProduct[], total: number, page, limit }
//
// AS Colour exposes GET /catalog/products/ for the full catalog and
// GET /catalog/products/{styleCode} for a single product. There is no native
// full-text search param documented, so we fetch the catalog (paginated) and
// filter client-side on title / styleCode / category.

import {
  AC_BASE,
  CORS,
  acFetch,
  credsFromProfile,
  normalizeProduct,
  type AcCreds,
} from "../_shared/ascolour.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { loadShopProfileForUser } from "../_shared/profileSecrets.ts";

const PAGE_SIZE = 250;

async function resolveAcCredentials(accessToken?: string): Promise<AcCreds | null> {
  if (accessToken) {
    try {
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      });
      const { data: { user } } = await supabase.auth.getUser(accessToken);
      if (user) {
        const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const { profile } = await loadShopProfileForUser(admin, user.id);
        const perShop = credsFromProfile(profile);
        if (perShop) return perShop;
      }
    } catch {}
  }
  return credsFromProfile(null);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // RL-01: rate-limit this anonymous, credential-bearing endpoint by client
    // IP — a server-derived key, never a client-supplied one (RL-02 lesson).
    // Each call fans out up to 5 upstream AS Colour requests on GLOBAL creds,
    // so an unbounded caller is a scraping / cost-amplification vector. 60/hr
    // per IP is generous for real wizard browsing (results are cached client-
    // side) while capping a scraper at ~300 upstream fetches/hr.
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const rlAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: underLimit } = await rlAdmin.rpc("check_request_rate", {
      p_key: `ac_catalog:${ip}`, p_limit_per_hr: 60,
    });
    if (underLimit === false) {
      return Response.json(
        { error: "Too many catalog requests — please slow down and try again shortly." },
        { status: 429, headers: CORS },
      );
    }

    const body = await req.json().catch(() => ({}));
    const { query = "", category = "", limit = 48, page = 1, accessToken } = body;

    const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    const creds = await resolveAcCredentials(accessToken || authHeader);
    if (!creds) {
      return Response.json({ error: "AS Colour credentials not configured" }, { status: 500, headers: CORS });
    }

    // Fetch all catalog pages (typically 2 pages, ~450 products total).
    const all: any[] = [];
    for (let pg = 1; pg <= 5; pg++) {
      const url = `${AC_BASE}/catalog/products/?pageNumber=${pg}&pageSize=${PAGE_SIZE}`;
      const { ok, status, data } = await acFetch(creds, url, {}, `acSearchCatalog:p${pg}`);
      if (!ok) {
        if (pg === 1) {
          return Response.json(
            { error: `AS Colour API error ${status}`, details: data },
            { status: status || 502, headers: CORS },
          );
        }
        break;
      }
      const items = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      all.push(...items);
      if (items.length < PAGE_SIZE) break; // last page
    }

    const normalised = all.map(normalizeProduct);

    const q = String(query).trim().toLowerCase();
    const cat = String(category).trim().toLowerCase();

    const filtered = normalised.filter((p) => {
      if (q) {
        const hay = `${p.styleCode} ${p.title} ${p.description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (cat && String(p.category).toLowerCase() !== cat) return false;
      return true;
    });

    const total = filtered.length;
    const start = (Math.max(1, page) - 1) * limit;
    const products = filtered.slice(start, start + limit);

    return Response.json({ products, total, page, limit }, { headers: CORS });
  } catch (err) {
    console.error("acSearchCatalog error:", err);
    return Response.json(
      { error: (err as Error).message },
      { status: 500, headers: CORS },
    );
  }
});
