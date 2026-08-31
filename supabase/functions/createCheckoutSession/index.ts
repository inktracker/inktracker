// Handles quote loading, approval, Stripe checkout session creation, and shop owner notifications.
// Public — no JWT required (customer-facing quote payment page).

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { captureError } from "../_shared/observability.ts";
import Stripe from "npm:stripe@14.25.0";
import {
  chooseQuoteApprovalRecipient,
  chooseArtworkApprovalRecipient,
  buildQuoteApprovalEmail,
  buildArtworkApprovalEmail,
  sendAndLogApprovalNotification,
} from "../_shared/approvalNotificationEmail.js";
import { toCustomerFacingQuote } from "../_shared/customerFacingQuote.js";
import { insertShopNotification } from "../_shared/notifications.js";
import { resolveApproveQuoteUpdate, APPROVE_GUARD_OR } from "../_shared/approveQuoteEffect.js";
import { sanitizeQuoteForCustomer, sanitizeOrderForCustomer, customerFacingShopPayload, isBrokerDoc } from "../_shared/publicSafe.js";
import { toPublicMessage } from "../_shared/publicErrors.ts";

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

// Broker logo/phone for white-label brand payloads (broker docs only).
async function loadBrokerProfile(supabase: any, doc: any) {
  if (!isBrokerDoc(doc)) return null;
  const email = doc.broker_id || doc.broker_email;
  if (!email) return null;
  const { data } = await supabase
    .from("profiles")
    .select("logo_url, phone")
    .eq("email", email)
    .maybeSingle();
  return data ?? null;
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
    // Scope to the quote's own shop: a quote carrying another tenant's
    // customer_id (e.g. one attached before createQuoteFromPayload validated
    // ownership) must not surface that customer's name/company/email here.
    const { data: c } = await supabase
      .from("customers")
      .select("*")
      .eq("id", quote.customer_id)
      .eq("shop_owner", quote.shop_owner)
      .maybeSingle();
    customer = c ?? null;
  }

  const brokerProf = await loadBrokerProfile(supabase, quote);
  return {
    quote: sanitizeQuoteForCustomer(publicSafeQuote(quote)),
    shop: customerFacingShopPayload({ shop, doc: quote, brokerProfile: brokerProf }),
    customer: publicSafeCustomer(customer),
  };
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
    .select("broker_id, broker_email, status, client_status, converted_order_id")
    .eq("id", quoteId)
    .single();

  // One-way, idempotent transition. resolveApproveQuoteUpdate returns
  // update=null when the quote is already at/past approval ("Approved",
  // "Client Approved", or the sacred "Converted to Order" / "Approved and
  // Paid" / "Paid") — replaying the emailed link must neither rewrite a
  // later lifecycle state (it used to yank converted quotes back to
  // "Approved") nor re-fire notifications (email-bomb vector from the
  // verified domain).
  //
  // Broker quotes route to "Client Approved", not "Approved": the clicker
  // is the broker's END CLIENT, and the broker still has to "Submit to
  // Shop" (mirrors BrokerDashboard.handleMarkClientApproved exactly).
  const { update: approvePatch, isBroker: isBrokerQuote } =
    resolveApproveQuoteUpdate(pre ?? {}, { nowISO: new Date().toISOString() });

  let quote: any = null;
  // True only when THIS request performed the approve transition — the sole
  // condition under which notifications fire.
  let transitioned = false;

  if (approvePatch) {
    // APPROVE_GUARD_OR makes the write itself refuse rows that reached a
    // locked status after our pre-read — without it, a conversion landing
    // in that window would still get clobbered.
    const { data: updatedRows, error } = await supabase
      .from("quotes")
      .update(approvePatch)
      .eq("id", quoteId)
      .or(APPROVE_GUARD_OR)
      .select("*");
    if (error) return { error: "Failed to approve quote." };
    quote = updatedRows?.[0] ?? null;
    transitioned = Boolean(quote);
  }

  if (!quote) {
    // Already approved/converted/paid (or we lost the guard race) —
    // idempotent success: return the current state, write nothing.
    const { data: current } = await supabase
      .from("quotes")
      .select("*")
      .eq("id", quoteId)
      .single();
    quote = current;
  }

  if (!quote) return { error: "Failed to approve quote." };

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
    // Shop-scoped: see the getQuote read above — same cross-tenant guard.
    const { data: c } = await supabase
      .from("customers")
      .select("*")
      .eq("id", quote.customer_id)
      .eq("shop_owner", quote.shop_owner)
      .maybeSingle();
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
    if (!transitioned) {
      // No transition happened (replayed link / already past approval) —
      // already notified on the first approval; skip.
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
    } // end transitioned gate
  } catch (notifyErr) {
    console.error("[approveQuote] notification build/send failed:", notifyErr);
  }

  const brokerProf = await loadBrokerProfile(supabase, quote);
  return {
    quote: sanitizeQuoteForCustomer(publicSafeQuote(quote)),
    shop: customerFacingShopPayload({ shop, doc: quote, brokerProfile: brokerProf }),
    customer: publicSafeCustomer(customer),
  };
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
  const brokerProfOrd = await loadBrokerProfile(supabase, order);
  return {
    order: sanitizeOrderForCustomer(order),
    shop: customerFacingShopPayload({ shop, doc: order, brokerProfile: brokerProfOrd }),
  };
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
  // Only the first approval transition writes + notifies. A replayed link
  // must not restamp art_approved_at / art_approved_by — that erases the
  // record of who actually approved and when (same replay-clobber class as
  // approveQuote above).
  const alreadyApproved = existing.art_approved === true;

  let order: any = null;
  // True only when THIS request flipped art_approved — the sole condition
  // under which the notification fires (race losers must not re-email).
  let transitioned = false;
  if (alreadyApproved) {
    const { data: current } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();
    order = current;
  } else {
    // Guarded write: only transitions rows still unapproved, so two
    // near-simultaneous clicks can't both stamp (the loser falls through
    // to the re-read below).
    const { data: updatedRows, error } = await supabase
      .from("orders")
      .update({
        art_approved: true,
        art_approved_at: new Date().toISOString(),
        art_approved_by: approvedBy || "Customer",
      })
      .eq("id", orderId)
      .not("art_approved", "is", true)
      .select("*");
    if (error) return { error: "Failed to approve artwork." };
    order = updatedRows?.[0] ?? null;
    transitioned = Boolean(order);
    if (!order) {
      const { data: current } = await supabase
        .from("orders")
        .select("*")
        .eq("id", orderId)
        .single();
      order = current;
    }
  }

  if (!order) return { error: "Failed to approve artwork." };

  // Best-effort notification. Mirrors the quote-approval pattern;
  // see the comment on handleApproveQuote for rationale.
  try {
    if (!transitioned) {
      // already notified on the first approval (replay or race loser) — skip
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
    } // end transitioned gate
  } catch (notifyErr) {
    console.error("[approveArtwork] notification build/send failed:", notifyErr);
  }

  // Anonymous caller — must return the SAME 15-field allowlist the sibling
  // handleGetOrder uses (line ~350). Returning the raw row leaked shop_owner,
  // public_token, totals, notes, and cost/partner line-item fields
  // (garmentCost*, partner_source = subcontractor email, _partner_ppp) to
  // whoever holds the approval link — the exact fields publicSafe strips.
  // The internal `order` above stays raw on purpose (notifications need
  // shop_owner). Sanitize only at the boundary.
  return { order: sanitizeOrderForCustomer(order) };
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
  //
  // client_total is NOT NULL DEFAULT 0 (20260607 migration), so `??` never
  // falls back: on every NON-broker quote `0 ?? total` computed 0 cents and
  // this handler returned "Nothing to charge" — Stripe checkout was dead for
  // standard quotes from 2026-06-22 until this fix (masked in practice by
  // shops using QuickBooks pay links). Use client_total only when it's a
  // real stamped value (> 0); a stamped client total is always > 0.
  const clientTotalNum = Number(existing.client_total);
  const chargeBase = clientTotalNum > 0 ? clientTotalNum : Number(existing.total ?? 0);
  const fullCents = Math.round(chargeBase * 100);
  let depositPct = Number(existing.deposit_pct) || 0;
  if (params.isDeposit && existing.customer_id) {
    // Shop-scoped: this sets the deposit percentage actually charged, so a
    // foreign customer_id must not steer it.
    const { data: cust } = await supabase
      .from("customers").select("default_deposit_pct")
      .eq("id", existing.customer_id).eq("shop_owner", existing.shop_owner).maybeSingle();
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
    // Malformed input is a CLIENT error, not a server bug. This endpoint is
    // public and unauthenticated, so scanners send junk at it constantly; if
    // each one fell through to the top-level catch it would file a Sentry
    // issue and email the operator about a "SyntaxError" that needs no
    // action. Alerting that cries wolf gets muted, and then the real outage
    // is the one that gets missed. Reject cleanly, don't alert.
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid request." }, { status: 400, headers: CORS });
    }
    // A non-object body (null, a number, a bare string, an array) is still
    // valid JSON but destructuring it throws — which would fall through to the
    // alerting catch and page us for what is plainly client junk. Reject with
    // the same silent 400 as unparseable input.
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "Invalid request." }, { status: 400, headers: CORS });
    }
    const { action, quoteId, token, ...rest } = body as Record<string, any>;

    // RL-04: rate-limit the customer-facing read + session actions by client IP
    // (server-derived — never a client-supplied key). These take a quoteId/
    // orderId + token from an emailed link; an IP cap is defense-in-depth
    // against token brute-force / record enumeration and Stripe-session spam.
    // The mutation/notify actions (approveQuote, approveArtwork) already have
    // their own per-record backstops, so they're not gated here.
    const RL_LIMITS: Record<string, number> = { getQuote: 120, getOrder: 120, createSession: 30 };
    if (RL_LIMITS[action]) {
      const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
      const { data: underLimit } = await serviceClient().rpc("check_request_rate", {
        p_key: `ccs:${action}:${ip}`, p_limit_per_hr: RL_LIMITS[action],
      });
      if (underLimit === false) {
        return Response.json(
          { error: "Too many requests — please slow down and try again shortly." },
          { status: 429, headers: CORS },
        );
      }
    }

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
    await captureError(err, { fn: "createCheckoutSession" });
    // The real text goes to the logs; the CUSTOMER gets copy we wrote. This
    // endpoint backs the anonymous quote-payment page, so an unexpected throw
    // (Stripe SDK, Postgres, JSON parse) used to render verbatim in her
    // browser. toPublicMessage never passes through unapproved text.
    console.error("[createCheckoutSession] error:", err);
    return Response.json({ error: toPublicMessage(err) }, { status: 500, headers: CORS });
  }
});
