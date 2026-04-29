// createQuoteFromPayload — bulk-insert a fully-formed quote in one shot.
//
// Use case: bypass the modal's click-by-click flow when you already have
// structured data — e.g. a customer pasted a spreadsheet, an integration
// produced a payload, or Claude is automating a quote draft.
//
// Auth: requires a Supabase user JWT in `accessToken`. The quote is owned by
// that user's profile (shop_owner = profile.email), matching the rest of the app.
//
// Returns: { quoteId, id } on success; { error } on failure.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// Normalize an incoming line item to the shape the quotes table expects.
// Accepts the same shape the modal uses (LineItemEditor output) OR a slimmer
// shape from automation; fills in defaults for missing fields.
function normalizeLineItem(raw: any, idx: number): any {
  const ts = Date.now();
  const sizes: Record<string, number> = {};
  if (raw?.sizes && typeof raw.sizes === "object") {
    for (const [k, v] of Object.entries(raw.sizes)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) sizes[k] = n;
    }
  }

  // Imprints can be a single object, an array, or absent. Normalize to array.
  let imprints: any[] = [];
  if (Array.isArray(raw?.imprints)) {
    imprints = raw.imprints;
  } else if (raw?.imprint && typeof raw.imprint === "object") {
    imprints = [raw.imprint];
  }
  if (imprints.length === 0) {
    imprints = [{
      id: `imp-${idx}-${ts}`,
      title: "",
      location: "Front",
      width: "",
      height: "",
      colors: 1,
      pantones: "",
      technique: "Screen Print",
      details: "",
      linked: false,
    }];
  } else {
    imprints = imprints.map((imp, i) => ({
      id: imp.id || `imp-${idx}-${i}-${ts}`,
      title: imp.title || "",
      location: imp.location || "Front",
      width: imp.width || "",
      height: imp.height || "",
      colors: Number(imp.colors) || 1,
      pantones: imp.pantones || "",
      technique: imp.technique || "Screen Print",
      details: imp.details || "",
      linked: !!imp.linked,
    }));
  }

  return {
    id: raw?.id || `li-${idx}-${ts}`,
    style: raw?.style || "",
    brand: raw?.brand || "",
    category: raw?.category || raw?.garment || "",
    garmentColor: raw?.garmentColor || raw?.color || "",
    garmentCost: Number(raw?.garmentCost) || 0,
    sizes,
    imprints,
    // Pass through optional catalog fields if provided
    ...(raw?.styleName ? { styleName: raw.styleName } : {}),
    ...(raw?.resolvedTitle ? { resolvedTitle: raw.resolvedTitle } : {}),
    ...(raw?.productNumber ? { productNumber: raw.productNumber } : {}),
    ...(raw?.supplier ? { supplier: raw.supplier } : {}),
  };
}

function generateQuoteId(): string {
  return `Q-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { accessToken, ...payload } = body;

    if (!accessToken) return json({ error: "Missing accessToken" }, 401);
    if (!Array.isArray(payload.line_items) || payload.line_items.length === 0) {
      return json({ error: "line_items must be a non-empty array" }, 400);
    }

    // Authenticate the calling user
    const supaUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: { user }, error: authErr } = await supaUser.auth.getUser(accessToken);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    // Resolve the user's profile to get shop_owner email + defaults
    const admin = adminClient();
    const { data: profile, error: profErr } = await admin
      .from("profiles")
      .select("id, email, default_tax_rate")
      .eq("auth_id", user.id)
      .single();
    if (profErr || !profile) return json({ error: "Profile not found" }, 404);

    // Optionally resolve customer_id by email if customer_id wasn't provided
    let customerId: string | null = payload.customer_id || null;
    let customerName: string = payload.customer_name || "Quote Inquiry";
    let customerEmail: string = (payload.customer_email || "").toLowerCase();

    if (!customerId && customerEmail) {
      const { data: cust } = await admin
        .from("customers")
        .select("id, name")
        .eq("email", customerEmail)
        .eq("shop_owner", profile.email)
        .maybeSingle();
      if (cust) {
        customerId = cust.id;
        customerName = cust.name;
      }
    } else if (!customerId && payload.customer_name) {
      // Try matching by name as a fallback
      const { data: cust } = await admin
        .from("customers")
        .select("id, name, email")
        .eq("name", payload.customer_name)
        .eq("shop_owner", profile.email)
        .maybeSingle();
      if (cust) {
        customerId = cust.id;
        customerName = cust.name;
        if (!customerEmail) customerEmail = (cust.email || "").toLowerCase();
      }
    }

    const lineItems = payload.line_items.map((li: any, i: number) => normalizeLineItem(li, i));

    const today = new Date().toISOString().split("T")[0];
    const inHands = payload.in_hands_date || payload.due_date || (() => {
      const d = new Date();
      d.setDate(d.getDate() + 14);
      return d.toISOString().split("T")[0];
    })();
    const expires = payload.expires_date || (() => {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      return d.toISOString().split("T")[0];
    })();

    const quoteId = payload.quote_id || generateQuoteId();

    const insertPayload: Record<string, unknown> = {
      quote_id: quoteId,
      shop_owner: profile.email,
      customer_id: customerId,
      customer_name: customerName,
      customer_email: customerEmail,
      job_title: payload.job_title || "",
      status: payload.status || "Draft",
      date: today,
      due_date: inHands,
      expires_date: expires,
      tax_rate: payload.tax_rate ?? profile.default_tax_rate ?? 0,
      line_items: lineItems,
      discount: Number(payload.discount) || 0,
      discount_type: payload.discount_type || "percent",
      rush_rate: Number(payload.rush_rate) || 0,
      extras: payload.extras || {},
      deposit_pct: Number(payload.deposit_pct) || 0,
      deposit_paid: !!payload.deposit_paid,
      notes: payload.notes || "",
      source: payload.source || "api",
      ...(payload.source_email_id ? { source_email_id: payload.source_email_id } : {}),
      ...(payload.broker_id ? { broker_id: payload.broker_id } : {}),
    };

    const { data: inserted, error: insertErr } = await admin
      .from("quotes")
      .insert(insertPayload)
      .select("id, quote_id")
      .single();

    if (insertErr) {
      console.error("createQuoteFromPayload insert failed:", insertErr.message);
      return json({ error: insertErr.message }, 500);
    }

    return json({
      quoteId: inserted.quote_id,
      id: inserted.id,
      lineItemCount: lineItems.length,
      customerMatched: !!customerId,
    });
  } catch (err) {
    console.error("createQuoteFromPayload error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
