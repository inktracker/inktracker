// QuickBooks webhook receiver
// QB POSTs signed payloads here when invoices are paid.
// Auto-converts the corresponding InkTracker quote to an order.
//
// QB webhook payload shape:
// { eventNotifications: [{ realmId, dataChangeEvent: { entities: [{ name, id, operation, lastUpdated }] } }] }
//
// Deploy: npx supabase functions deploy qbWebhook --no-verify-jwt

import { loadProfileWithSecrets, updateProfileSecrets } from "../_shared/profileSecrets.ts";
import { makeOrderId } from "../_shared/qbInvoice.js";
import {
  buildPaidInvoiceQuery,
  decidePaidInvoiceAction,
  buildOrderInsertFromQuote,
  extractInvoiceIdsFromPayment,
  isInvoiceFullyPaid,
  PAID_INVOICE_ACTIONS,
} from "../_shared/qbWebhookLogic.js";
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

// Constant-time string comparison. Standard practice for any verifier check
// where a length-prefix short-circuit could leak timing info about which
// position the comparison diverged at.
function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function verifySignature(rawBody: string, signature: string): Promise<boolean> {
  // Fail closed — refuse events without verifier token configured or without a
  // signature header. Previous behavior returned true when no token was set,
  // which let unsigned events through.
  if (!QB_VERIFIER_TOKEN || !signature) return false;
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
    return timingSafeEqual(expectedB64, signature);
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

const QB_CLIENT_ID     = Deno.env.get("QB_CLIENT_ID")     ?? "";
const QB_CLIENT_SECRET = Deno.env.get("QB_CLIENT_SECRET") ?? "";
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
  if (!res.ok) {
    console.error(`[qbWebhook] Token refresh failed: ${res.status}`);
    throw new Error("QuickBooks connection expired. Please reconnect in Account settings.");
  }
  const fresh = await res.json();

  await updateProfileSecrets(supabase, profile.id, {
    qb_access_token:     fresh.access_token,
    qb_refresh_token:    fresh.refresh_token ?? profile.qb_refresh_token,
    qb_token_expires_at: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
  });

  return fresh.access_token;
}

// ── Convert quote → order (mirrors Quotes.jsx handleConvert) ─────────────────

// Pure logic + tests live in ../_shared/qbInvoice.js + __tests__.

async function convertQuoteToOrder(supabase: any, quote: any) {
  const orderId = makeOrderId();
  const orderRow = buildOrderInsertFromQuote(quote, orderId);

  await supabase.from("orders").insert(orderRow);

  // Mark quote as converted. Scope by both id AND shop_owner — same
  // tenant-scoping rule we apply on the read side; the service-role
  // client would otherwise update across tenants on a row-id collision
  // (e.g. if a quote.id was ever changed manually).
  await supabase.from("quotes").update({
    status:             "Converted to Order",
    converted_order_id: orderId,
    converted_at:       new Date().toISOString(),
    deposit_paid:       true,
  }).eq("id", quote.id).eq("shop_owner", quote.shop_owner);

  console.error(`[qbWebhook] Quote ${quote.quote_id} → Order ${orderId}`);
}

// ── Core: find quote by QB invoice ID and mark paid ──────────────────────────

async function handlePaidInvoice(supabase: any, qbInvoiceId: string, shopOwner: string) {
  // CRITICAL: scope the lookup by BOTH qb_invoice_id and shop_owner.
  // QB invoice ids are realm-scoped (not globally unique), so without
  // the shop_owner filter a webhook for Shop B's invoice 1042 could
  // match — and convert — Shop A's quote 1042. See qbWebhookLogic.js
  // for the full rationale.
  const { data: quote, error } = await buildPaidInvoiceQuery(supabase, qbInvoiceId, shopOwner);

  if (error) {
    console.error(`[qbWebhook] DB error looking up invoice ${qbInvoiceId} for ${shopOwner}: ${error.message}`);
    return;
  }

  const decision = decidePaidInvoiceAction(quote);
  if (decision.action !== PAID_INVOICE_ACTIONS.CONVERT) {
    console.error(`[qbWebhook] invoice ${qbInvoiceId} for ${shopOwner}: ${decision.action} — ${decision.reason}`);
    return;
  }

  console.error(`[qbWebhook] Marking quote ${quote.quote_id} as paid and converting to order`);
  await convertQuoteToOrder(supabase, quote);
}

// ── Process one notification ─────────────────────────────────────────────────

async function processNotification(supabase: any, notification: any) {
  const { realmId, dataChangeEvent } = notification;
  if (!realmId || !dataChangeEvent?.entities) return;

  // Look up the shop's QB tokens by realm ID — find profile first, then load secrets
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("id, shop_owner")
    .eq("qb_realm_id", realmId)
    .maybeSingle();
  const profile = profileRow ? await loadProfileWithSecrets(supabase, { id: profileRow.id }) : null;

  if (!profile?.qb_access_token) {
    console.error(`[qbWebhook] No profile found for realmId ${realmId}`);
    return;
  }
  // Defensive: a profile WITHOUT shop_owner should never exist (NOT
  // NULL in the schema), but if one ever does we MUST refuse to
  // process — otherwise handlePaidInvoice's tenant filter degenerates
  // and the cross-tenant bug returns.
  const shopOwner: string = profile.shop_owner;
  if (!shopOwner) {
    console.error(`[qbWebhook] Profile for realmId ${realmId} has no shop_owner — refusing to process`);
    return;
  }

  const accessToken = await getAccessToken(supabase, profile);

  for (const entity of dataChangeEvent.entities) {
    try {
      if (entity.name === "Payment" && entity.operation === "Create") {
        // Fetch the payment to find which invoices it paid
        const data = await qbGet(accessToken, realmId, `payment/${entity.id}`);
        const invoiceIds = extractInvoiceIdsFromPayment(data?.Payment);
        for (const invId of invoiceIds) {
          await handlePaidInvoice(supabase, invId, shopOwner);
        }
      }

      if (entity.name === "Invoice" && entity.operation === "Update") {
        // Fetch the invoice to check if Balance = 0 (fully paid)
        const data = await qbGet(accessToken, realmId, `invoice/${entity.id}`);
        if (isInvoiceFullyPaid(data?.Invoice)) {
          await handlePaidInvoice(supabase, entity.id, shopOwner);
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
