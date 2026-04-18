// S&S Activewear order placement — Supabase Edge Function

const SS_BASE = "https://api.ssactivewear.com/v2";
const SS_ACCOUNT = Deno.env.get("SS_ACCOUNT_NUMBER") ?? "61047";
const SS_KEY = Deno.env.get("SS_API_KEY") ?? "e3fde568-dd4a-4b7a-9258-02e92fac3498";
const AUTH = btoa(`${SS_ACCOUNT}:${SS_KEY}`);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function ssHeaders() {
  return {
    Authorization: `Basic ${AUTH}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

interface OrderLine {
  sku: string;
  qty: number;
}

interface ShipTo {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
  phone?: string;
  email?: string;
}

interface PlaceOrderRequest {
  poNumber: string;
  shipTo: ShipTo;
  lines: OrderLine[];
  shippingMethod?: string;
  testOrder?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body: PlaceOrderRequest = await req.json();
    const { poNumber, shipTo, lines, shippingMethod = "GROUND", testOrder = false } = body;

    if (!poNumber) {
      return Response.json({ error: "poNumber required" }, { status: 400, headers: CORS });
    }
    if (!shipTo?.address1 || !shipTo?.city || !shipTo?.state || !shipTo?.zip) {
      return Response.json({ error: "Complete ship-to address required" }, { status: 400, headers: CORS });
    }
    if (!lines?.length) {
      return Response.json({ error: "At least one order line required" }, { status: 400, headers: CORS });
    }

    const ssOrder = {
      testOrder,
      poNumber,
      shippingMethod,
      shipTo: {
        name: shipTo.name ?? "",
        address1: shipTo.address1,
        address2: shipTo.address2 ?? "",
        city: shipTo.city,
        state: shipTo.state,
        zip: shipTo.zip,
        country: shipTo.country ?? "US",
        phone: shipTo.phone ?? "",
        email: shipTo.email ?? "",
      },
      lines: lines.map((l) => ({ sku: l.sku, qty: l.qty })),
    };

    const res = await fetch(`${SS_BASE}/orders/`, {
      method: "POST",
      headers: ssHeaders(),
      body: JSON.stringify(ssOrder),
    });

    const responseText = await res.text();
    let responseData: any;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw: responseText };
    }

    if (!res.ok) {
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
