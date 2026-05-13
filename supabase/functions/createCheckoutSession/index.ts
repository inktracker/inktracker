// Handles quote loading, approval, Stripe checkout session creation, and shop owner notifications.
// Public — no JWT required (customer-facing quote payment page).

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";

const STRIPE_SECRET_KEY    = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function serviceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// Constant-time string equality. Prevents timing-based token guessing.
function safeEquals(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// ── getQuote ─────────────────────────────────────────────────────────────────

async function handleGetQuote(quoteId: string, token?: string) {
  const supabase = serviceClient();

  const { data: quote, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", quoteId)
    .single();

  if (error || !quote) return { error: "Quote not found." };

  // Token gate — anonymous callers must present the public_token that was
  // embedded in their email link. Without it, return the same 404 we'd give
  // for a missing row so we don't leak existence.
  if (!token || !quote.public_token || !safeEquals(token, quote.public_token)) {
    return { error: "Quote not found." };
  }

  const { data: shops } = await supabase
    .from("shops")
    .select("*")
    .eq("owner_email", quote.shop_owner)
    .limit(1);

  const shop = shops?.[0] ?? null;

  let customer = null;
  if (quote.customer_id) {
    const { data: c } = await supabase
      .from("customers")
      .select("*")
      .eq("id", quote.customer_id)
      .single();
    customer = c ?? null;
  }

  return { quote, shop, customer };
}

// ── approveQuote ─────────────────────────────────────────────────────────────

async function handleApproveQuote(quoteId: string, token?: string) {
  const supabase = serviceClient();

  // Verify the token matches BEFORE updating — never write without proof
  // the caller has the link we emailed.
  const { data: existing } = await supabase
    .from("quotes")
    .select("public_token")
    .eq("id", quoteId)
    .single();

  if (!existing?.public_token || !token || !safeEquals(token, existing.public_token)) {
    return { error: "Quote not found." };
  }

  const { data: quote, error } = await supabase
    .from("quotes")
    .update({ status: "Approved" })
    .eq("id", quoteId)
    .select("*")
    .single();

  if (error || !quote) return { error: "Failed to approve quote." };

  const { data: shops } = await supabase
    .from("shops")
    .select("*")
    .eq("owner_email", quote.shop_owner)
    .limit(1);

  const shop = shops?.[0] ?? null;

  let customer = null;
  if (quote.customer_id) {
    const { data: c } = await supabase
      .from("customers")
      .select("*")
      .eq("id", quote.customer_id)
      .single();
    customer = c ?? null;
  }

  return { quote, shop, customer };
}

// ── getOrder ──────────────────────────────────────────────────────────────────

async function handleGetOrder(orderId: string, token?: string) {
  const supabase = serviceClient();

  // Try by DB uuid first, then by order_id string
  let order: any = null;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (uuidRe.test(orderId)) {
    const { data } = await supabase.from("orders").select("*").eq("id", orderId).single();
    order = data;
  }

  if (!order) {
    const { data } = await supabase.from("orders").select("*").eq("order_id", orderId).single();
    order = data;
  }

  if (!order) return { error: "Order not found." };

  if (!token || !order.public_token || !safeEquals(token, order.public_token)) {
    return { error: "Order not found." };
  }

  const { data: shops } = await supabase
    .from("shops")
    .select("shop_name,logo_url,phone,email")
    .eq("owner_email", order.shop_owner)
    .limit(1);

  const shop = shops?.[0] ?? null;
  return { order, shop };
}

// ── approveArtwork ────────────────────────────────────────────────────────────

async function handleApproveArtwork(orderId: string, approvedBy: string, token?: string) {
  const supabase = serviceClient();

  // Token gate before write.
  const { data: existing } = await supabase
    .from("orders")
    .select("public_token")
    .eq("id", orderId)
    .single();

  if (!existing?.public_token || !token || !safeEquals(token, existing.public_token)) {
    return { error: "Order not found." };
  }

  const { data: order, error } = await supabase
    .from("orders")
    .update({
      art_approved: true,
      art_approved_at: new Date().toISOString(),
      art_approved_by: approvedBy || "Customer",
    })
    .eq("id", orderId)
    .select("*")
    .single();

  if (error || !order) return { error: "Failed to approve artwork." };
  return { order };
}

// ── createSession ─────────────────────────────────────────────────────────────

async function handleCreateSession(params: any) {
  if (!STRIPE_SECRET_KEY) return { error: "Stripe not configured." };

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
  const supabase = serviceClient();

  // Verify token before generating a checkout URL. Otherwise anyone could
  // create Stripe checkout sessions for any quote ID.
  const { data: existing } = await supabase
    .from("quotes")
    .select("public_token, shop_owner")
    .eq("id", params.quoteId)
    .single();
  if (!existing?.public_token || !params.token || !safeEquals(params.token, existing.public_token)) {
    return { error: "Quote not found." };
  }

  // Look up the shop's Stripe Connect account. Direct Charges model — the
  // shop is merchant of record, their name on the customer's CC statement,
  // money goes straight to them, InkTracker doesn't take a cut.
  const { data: shop } = await supabase
    .from("shops")
    .select("stripe_account_id, stripe_account_status")
    .eq("owner_email", existing.shop_owner)
    .maybeSingle();
  if (!shop?.stripe_account_id || shop.stripe_account_status !== "active") {
    return {
      error: shop?.stripe_account_id
        ? "This shop's Stripe account isn't ready to accept payments yet. Please contact them."
        : "This shop hasn't connected Stripe yet. Please contact them to complete payment another way.",
    };
  }

  const origin = params.origin ?? "https://www.inktracker.app";
  const successUrl = `${origin}/quotepaymentSuccess?session_id={CHECKOUT_SESSION_ID}&quote_id=${params.quoteId}&is_deposit=${params.isDeposit ? "1" : "0"}&amount=${params.amountPaid || 0}&shop_owner=${encodeURIComponent(params.shopOwnerEmail || "")}`;
  // Carry quote_id + token so the cancel page can offer "Return to Quote".
  // Without the token, /quotepayment refuses to load (security gate), so a
  // customer who hits cancel would otherwise land on a dead end.
  const cancelUrl  = `${origin}/quotepaymentCancel?quote_id=${params.quoteId}&token=${encodeURIComponent(params.token)}`;

  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      customer_email: params.customerEmail || undefined,
      line_items: (params.lineItems ?? []).map((li: any) => ({
        price_data: {
          currency: "usd",
          unit_amount: li.unit_amount,
          product_data: { name: li.name, description: li.description ?? undefined },
        },
        quantity: li.quantity ?? 1,
      })),
      success_url: successUrl,
      cancel_url:  cancelUrl,
      metadata: {
        quote_id: params.quoteId,
        is_deposit: params.isDeposit ? "1" : "0",
      },
      // No application_fee_amount — InkTracker takes 0% of the customer
      // payment. Revenue is the monthly subscription only.
    },
    {
      // ── Direct Charges ──────────────────────────────────────────
      // Tells Stripe to create the session ON the connected account,
      // not the platform. The shop is the merchant; the customer's
      // statement shows the shop's name; funds go to the shop's
      // Stripe balance with no InkTracker leg. The stripeWebhook
      // must be configured to receive events from connected accounts
      // for this checkout.session.completed event to reach us.
      stripeAccount: shop.stripe_account_id,
    },
  );

  // Don't change status here — the stripeWebhook confirms payment and sets the
  // correct status after Stripe actually charges the customer. Marking it here
  // would leave the quote in a paid state if the customer abandons checkout.

  return { url: session.url };
}

// ── Main ──────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { action, quoteId, token, ...rest } = body;

    let result: any;

    switch (action) {
      case "getQuote":
        result = await handleGetQuote(quoteId, token);
        break;
      case "approveQuote":
        result = await handleApproveQuote(quoteId, token);
        break;
      case "createSession":
        // createSession requires a verified token before generating a Stripe URL —
        // otherwise an attacker could create checkout sessions for any quote.
        result = await handleCreateSession({ quoteId, token, ...rest });
        break;
      case "getOrder":
        result = await handleGetOrder(rest.orderId ?? quoteId, token);
        break;
      case "approveArtwork":
        result = await handleApproveArtwork(rest.orderId, rest.approvedBy ?? "Customer", token);
        break;
      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400, headers: CORS });
    }

    return Response.json(result, { headers: CORS });
  } catch (err) {
    console.error("[createCheckoutSession] error:", err);
    return Response.json({ error: String(err.message ?? err) }, { status: 500, headers: CORS });
  }
});
