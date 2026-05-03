// Handles quote loading, approval, Stripe checkout session creation, and shop owner notifications.
// Public — no JWT required (customer-facing quote payment page).

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";

const STRIPE_SECRET_KEY    = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL           = Deno.env.get("FROM_EMAIL") ?? "quotes@inktracker.app";
const FROM_NAME            = Deno.env.get("FROM_NAME")  ?? "InkTracker";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function serviceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

function fmtMoney(n: number) {
  return `$${Number(n || 0).toFixed(2)}`;
}

// ── getQuote ─────────────────────────────────────────────────────────────────

async function handleGetQuote(quoteId: string) {
  const supabase = serviceClient();

  const { data: quote, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", quoteId)
    .single();

  if (error || !quote) return { error: "Quote not found." };

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

async function handleApproveQuote(quoteId: string) {
  const supabase = serviceClient();

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

async function handleGetOrder(orderId: string) {
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

  const { data: shops } = await supabase
    .from("shops")
    .select("shop_name,logo_url,phone,email")
    .eq("owner_email", order.shop_owner)
    .limit(1);

  const shop = shops?.[0] ?? null;
  return { order, shop };
}

// ── approveArtwork ────────────────────────────────────────────────────────────

async function handleApproveArtwork(orderId: string, approvedBy: string) {
  const supabase = serviceClient();

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

// ── notifyShopOwner ───────────────────────────────────────────────────────────

async function handleNotifyShopOwner(params: any) {
  if (!RESEND_API_KEY) {
    console.log("[notifyShopOwner] No RESEND_API_KEY — skipping notification");
    return { sent: false, reason: "no_api_key" };
  }

  const supabase = serviceClient();

  // Load quote
  const { data: quote } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", params.quoteId)
    .single();

  if (!quote) return { error: "Quote not found" };

  // Find shop owner email from profiles
  const ownerEmail = params.shopOwnerEmail || quote.shop_owner;
  if (!ownerEmail) return { error: "No shop owner email" };

  const amountPaid = fmtMoney(params.amountPaid || 0);
  const paymentType = params.isDeposit ? "Deposit" : "Full Payment";
  const subject = `Payment Received — Quote #${quote.quote_id}`;

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="color:#1e293b">Payment Received!</h2>
      <p style="color:#475569;line-height:1.6">
        Good news — <strong>${quote.customer_name}</strong> has paid their quote.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        <tr>
          <td style="padding:8px 0;color:#94a3b8;font-size:14px">Quote #</td>
          <td style="padding:8px 0;font-weight:600;color:#1e293b">${quote.quote_id}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#94a3b8;font-size:14px">Customer</td>
          <td style="padding:8px 0;font-weight:600;color:#1e293b">${quote.customer_name}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#94a3b8;font-size:14px">Payment Type</td>
          <td style="padding:8px 0;font-weight:600;color:#1e293b">${paymentType}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#94a3b8;font-size:14px">Amount Paid</td>
          <td style="padding:8px 0;font-weight:700;color:#4f46e5;font-size:18px">${amountPaid}</td>
        </tr>
        ${quote.due_date ? `<tr><td style="padding:8px 0;color:#94a3b8;font-size:14px">In-Hands Date</td><td style="padding:8px 0;font-weight:600;color:#1e293b">${quote.due_date}</td></tr>` : ""}
      </table>
      ${params.isDeposit ? `<p style="color:#f59e0b;font-size:13px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px"><strong>Note:</strong> This was a deposit payment. The remaining balance is due upon completion.</p>` : ""}
      <p style="color:#94a3b8;font-size:12px;margin-top:32px">Sent by InkTracker</p>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [ownerEmail],
      subject,
      html,
    }),
  });

  const data = await res.json();
  if (!res.ok) console.error("[notifyShopOwner] Resend error:", data);
  return { sent: res.ok };
}

// ── createSession ─────────────────────────────────────────────────────────────

async function handleCreateSession(params: any) {
  if (!STRIPE_SECRET_KEY) return { error: "Stripe not configured." };

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
  const supabase = serviceClient();

  const origin = params.origin ?? "https://www.inktracker.app";
  const successUrl = `${origin}/quotepaymentSuccess?session_id={CHECKOUT_SESSION_ID}&quote_id=${params.quoteId}&is_deposit=${params.isDeposit ? "1" : "0"}&amount=${params.amountPaid || 0}&shop_owner=${encodeURIComponent(params.shopOwnerEmail || "")}`;
  const cancelUrl  = `${origin}/quotepaymentCancel`;

  const session = await stripe.checkout.sessions.create({
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
  });

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
    const { action, quoteId, ...rest } = body;

    let result: any;

    switch (action) {
      case "getQuote":
        result = await handleGetQuote(quoteId);
        break;
      case "approveQuote":
        result = await handleApproveQuote(quoteId);
        break;
      case "createSession":
        result = await handleCreateSession({ quoteId, ...rest });
        break;
      case "notifyShopOwner":
        result = await handleNotifyShopOwner({ quoteId, ...rest });
        break;
      case "getOrder":
        result = await handleGetOrder(rest.orderId ?? quoteId);
        break;
      case "approveArtwork":
        result = await handleApproveArtwork(rest.orderId, rest.approvedBy ?? "Customer");
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
