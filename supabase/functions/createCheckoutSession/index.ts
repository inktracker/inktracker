// Handles quote loading, approval, Stripe checkout session creation, and shop owner notifications.
// Public — no JWT required (customer-facing quote payment page).

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";
import {
  chooseQuoteApprovalRecipient,
  chooseArtworkApprovalRecipient,
  buildQuoteApprovalEmail,
  buildArtworkApprovalEmail,
  sendAndLogApprovalNotification,
} from "../_shared/approvalNotificationEmail.js";
import { toCustomerFacingQuote } from "../_shared/customerFacingQuote.js";
import { insertShopNotification } from "../_shared/notifications.js";

// The quote/customer rows returned to the UNauthenticated payment page must
// not leak broker wholesale pricing or shop-internal customer PII. We:
//   • run the quote through toCustomerFacingQuote (overwrites broker-side
//     subtotal/total/_ppp with the client-facing values) and drop the
//     public_token from the response body, and
//   • return only an allowlist of customer fields the page actually uses.
function publicSafeQuote(quote: any) {
  if (!quote) return quote;
  const safe = toCustomerFacingQuote(quote);
  // Don't echo the secret token back in the response body.
  const { public_token: _drop, ...rest } = safe;
  return rest;
}

const PUBLIC_CUSTOMER_FIELDS = ["name", "company", "email", "default_deposit_pct"];
function publicSafeCustomer(customer: any) {
  if (!customer) return customer;
  const out: Record<string, any> = {};
  for (const k of PUBLIC_CUSTOMER_FIELDS) {
    if (customer[k] !== undefined) out[k] = customer[k];
  }
  return out;
}

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

// The shops table only carries shop_name + stripe_account_*. The shop's brand
// + contact fields (logo_url, phone, email, address, city, state, zip, website)
// all live on profiles. Selecting any of those from shops errors (42703) and,
// because the error is swallowed, silently nulls the WHOLE shop object — which
// is why customer quote/order pages fell back to the "Shop"/"S" placeholder.
// This merges the owner's profile fields onto the shop row.
async function withOwnerProfile(supabase: any, shop: any, ownerEmail: string) {
  if (!shop) return shop;
  const { data: prof } = await supabase
    .from("profiles")
    .select("logo_url, phone, email, address, city, state, zip, website, shop_name")
    .eq("email", ownerEmail)
    .maybeSingle();
  if (!prof) return shop;
  return {
    ...shop,
    shop_name: shop.shop_name || prof.shop_name || "",
    logo_url: prof.logo_url ?? null,
    phone: prof.phone ?? null,
    email: prof.email ?? null,
    address: prof.address ?? null,
    city: prof.city ?? null,
    state: prof.state ?? null,
    zip: prof.zip ?? null,
    website: prof.website ?? null,
  };
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

  // Public-safe allowlist — this object is returned to the unauthenticated
  // quote-payment page. Adding new sensitive columns to the shops table
  // won't leak unless they're added here intentionally.
  const { data: shops } = await supabase
    .from("shops")
    .select("owner_email, shop_name, stripe_account_id, stripe_account_status")
    .eq("owner_email", quote.shop_owner)
    .limit(1);

  const shop = await withOwnerProfile(supabase, shops?.[0] ?? null, quote.shop_owner);

  let customer = null;
  if (quote.customer_id) {
    const { data: c } = await supabase
      .from("customers")
      .select("*")
      .eq("id", quote.customer_id)
      .single();
    customer = c ?? null;
  }

  return { quote: publicSafeQuote(quote), shop, customer: publicSafeCustomer(customer) };
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

  // Need broker_id + broker_email so we can route the approval to the
  // right next state. Re-select with the fields we'll branch on; the
  // first select was just for the token verification.
  const { data: pre } = await supabase
    .from("quotes")
    .select("broker_id, broker_email, status, client_status")
    .eq("id", quoteId)
    .single();

  // Only the FIRST approve transition should send an email. Re-clicking the
  // emailed link (or a script looping the action) must NOT re-fire notifications
  // — otherwise it's an email-bomb vector from the verified domain.
  const alreadyApproved = pre?.status === "Approved" || pre?.status === "Client Approved" || pre?.client_status === "Approved";

  // Broker quotes follow client-first workflow: the customer clicking
  // Approve is the broker's END CLIENT, NOT the shop. Setting status
  // to "Approved" here would skip the broker's "Submit to Shop" step
  // entirely and the broker portal would render the quote as
  // "Shop Approved" (per BrokerDashboard.jsx — Approved + Shop Approved
  // are treated the same). Mirror the broker portal's
  // handleMarkClientApproved so the state is exactly what the broker
  // would set if they marked it manually: status "Client Approved",
  // client_status "Approved", client_approved_at = now. The broker
  // still has to hit Submit to Shop to move it into the shop's queue.
  const isBrokerQuote = Boolean(pre?.broker_id || pre?.broker_email);
  const updatePayload: any = isBrokerQuote
    ? {
        status: "Client Approved",
        client_status: "Approved",
        client_approved_at: new Date().toISOString(),
      }
    : { status: "Approved" };

  const { data: quote, error } = await supabase
    .from("quotes")
    .update(updatePayload)
    .eq("id", quoteId)
    .select("*")
    .single();

  if (error || !quote) return { error: "Failed to approve quote." };

  // Public-safe allowlist — this object is returned to the unauthenticated
  // quote-payment page. Adding new sensitive columns to the shops table
  // won't leak unless they're added here intentionally.
  const { data: shops } = await supabase
    .from("shops")
    .select("owner_email, shop_name, stripe_account_id, stripe_account_status")
    .eq("owner_email", quote.shop_owner)
    .limit(1);

  const shop = await withOwnerProfile(supabase, shops?.[0] ?? null, quote.shop_owner);

  let customer = null;
  if (quote.customer_id) {
    const { data: c } = await supabase
      .from("customers")
      .select("*")
      .eq("id", quote.customer_id)
      .single();
    customer = c ?? null;
  }

  // ── Approval notification ──────────────────────────────────────
  // Best-effort: a Resend failure here MUST NOT roll back the
  // approval write the caller already committed. We swallow errors
  // inside sendApprovalNotification — this block always returns
  // the original {quote, shop, customer} payload.
  //
  // Routing: broker quotes notify the broker (they need to "Submit
  // to Shop" next); direct shop quotes notify the shop owner.
  // chooseQuoteApprovalRecipient encodes that decision and is
  // unit-tested separately.
  try {
    if (alreadyApproved) {
      // Re-approval (link re-clicked / replayed) — already notified; skip.
    } else {
    // In-app bell notification for the shop owner — DIRECT shop quotes only.
    // Broker quotes go to "Client Approved" and route to the broker's own feed
    // (the shop isn't involved until the broker hits "Submit to Shop"), so no
    // shop-owner bell here. Best-effort; never blocks the approval response.
    if (!isBrokerQuote) {
      await insertShopNotification(supabase, {
        shopOwner: quote.shop_owner,
        eventType: "quote_approved",
        severity: "info",
        title: "Quote approved",
        body: `${quote.customer_name || "A customer"} approved quote ${quote.quote_id || ""}.`.replace(/\s+/g, " ").trim(),
        relatedEntity: "quote",
        relatedId: quote.id,
        metadata: { quote_id: quote.quote_id },
      } as any);
    }
    // Rate-limit backstop: at most 5 approval emails/hour per quote.
    const { data: underLimit } = await supabase.rpc("check_request_rate", {
      p_key: `approve_quote:${quoteId}`, p_limit_per_hr: 5,
    });
    if (underLimit !== false) {
    const recipient = chooseQuoteApprovalRecipient(quote);
    const email = recipient ? buildQuoteApprovalEmail({ quote, shop, customer, recipient }) : null;
    // sendAndLog handles the "no recipient" case by logging a
    // 'skipped' row — so even if we never had a target email, the
    // attempt is queryable from the notification_log audit.
    await sendAndLogApprovalNotification(supabase, {
      shop_owner: quote.shop_owner,
      event_type: "quote_approval",
      quote_id:   quote.id,
      recipient_email: recipient?.to ?? "",
      recipient_role:  recipient?.role,
      to:       recipient?.to,
      subject:  email?.subject,
      html:     email?.html,
      reply_to: email?.reply_to,
    });
    } // end rate-limit gate
    } // end !alreadyApproved gate
  } catch (notifyErr) {
    console.error("[approveQuote] notification build/send failed:", notifyErr);
  }

  return { quote: publicSafeQuote(quote), shop, customer: publicSafeCustomer(customer) };
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
    .select("shop_name")
    .eq("owner_email", order.shop_owner)
    .limit(1);

  const shop = await withOwnerProfile(supabase, shops?.[0] ?? null, order.shop_owner);
  return { order, shop };
}

// ── approveArtwork ────────────────────────────────────────────────────────────

async function handleApproveArtwork(orderId: string, approvedBy: string, token?: string) {
  const supabase = serviceClient();

  // Token gate before write.
  const { data: existing } = await supabase
    .from("orders")
    .select("public_token, art_approved")
    .eq("id", orderId)
    .single();

  if (!existing?.public_token || !token || !safeEquals(token, existing.public_token)) {
    return { error: "Order not found." };
  }
  // Only the first approval transition notifies — replays must not re-email.
  const alreadyApproved = existing.art_approved === true;

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

  // Best-effort notification. Mirrors the quote-approval pattern;
  // see the comment on handleApproveQuote for rationale.
  try {
    if (alreadyApproved) {
      // already notified on first approval — skip
    } else {
    const { data: underLimit } = await supabase.rpc("check_request_rate", {
      p_key: `approve_artwork:${orderId}`, p_limit_per_hr: 5,
    });
    if (underLimit !== false) {
    const recipient = chooseArtworkApprovalRecipient(order);
    let email: any = null;
    if (recipient) {
      // Look up the shop for the email header brand name. Missing
      // shop row is non-fatal — the builder falls back to "InkTracker".
      const { data: shopRow } = await supabase
        .from("shops")
        .select("shop_name")
        .eq("owner_email", order.shop_owner)
        .maybeSingle();
      email = buildArtworkApprovalEmail({ order, shop: shopRow, recipient });
    }
    await sendAndLogApprovalNotification(supabase, {
      shop_owner: order.shop_owner,
      event_type: "artwork_approval",
      order_id:   order.id,
      recipient_email: recipient?.to ?? "",
      recipient_role:  recipient?.role,
      to:       recipient?.to,
      subject:  email?.subject,
      html:     email?.html,
      reply_to: email?.reply_to,
    });
    } // end rate-limit gate
    } // end !alreadyApproved gate
  } catch (notifyErr) {
    console.error("[approveArtwork] notification build/send failed:", notifyErr);
  }

  return { order };
}

// ── createSession ─────────────────────────────────────────────────────────────

async function handleCreateSession(params: any) {
  if (!STRIPE_SECRET_KEY) return { error: "Stripe not configured." };

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" as any });
  const supabase = serviceClient();

  // Verify token before generating a checkout URL. Otherwise anyone could
  // create Stripe checkout sessions for any quote ID.
  const { data: existing } = await supabase
    .from("quotes")
    .select("public_token, shop_owner, quote_id, total, client_total, deposit_pct, customer_id")
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

  // Compute the charge amount SERVER-SIDE from the saved quote. Never trust the
  // client's lineItems/unit_amount/amountPaid — otherwise a token-holder could
  // pay $1 for a $600 quote. The customer-facing total is client_total for
  // broker quotes (falls back to total). Deposit % comes from the customer
  // record (preferred) or the quote, mirroring the QuotePayment page math.
  const fullCents = Math.round(Number(existing.client_total ?? existing.total ?? 0) * 100);
  let depositPct = Number(existing.deposit_pct) || 0;
  if (params.isDeposit && existing.customer_id) {
    const { data: cust } = await supabase
      .from("customers").select("default_deposit_pct").eq("id", existing.customer_id).maybeSingle();
    if (cust?.default_deposit_pct != null) depositPct = Number(cust.default_deposit_pct) || 0;
  }
  const chargeCents = params.isDeposit ? Math.round(fullCents * (depositPct / 100)) : fullCents;
  if (!Number.isFinite(chargeCents) || chargeCents <= 0) {
    return { error: "Nothing to charge on this quote." };
  }
  const chargeLabel = `Quote ${existing.quote_id || params.quoteId}${params.isDeposit ? ` — ${depositPct}% deposit` : ""}`;
  const amountDollars = (chargeCents / 100).toFixed(2);

  const origin = params.origin ?? "https://www.inktracker.app";
  const successUrl = `${origin}/quotepaymentSuccess?session_id={CHECKOUT_SESSION_ID}&quote_id=${params.quoteId}&is_deposit=${params.isDeposit ? "1" : "0"}&amount=${amountDollars}&shop_owner=${encodeURIComponent(params.shopOwnerEmail || "")}`;
  // Carry quote_id + token so the cancel page can offer "Return to Quote".
  // Without the token, /quotepayment refuses to load (security gate), so a
  // customer who hits cancel would otherwise land on a dead end.
  const cancelUrl  = `${origin}/quotepaymentCancel?quote_id=${params.quoteId}&token=${encodeURIComponent(params.token)}`;

  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      customer_email: params.customerEmail || undefined,
      // Single server-computed line. We deliberately ignore params.lineItems —
      // the amount is derived from the saved quote above so the client can't
      // tamper with what they're charged.
      line_items: [{
        price_data: {
          currency: "usd",
          unit_amount: chargeCents,
          product_data: { name: chargeLabel },
        },
        quantity: 1,
      }],
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
    return Response.json({ error: String((err as any)?.message ?? err) }, { status: 500, headers: CORS });
  }
});
