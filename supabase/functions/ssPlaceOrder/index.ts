import { createClient } from "npm:@supabase/supabase-js@2";
import { requireActiveSubscription } from "../_shared/subscriptionGuard.ts";

const SS_BASE = "https://api.ssactivewear.com/v2";
const SS_ACCOUNT = Deno.env.get("SS_ACCOUNT_NUMBER")!;
const SS_KEY = Deno.env.get("SS_API_KEY")!;
const AUTH = btoa(`${SS_ACCOUNT}:${SS_KEY}`);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function ssHeaders() {
  return { Authorization: `Basic ${AUTH}`, Accept: "application/json", "Content-Type": "application/json" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // Subscription check — placing orders costs real money
    const authHeader = req.headers.get("authorization") || "";
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const { data: profile } = await admin.from("profiles").select("subscription_tier, subscription_status, trial_ends_at").eq("auth_id", user.id).maybeSingle();
        const blocked = requireActiveSubscription(profile);
        if (blocked) return blocked;
      }
    }

    const { poNumber, shipTo, lines, shippingMethod = "Ground", testOrder = false, warehouse = "" } = await req.json();

    if (!poNumber) return Response.json({ error: "poNumber required" }, { status: 400, headers: CORS });
    if (!shipTo?.address1 || !shipTo?.city || !shipTo?.state || !shipTo?.zip) {
      return Response.json({ error: "Complete ship-to address required" }, { status: 400, headers: CORS });
    }
    if (!lines?.length) return Response.json({ error: "At least one order line required" }, { status: 400, headers: CORS });

    // Resolve real S&S SKUs — our cart stores style+color+size but S&S needs internal SKU IDs
    const resolvedLines: { Identifier: string; Qty: number }[] = [];
    const skuCache: Record<string, Record<string, string>> = {}; // style -> {colorSize -> sku}

    for (const l of lines) {
      // Try to extract style number from our guessed SKU (e.g. "3480PINK-S" -> style "3480")
      const styleMatch = (l.sku || "").match(/^(\d{3,5})/);
      const style = l.style || (styleMatch ? styleMatch[1] : "");
      const size = l.size || (l.sku || "").split("-").pop() || "";
      const color = l.color || "";

      if (!style) {
        resolvedLines.push({ Identifier: l.sku, Qty: l.qty });
        continue;
      }

      // Fetch product data from S&S if we haven't already for this style
      // Must resolve styleID from styles endpoint first, then fetch products by styleid
      if (!skuCache[style]) {
        try {
          // Step 1: Get styleID from styles search
          const stylesRes = await fetch(`${SS_BASE}/styles?search=${encodeURIComponent(style)}`, {
            headers: ssHeaders(),
            signal: AbortSignal.timeout(10000),
          });
          let styleID = "";
          if (stylesRes.ok) {
            const styles = await stylesRes.json();
            if (Array.isArray(styles) && styles.length > 0) {
              // Match by styleName (user-facing code like "3480") or partNumber
              const match = styles.find((s: any) =>
                String(s.styleName || "").toUpperCase() === style.toUpperCase() ||
                String(s.partNumber || "").toUpperCase() === style.toUpperCase()
              ) || styles[0];
              styleID = String(match.styleID || "");
            }
          }

          // Step 2: Fetch products by styleID
          if (!styleID) {
            skuCache[style] = {};
            continue;
          }
          const productsRes = await fetch(`${SS_BASE}/products?styleid=${styleID}`, {
            headers: ssHeaders(),
            signal: AbortSignal.timeout(15000),
          });
          const productsText = await productsRes.text();
          console.error(`[ssPlaceOrder] Products ${style} (styleID=${styleID}): status=${productsRes.status} len=${productsText.length}`);
          if (productsRes.ok) {
            let rows: any;
            try { rows = JSON.parse(productsText); } catch { rows = []; }
            const map: Record<string, string> = {};
            console.error(`[ssPlaceOrder] Products for style ${style}: ${Array.isArray(rows) ? rows.length : typeof rows} rows`);
            for (const row of (Array.isArray(rows) ? rows : [])) {
              const cn = (row.colorName || "").toUpperCase();
              const sn = (row.sizeName || "").toUpperCase();
              const sku = row.sku || "";
              if (cn && sn && sku) map[`${cn}-${sn}`] = sku;
            }
            console.error(`[ssPlaceOrder] SKU map keys: ${Object.keys(map).slice(0, 10).join(", ")}`);
            skuCache[style] = map;
          } else {
            console.error(`[ssPlaceOrder] Products fetch failed: ${productsRes.status} ${productsText.slice(0, 200)}`);
            skuCache[style] = {};
          }
        } catch {
          skuCache[style] = {};
        }
      }

      // Look up the real SKU
      const key = `${color.toUpperCase()}-${size.toUpperCase()}`;
      const realSku = skuCache[style]?.[key];
      console.error(`[ssPlaceOrder] Lookup: style=${style} key=${key} → ${realSku || "MISS"}`);
      if (realSku) {
        resolvedLines.push({ Identifier: realSku, Qty: l.qty });
      } else {
        // Fall back to guessed SKU — S&S will reject if invalid
        resolvedLines.push({ Identifier: l.sku || `${style}-${size}`, Qty: l.qty });
      }
    }

    // S&S API uses PascalCase field names
    const ssOrder = {
      TestOrder: testOrder,
      PONumber: poNumber,
      ShippingMethod: shippingMethod,
      ShippingAddress: {
        Name: shipTo.name ?? "",
        Address: shipTo.address1,
        Address2: shipTo.address2 ?? "",
        City: shipTo.city,
        State: shipTo.state,
        Zip: shipTo.zip,
        Country: shipTo.country ?? "US",
        Phone: shipTo.phone ?? "",
        Email: shipTo.email ?? "",
      },
      Lines: resolvedLines.map(l => warehouse ? { ...l, Warehouse: warehouse } : l),
    };

    console.log("S&S order payload:", JSON.stringify(ssOrder));

    const res = await fetch(`${SS_BASE}/orders/`, {
      method: "POST",
      headers: ssHeaders(),
      body: JSON.stringify(ssOrder),
    });

    const responseText = await res.text();
    let responseData: any;
    try { responseData = JSON.parse(responseText); } catch { responseData = { raw: responseText }; }

    if (!res.ok) {
      console.error("S&S order failed:", res.status, responseText);
      return Response.json(
        { error: `S&S order failed (${res.status})`, details: responseData },
        { status: res.status, headers: CORS }
      );
    }

    return Response.json({ success: true, order: responseData }, { headers: CORS });
  } catch (err) {
    console.error("ssPlaceOrder error:", err);
    return Response.json({ error: err.message }, { status: 500, headers: CORS });
  }
});
