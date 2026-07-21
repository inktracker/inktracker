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

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { captureError } from "../_shared/observability.ts";
import { normalizeLineItem } from "../_shared/wizardLineItem.js";

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

// normalizeLineItem moved to ../_shared/wizardLineItem.js (unit-tested).

function generateQuoteId(): string {
  return `Q-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // Malformed body = client error, not a server bug — reject without
    // falling through to the top-level catch's captureError, so bot junk
    // against this public endpoint can't page the operator.
    let body: Record<string, any>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid request." }, 400);
    }
    const { accessToken, ...payload } = body;

    if (!accessToken) return json({ error: "Missing accessToken" }, 401);
    if (!Array.isArray(payload.line_items) || payload.line_items.length === 0) {
      return json({ error: "line_items must be a non-empty array" }, 400);
    }
    // Bound the write so a (compromised/abusive) authed caller can't OOM the
    // function or bloat the quotes table with a giant payload.
    if (payload.line_items.length > 200) {
      return json({ error: "Too many line items (max 200)" }, 400);
    }
    if (JSON.stringify(body).length > 512 * 1024) {
      return json({ error: "Payload too large" }, 413);
    }

    // Authenticate the calling user
    const supaUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: { user }, error: authErr } = await supaUser.auth.getUser(accessToken);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    // Resolve the user's profile to get shop_owner email + defaults
    const admin = adminClient();

    // Per-user rate limit — this is the one authed write endpoint that lacked
    // one. 120 quote-creates/hour is generous for legit use (email scanner,
    // bulk import) and stops a trial account from spamming the table.
    const { data: underLimit } = await admin.rpc("check_request_rate", {
      p_key: `create_quote:${user.id}`, p_limit_per_hr: 120,
    });
    if (underLimit === false) {
      return json({ error: "Too many quote creations — please slow down and try again shortly." }, 429);
    }

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

    // Status allowlist — a caller must NOT be able to create a quote already in
    // a privileged/terminal state (Approved, Approved and Paid, Converted to
    // Order) and thereby skip the approval→payment→conversion state machine.
    // Only the safe creation states are accepted; anything else → Draft.
    const CREATABLE_STATUSES = new Set(["Draft", "Sent", "Pending"]);
    const safeStatus = CREATABLE_STATUSES.has(payload.status) ? payload.status : "Draft";

    const insertPayload: Record<string, unknown> = {
      quote_id: quoteId,
      shop_owner: profile.email,
      customer_id: customerId,
      customer_name: customerName,
      customer_email: customerEmail,
      job_title: payload.job_title || "",
      status: safeStatus,
      date: today,
      due_date: inHands,
      expires_date: expires,
      tax_rate: Math.max(0, Number(payload.tax_rate ?? profile.default_tax_rate ?? 0) || 0),
      line_items: lineItems,
      discount: Math.max(0, Number(payload.discount) || 0),
      discount_type: payload.discount_type === "flat" ? "flat" : "percent",
      rush_rate: Math.max(0, Number(payload.rush_rate) || 0),
      extras: payload.extras || {},
      deposit_pct: Math.min(100, Math.max(0, Number(payload.deposit_pct) || 0)),
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
    await captureError(err, { fn: "createQuoteFromPayload" });
    console.error("createQuoteFromPayload error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
