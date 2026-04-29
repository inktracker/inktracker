// QuickBooks webhook receiver
// QB POSTs signed payloads here when invoices are paid.
// Auto-converts the corresponding InkTracker quote to an order.
//
// QB webhook payload shape:
// { eventNotifications: [{ realmId, dataChangeEvent: { entities: [{ name, id, operation, lastUpdated }] } }] }
//
// Deploy: npx supabase functions deploy qbWebhook --no-verify-jwt
// Set secret: npx supabase secrets set QB_WEBHOOK_VERIFIER_TOKEN=<from Intuit Developer Portal>

import { createClient } from "npm:@supabase/supabase-js@2";

const QB_BASE               = "https://quickbooks.api.intuit.com/v3/company";
const QB_VERIFIER_TOKEN     = Deno.env.get("QB_WEBHOOK_VERIFIER_TOKEN") ?? "";
const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, intuit-signature",
};

// ── Signature verification ───────────────────────────────────────────────────

async function verifySignature(rawBody: string, signature: string): Promise<boolean> {
  if (!QB_VERIFIER_TOKEN || !signature) return !QB_VERIFIER_TOKEN; // skip if no token configured
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(QB_VERIFIER_TOKEN),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const computed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
    const expectedB64 = btoa(String.fromCharCode(...new Uint8Array(computed)));
    return expectedB64 === signature;
  } catch {
    return false;
  }
}

// ── QB API helpers ───────────────────────────────────────────────────────────

async function qbGet(accessToken: string, realmId: string, path: string) {
  const url = `${QB_BASE}/${realmId}/${path}?minorversion=65`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`QB GET ${path} failed: ${res.status}`);
  return res.json();
}

// ── Token refresh ────────────────────────────────────────────────────────────

const QB_CLIENT_ID     = Deno.env.get("QB_CLIENT_ID")     ?? "ABJLeI2LHqN4eXU90P8rozRsksp5DqdjYvIrzZQ9P7jhIeN7Cf";
const QB_CLIENT_SECRET = Deno.env.get("QB_CLIENT_SECRET") ?? "RtjTp4lofvUVVGucf0qir6bSYhRZnycdVM0rWJdo";
const QB_TOKEN_URL     = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

async function getAccessToken(supabase: any, profile: any): Promise<string> {
  const expiresAt = new Date(profile.qb_token_expires_at).getTime();
  if (Date.now() < expiresAt - 5 * 60 * 1000) return profile.qb_access_token;

  const res = await fetch(QB_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: profile.qb_refresh_token }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const fresh = await res.json();

  await supabase.from("profiles").update({
    qb_access_token:     fresh.access_token,
    qb_refresh_token:    fresh.refresh_token ?? profile.qb_refresh_token,
    qb_token_expires_at: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
  }).eq("id", profile.id);

  return fresh.access_token;
}

// ── Convert quote → order (mirrors Quotes.jsx handleConvert) ─────────────────

function makeOrderId() {
  return `ORD-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-5)}`;
}

async function convertQuoteToOrder(supabase: any, quote: any) {
  const orderId = makeOrderId();

  const isBroker = Boolean(quote.broker_id || quote.broker_email);

  // Use stored totals from the quote — never recalculate to avoid NaN/mismatch
  const subtotal = parseFloat(quote.subtotal ?? 0);
  const tax      = parseFloat(quote.tax ?? 0);
  const total    = parseFloat(quote.total ?? 0) || (subtotal + tax);

  await supabase.from("orders").insert({
    order_id:           orderId,
    shop_owner:         quote.shop_owner,
    broker_id:          quote.broker_id || "",
    broker_name:        quote.broker_name || "",
    broker_company:     quote.broker_company || "",
    customer_id:        quote.customer_id,
    customer_name:      quote.customer_name,
    broker_client_name: isBroker ? (quote.customer_name || "") : "",
    job_title:          quote.job_title || "",
    date:               quote.date,
    due_date:           quote.due_date || null,
    status:             "Art Approval",
    line_items:         quote.line_items,
    notes:              quote.notes,
    rush_rate:          quote.rush_rate,
    extras:             quote.extras,
    discount:           quote.discount,
    discount_type:      quote.discount_type || "percent",
    tax_rate:           isBroker ? 0 : quote.tax_rate,
    subtotal,
    tax,
    total,
    paid:               false,
    selected_artwork:   quote.selected_artwork || [],
  });

  // Mark quote as converted
  await supabase.from("quotes").update({
    status:             "Converted to Order",
    converted_order_id: orderId,
    converted_at:       new Date().toISOString(),
    deposit_paid:       true,
  }).eq("id", quote.id);

  console.error(`[qbWebhook] Quote ${quote.quote_id} → Order ${orderId}`);
}

// ── Core: find quote by QB invoice ID and mark paid ──────────────────────────

async function handlePaidInvoice(supabase: any, qbInvoiceId: string) {
  const { data: quote, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("qb_invoice_id", qbInvoiceId)
    .maybeSingle();

  if (error || !quote) {
    console.error(`[qbWebhook] No quote found for QB invoice ${qbInvoiceId}`);
    return;
  }

  if (quote.status === "Converted to Order" || quote.converted_order_id) {
    console.error(`[qbWebhook] Quote ${quote.quote_id} already converted — skipping`);
    return;
  }

  console.error(`[qbWebhook] Marking quote ${quote.quote_id} as paid and converting to order`);
  await convertQuoteToOrder(supabase, quote);
}

// ── Process one notification ─────────────────────────────────────────────────

async function processNotification(supabase: any, notification: any) {
  const { realmId, dataChangeEvent } = notification;
  if (!realmId || !dataChangeEvent?.entities) return;

  // Look up the shop's QB tokens by realm ID
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, qb_access_token, qb_refresh_token, qb_token_expires_at")
    .eq("qb_realm_id", realmId)
    .maybeSingle();

  if (!profile?.qb_access_token) {
    console.error(`[qbWebhook] No profile found for realmId ${realmId}`);
    return;
  }

  const accessToken = await getAccessToken(supabase, profile);

  for (const entity of dataChangeEvent.entities) {
    try {
      if (entity.name === "Payment" && entity.operation === "Create") {
        // Fetch the payment to find which invoices it paid
        const data = await qbGet(accessToken, realmId, `payment/${entity.id}`);
        const payment = data?.Payment;

        const invoiceIds: string[] = [];
        for (const line of payment?.Line ?? []) {
          for (const linked of line?.LinkedTxn ?? []) {
            if (linked?.TxnType === "Invoice") invoiceIds.push(linked.TxnId);
          }
        }

        for (const invId of invoiceIds) {
          await handlePaidInvoice(supabase, invId);
        }
      }

      if (entity.name === "Invoice" && entity.operation === "Update") {
        // Fetch the invoice to check if Balance = 0 (fully paid)
        const data = await qbGet(accessToken, realmId, `invoice/${entity.id}`);
        const balance = Number(data?.Invoice?.Balance ?? -1);
        if (balance === 0) {
          await handlePaidInvoice(supabase, entity.id);
        }
      }
    } catch (err) {
      console.error(`[qbWebhook] Error processing entity ${entity.name}/${entity.id}:`, err.message);
    }
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // QB sends a GET to verify the endpoint is reachable on initial setup
  if (req.method === "GET") {
    return new Response("ok", { status: 200, headers: CORS });
  }

  try {
    const rawBody = await req.text();

    // Verify HMAC signature if a verifier token is configured
    const signature = req.headers.get("intuit-signature") ?? "";
    const valid = await verifySignature(rawBody, signature);
    if (!valid) {
      console.error("[qbWebhook] Signature verification failed");
      return new Response("Unauthorized", { status: 401, headers: CORS });
    }

    const body = JSON.parse(rawBody);
    const notifications = body?.eventNotifications ?? [];

    // Service-role client for cross-user operations
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    await Promise.all(notifications.map((n: any) => processNotification(supabase, n)));

    // QB expects a 200 response to confirm receipt
    return new Response("ok", { status: 200, headers: CORS });
  } catch (err) {
    console.error("[qbWebhook] Error:", err);
    // Still return 200 so QB doesn't keep retrying on parse errors
    return new Response("ok", { status: 200, headers: CORS });
  }
});
