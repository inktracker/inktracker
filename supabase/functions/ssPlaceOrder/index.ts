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

    const { poNumber, shipTo, lines, shippingMethod = "Ground", testOrder = false } = await req.json();

    if (!poNumber) return Response.json({ error: "poNumber required" }, { status: 400, headers: CORS });
    if (!shipTo?.address1 || !shipTo?.city || !shipTo?.state || !shipTo?.zip) {
      return Response.json({ error: "Complete ship-to address required" }, { status: 400, headers: CORS });
    }
    if (!lines?.length) return Response.json({ error: "At least one order line required" }, { status: 400, headers: CORS });

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
      Lines: lines.map((l: any) => ({ Identifier: l.sku, Qty: l.qty })),
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
