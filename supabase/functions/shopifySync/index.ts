import { createClient } from "npm:@supabase/supabase-js@2";
import { loadProfileWithSecrets } from "../_shared/profileSecrets.ts";

const SHOPIFY_CLIENT_ID = Deno.env.get("SHOPIFY_CLIENT_ID")!;
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const CALLBACK_URL      = `${SUPABASE_URL}/functions/v1/shopifyOAuthCallback`;
const SCOPES            = "read_products,read_inventory";
const API_VERSION       = "2024-01";

const CORS = {
  "Access-Control-Allow-Origin": "https://www.inktracker.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { action, accessToken, shop: shopOverride } = body;

    const supabaseAdmin = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const profile = await loadProfileWithSecrets(supabaseAdmin, { auth_id: user.id });
    if (!profile) return json({ error: "Profile not found" }, 404);

    // ── getAuthUrl ──────────────────────────────────────────────────────
    if (action === "getAuthUrl") {
      const store = shopOverride || profile.shopify_store || "m2cf9p-aa.myshopify.com";
      const state = crypto.randomUUID();

      await supabaseAdmin
        .from("profiles")
        .update({ shopify_oauth_state: state })
        .eq("id", profile.id);

      const authUrl = `https://${store}/admin/oauth/authorize?` +
        `client_id=${SHOPIFY_CLIENT_ID}&scope=${SCOPES}` +
        `&redirect_uri=${encodeURIComponent(CALLBACK_URL)}&state=${state}`;

      return json({ authUrl });
    }

    // ── syncProducts ────────────────────────────────────────────────────
    if (action === "syncProducts") {
      const store = profile.shopify_store;
      const token = profile.shopify_access_token;
      if (!store || !token) return json({ error: "Shopify not connected" }, 400);

      const base = `https://${store}/admin/api/${API_VERSION}`;
      const headers = { "X-Shopify-Access-Token": token, "Content-Type": "application/json" };

      let products: any[] = [];
      let pageUrl: string | null = `${base}/products.json?limit=250&fields=id,title,variants,images,product_type`;
      while (pageUrl) {
        const res = await fetch(pageUrl, { headers });
        if (!res.ok) {
          const txt = await res.text();
          console.error("Shopify products fetch failed:", res.status, txt);
          return json({ error: "Failed to fetch products", detail: txt }, 502);
        }
        const data = await res.json();
        products = products.concat(data.products || []);

        const link = res.headers.get("Link") || "";
        const next = link.match(/<([^>]+)>;\s*rel="next"/);
        pageUrl = next ? next[1] : null;
      }

      const invItemIds: number[] = [];
      for (const p of products) {
        for (const v of (p.variants || [])) {
          if (v.inventory_item_id) invItemIds.push(v.inventory_item_id);
        }
      }

      const inventoryLevels: Record<number, number> = {};
      for (let i = 0; i < invItemIds.length; i += 50) {
        const batch = invItemIds.slice(i, i + 50);
        const invRes = await fetch(
          `${base}/inventory_levels.json?inventory_item_ids=${batch.join(",")}&limit=250`,
          { headers },
        );
        if (invRes.ok) {
          const invData = await invRes.json();
          for (const level of (invData.inventory_levels || [])) {
            inventoryLevels[level.inventory_item_id] =
              (inventoryLevels[level.inventory_item_id] || 0) + (level.available || 0);
          }
        }
      }

      const items = products.flatMap(p =>
        (p.variants || []).map((v: any) => ({
          shopify_product_id: p.id,
          shopify_variant_id: v.id,
          title: p.variants.length === 1 && v.title === "Default Title"
            ? p.title
            : `${p.title} — ${v.title}`,
          sku: v.sku || "",
          price: parseFloat(v.price) || 0,
          inventory_quantity: inventoryLevels[v.inventory_item_id] ?? v.inventory_quantity ?? 0,
          product_type: p.product_type || "",
          image: p.images?.[0]?.src || "",
        })),
      );

      return json({ products: items, count: items.length });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("shopifySync error:", err);
    return json({ error: err.message }, 500);
  }
});
