// Stripe webhook handler — verifies payment server-side.
// Public — no JWT required.
// Required secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
//
// Setup:
//   1. Set STRIPE_WEBHOOK_SECRET in Supabase project secrets.
//   2. In Stripe Dashboard → Developers → Webhooks → Add endpoint:
//      URL: https://<your-project-ref>.supabase.co/functions/v1/stripeWebhook
//      Events: checkout.session.completed, checkout.session.expired

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";
import { loadProfileWithSecrets, updateProfileSecrets } from "../_shared/profileSecrets.ts";
import { claimWebhookEvent, extractStripeEventId } from "../_shared/webhookIdempotency.js";
import { insertShopNotification } from "../_shared/notifications.js";
import {
  renderEmailLayout,
  renderEmailHighlight,
  EMAIL_INK,
  EMAIL_MUTED,
  EMAIL_HAIRLINE,
  EMAIL_FOREST,
} from "../_shared/emailLayout.ts";
import { escapeQbStringLiteral } from "../_shared/qbInvoice.js";

// HTML-escape user-controlled fields (customer_name comes from the public
// wizard) before interpolating into email HTML, so a crafted name can't inject
// markup/scripts/links into the shop owner's or customer's inbox.
const escapeHtml = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[ch] || ch));

const STRIPE_SECRET_KEY      = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET  = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL           = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY         = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL             = Deno.env.get("FROM_EMAIL") ?? "quotes@inktracker.app";
const FROM_NAME              = Deno.env.get("FROM_NAME")  ?? "InkTracker";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

function serviceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

function fmtMoney(n: number) {
  return `$${Number(n || 0).toFixed(2)}`;
}

// ── QB helpers: refresh the shop owner's token and record a Payment ────────

const QB_CLIENT_ID     = Deno.env.get("QB_CLIENT_ID") ?? "";
const QB_CLIENT_SECRET = Deno.env.get("QB_CLIENT_SECRET") ?? "";
const QB_BASE          = "https://quickbooks.api.intuit.com/v3/company";

async function refreshQbToken(refreshTok: string) {
  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${btoa(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshTok }),
  });
  if (!res.ok) {
    console.error(`[stripeWebhook] QB token refresh failed: ${res.status}`);
    throw new Error("QuickBooks connection expired. Please reconnect in Account settings.");
  }
  return res.json();
}

async function getShopQbTokens(supabase: any, shopOwnerEmail: string) {
  const profile = await loadProfileWithSecrets(supabase, { email: shopOwnerEmail });
  if (!profile?.qb_access_token || !profile?.qb_realm_id) return null;

  const expiresAt = profile.qb_token_expires_at ? new Date(profile.qb_token_expires_at).getTime() : 0;
  const needsRefresh = Date.now() > expiresAt - 5 * 60 * 1000;
  if (!needsRefresh) {
    return { accessToken: profile.qb_access_token, realmId: profile.qb_realm_id };
  }

  const fresh = await refreshQbToken(profile.qb_refresh_token as string);
  await updateProfileSecrets(supabase, profile.id, {
    qb_access_token:     fresh.access_token,
    qb_refresh_token:    fresh.refresh_token ?? profile.qb_refresh_token,
    qb_token_expires_at: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
  });

  return { accessToken: fresh.access_token, realmId: profile.qb_realm_id };
}

async function recordQbPayment(
  accessToken: string,
  realmId: string,
  qbInvoiceId: string,
  amount: number,
  memo: string,
) {
  // Look up the invoice's CustomerRef — QB Payment requires it
  const q = await fetch(
    `${QB_BASE}/${realmId}/query?query=${encodeURIComponent(
      `SELECT Id, CustomerRef FROM Invoice WHERE Id = '${escapeQbStringLiteral(qbInvoiceId)}'`
    )}&minorversion=65`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
  );
  if (!q.ok) throw new Error(`[qb] invoice lookup failed: ${q.status}`);
  const qj = await q.json();
  const invoice = qj?.QueryResponse?.Invoice?.[0];
  if (!invoice) throw new Error(`[qb] invoice ${qbInvoiceId} not found`);

  const res = await fetch(`${QB_BASE}/${realmId}/payment?minorversion=65`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      CustomerRef: { value: invoice.CustomerRef.value },
      TotalAmt: amount,
      PrivateNote: memo,
      Line: [{
        Amount: amount,
        LinkedTxn: [{ TxnId: qbInvoiceId, TxnType: "Invoice" }],
      }],
    }),
  });
  if (!res.ok) {
    throw new Error(`[qb] payment create failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Look up a shop's logo by their owner email. The webhook has no
// authenticated client, so we use the service-role client we already
// hold. Returns null when the shop has no logo or the lookup errors —
// callers fall through to the InkTracker drop logo.
async function lookupShopLogoUrl(supabase: any, shopOwnerEmail: string): Promise<string | null> {
  if (!shopOwnerEmail) return null;
  try {
    const { data } = await supabase
      .from("profiles")
      .select("logo_url")
      .eq("email", shopOwnerEmail)
      .maybeSingle();
    return data?.logo_url || null;
  } catch {
    return null;
  }
}

async function sendOwnerNotification(quote: any, amountPaid: number, isDeposit: boolean) {
  if (!RESEND_API_KEY || !quote?.shop_owner) return;

  const subject = `Payment Received — Quote #${quote.quote_id}`;
  const paymentType = isDeposit ? "Deposit" : "Full Payment";
  const shopLogoUrl = await lookupShopLogoUrl(serviceClient(), quote.shop_owner);

  const rowStyle = `padding:10px 0;border-bottom:1px solid ${EMAIL_HAIRLINE};font-size:14px;`;
  const labelStyle = `color:${EMAIL_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:0.08em;`;
  const valueStyle = `color:${EMAIL_INK};font-weight:600;text-align:right;`;
  const tableHtml = `
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
      <tr><td style="${rowStyle}${labelStyle}">Quote #</td><td style="${rowStyle}${valueStyle}">${escapeHtml(quote.quote_id)}</td></tr>
      <tr><td style="${rowStyle}${labelStyle}">Customer</td><td style="${rowStyle}${valueStyle}">${escapeHtml(quote.customer_name)}</td></tr>
      <tr><td style="${rowStyle}${labelStyle}">Type</td><td style="${rowStyle}${valueStyle}">${escapeHtml(paymentType)}</td></tr>
      ${quote.due_date ? `<tr><td style="${rowStyle}${labelStyle}">In-Hands Date</td><td style="${rowStyle}${valueStyle}">${escapeHtml(quote.due_date)}</td></tr>` : ""}
    </table>
  `;
  const bodyHtml = `
    <p style="color:${EMAIL_INK};font-size:15px;line-height:1.65;margin:0 0 20px;">
      <strong>${escapeHtml(quote.customer_name)}</strong> has completed their payment.
    </p>
    ${renderEmailHighlight("Amount Received", fmtMoney(amountPaid))}
    ${tableHtml}
    ${isDeposit ? `<p style="color:${EMAIL_INK};font-size:13px;background:#fffbeb;border:1px solid #fde68a;padding:12px;margin:0;"><strong>Note:</strong> This was a deposit. The remaining balance is due upon completion.</p>` : ""}
  `;
  const html = renderEmailLayout({
    shopName: "Payment Confirmed",
    subhead: "Stripe-verified",
    contentHtml: bodyHtml,
    logoUrl: shopLogoUrl ?? undefined,
  });

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `${FROM_NAME} <${FROM_EMAIL}>`, to: [quote.shop_owner], subject, html }),
  });
}

async function sendCustomerConfirmation(quote: any, amountPaid: number, isDeposit: boolean, shopName: string) {
  const customerEmail = quote.customer_email || quote.sent_to;
  if (!RESEND_API_KEY || !customerEmail) return;

  const subject = isDeposit
    ? `Deposit Received — ${shopName} Order #${quote.quote_id}`
    : `Payment Confirmed — ${shopName} Order #${quote.quote_id}`;

  const shopLogoUrl = await lookupShopLogoUrl(serviceClient(), quote.shop_owner);

  const rowStyle = `padding:10px 0;border-bottom:1px solid ${EMAIL_HAIRLINE};font-size:14px;`;
  const labelStyle = `color:${EMAIL_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:0.08em;`;
  const valueStyle = `color:${EMAIL_INK};font-weight:600;text-align:right;`;
  const tableHtml = `
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
      <tr><td style="${rowStyle}${labelStyle}">Order #</td><td style="${rowStyle}${valueStyle}">${quote.quote_id}</td></tr>
      ${quote.due_date ? `<tr><td style="${rowStyle}${labelStyle}">In-Hands Date</td><td style="${rowStyle}${valueStyle}">${quote.due_date}</td></tr>` : ""}
    </table>
  `;
  const noteHtml = isDeposit
    ? `<p style="color:${EMAIL_INK};font-size:13px;background:#fffbeb;border:1px solid #fde68a;padding:12px;margin:0 0 16px;"><strong>Deposit received.</strong> The remaining balance will be due upon completion.</p>`
    : `<p style="color:#065f46;font-size:13px;background:#f0fdf4;border:1px solid #bbf7d0;padding:12px;margin:0 0 16px;"><strong>Payment complete.</strong> We'll be in touch once your order is ready.</p>`;
  const bodyHtml = `
    <p style="color:${EMAIL_INK};font-size:15px;line-height:1.65;margin:0 0 20px;">
      Hi ${escapeHtml(quote.customer_name || "there")}, thank you for your payment to <strong>${escapeHtml(shopName)}</strong>.
    </p>
    ${renderEmailHighlight("Amount Paid", fmtMoney(amountPaid))}
    ${tableHtml}
    ${noteHtml}
    <p style="color:${EMAIL_MUTED};font-size:13px;margin:16px 0 0;">
      Questions? Reply to this email or contact ${shopName} directly.
    </p>
  `;
  const html = renderEmailLayout({
    shopName,
    subhead: isDeposit ? "Deposit Received" : "Payment Confirmed",
    contentHtml: bodyHtml,
    footerHtml: `Sent on behalf of ${shopName}.`,
    logoUrl: shopLogoUrl ?? undefined,
  });

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `${shopName} <${FROM_EMAIL}>`, to: [customerEmail], subject, html }),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const signature = req.headers.get("stripe-signature") ?? "";
  const rawBody   = await req.text();

  if (!STRIPE_SECRET_KEY) {
    return Response.json({ error: "Stripe not configured" }, { status: 500, headers: CORS });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" as any });

  // Fail closed — never process an event without a verified Stripe signature.
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error("[stripeWebhook] STRIPE_WEBHOOK_SECRET not configured — refusing to process");
    return Response.json({ error: "Webhook misconfigured" }, { status: 500, headers: CORS });
  }
  if (!signature) {
    return Response.json({ error: "Missing stripe-signature header" }, { status: 401, headers: CORS });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripeWebhook] Signature verification failed:", err);
    return Response.json({ error: "Invalid signature" }, { status: 400, headers: CORS });
  }

  const supabase = serviceClient();

  // Idempotency: Stripe explicitly delivers webhooks at-least-once.
  // Without a dedup gate, every retry replays QB payment record +
  // customer + shop emails. Pure-logic + tests in
  // _shared/webhookIdempotency.js (CW1–CW6).
  const dedupId = extractStripeEventId(event);
  const isFirstDelivery = await claimWebhookEvent(supabase, "stripe", dedupId as string, event);
  if (!isFirstDelivery) {
    console.log(`[stripeWebhook] Duplicate event ${dedupId} — skipping (already processed)`);
    return Response.json({ received: true, deduplicated: true }, { headers: CORS });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const quoteId   = session.metadata?.quote_id;
      const isDeposit = session.metadata?.is_deposit === "1";
      const amountPaid = (session.amount_total ?? 0) / 100;

      if (!quoteId) {
        console.warn("[stripeWebhook] No quote_id in session metadata");
        return Response.json({ received: true }, { headers: CORS });
      }

      // Load the quote
      const { data: quote } = await supabase.from("quotes").select("*").eq("id", quoteId).single();
      if (!quote) {
        console.warn("[stripeWebhook] Quote not found:", quoteId);
        return Response.json({ received: true }, { headers: CORS });
      }

      // Defense-in-depth: verify the connected account that received the
      // payment is actually the quote's shop. The webhook trusts
      // session.metadata.quote_id, which is attacker-controllable on
      // Connect since any shop can mint a checkout session with arbitrary
      // metadata. Without this check, shop A could craft a session
      // referencing shop B's quote_id and flip shop B's quote to
      // "Approved and Paid" — Stripe Connect destinations would route the
      // money to shop A, but the InkTracker quote on the OTHER shop's
      // dashboard would silently get marked paid.
      const stripeAccountId = (event as Stripe.Event & { account?: string }).account;
      if (stripeAccountId && quote.shop_owner) {
        const { data: shopRow } = await supabase
          .from("shops")
          .select("stripe_account_id")
          .eq("owner_email", quote.shop_owner)
          .maybeSingle();
        if (!shopRow?.stripe_account_id || shopRow.stripe_account_id !== stripeAccountId) {
          console.error(
            `[stripeWebhook] REJECTED: session for quote ${quote.quote_id} came from account ${stripeAccountId} but the quote's shop ${quote.shop_owner} owns ${shopRow?.stripe_account_id ?? "<none>"}`,
          );
          return Response.json({ received: true, ignored: "account_mismatch" }, { headers: CORS });
        }
      }

      // Update quote status (authoritative server-side confirmation)
      // Don't overwrite if already converted to an order
      if (quote.status === "Converted to Order" || quote.converted_order_id) {
        console.log(`[stripeWebhook] Quote ${quote.quote_id} already converted to order — skipping status update`);
        await supabase
          .from("quotes")
          .update({ deposit_paid: true })
          .eq("id", quoteId);
      } else {
        const newStatus = isDeposit ? "Approved" : "Approved and Paid";
        await supabase
          .from("quotes")
          .update({ status: newStatus, deposit_paid: true })
          .eq("id", quoteId);
      }

      // Look up shop name for customer email
      const { data: shops } = await supabase
        .from("shops")
        .select("shop_name")
        .eq("owner_email", quote.shop_owner)
        .limit(1);
      const shopName = shops?.[0]?.shop_name || FROM_NAME;

      // Mirror the payment into QB if this quote is linked to a QB invoice
      if (quote.qb_invoice_id && quote.shop_owner) {
        try {
          const tokens = await getShopQbTokens(supabase, quote.shop_owner);
          if (tokens) {
            await recordQbPayment(
              tokens.accessToken,
              tokens.realmId,
              String(quote.qb_invoice_id),
              amountPaid,
              `Stripe ${isDeposit ? "deposit" : "payment"} for quote ${quote.quote_id} (session ${session.id})`,
            );
            console.log(`[stripeWebhook] Mirrored $${amountPaid} to QB invoice ${quote.qb_invoice_id}`);
          }
        } catch (qbErr) {
          // Don't fail the webhook over QB — the shop can reconcile manually if needed
          console.error("[stripeWebhook] QB payment mirror failed:", qbErr);
        }
      }

      // Notify shop owner and customer via email
      await Promise.all([
        sendOwnerNotification(quote, amountPaid, isDeposit),
        sendCustomerConfirmation(quote, amountPaid, isDeposit, shopName),
      ]);

      // In-app bell notification (distinct from the emails above). Links to the
      // quote, which the Quotes page accepts for ?id= deep-links.
      //
      // NOTE: dormant in v1. This is the CUSTOMER-payment Stripe webhook
      // (STRIPE_WEBHOOK_SECRET), not the subscription/billing one
      // (STRIPE_BILLING_WEBHOOK_SECRET). Stripe Connect for customer payments
      // was removed from the UI in PR #201 — QuickBooks is the sole customer-
      // payment path — so this handler doesn't process payments today and this
      // notification won't fire. It's kept ready for if Stripe customer pay
      // ever returns. The live "paid" signal in v1 is the convertQuoteToOrder
      // notification (QB payment → conversion). Not a pending to-do.
      await insertShopNotification(supabase, {
        shopOwner: quote.shop_owner,
        eventType: "quote_paid",
        severity: "info",
        title: isDeposit ? "Deposit received" : "Payment received",
        body: `${quote.customer_name || "A customer"} paid ${fmtMoney(amountPaid)} on quote ${quote.quote_id}.`,
        relatedEntity: "quote",
        relatedId: quote.id,
        metadata: { quote_id: quote.quote_id, amount: amountPaid, deposit: isDeposit },
      } as any);

      console.log(`[stripeWebhook] Processed payment for quote ${quote.quote_id}, amount: $${amountPaid}, deposit: ${isDeposit}`);
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      const quoteId = session.metadata?.quote_id;
      if (quoteId) {
        // Revert back to Approved if the session expired without payment
        await supabase
          .from("quotes")
          .update({ status: "Approved", deposit_paid: false })
          .eq("id", quoteId)
          .eq("status", "Approved and Paid"); // only revert if we prematurely marked it
      }
    }

    // ── Stripe Connect: account.updated ─────────────────────────────
    // Fired when a connected account's verification state changes — e.g.
    // shop finished onboarding (details_submitted=true, charges_enabled=true)
    // or Stripe revoked their ability to accept payments. We mirror the
    // coarse state to shops.stripe_account_status so the UI and the
    // SendQuoteModal "Stripe radio" gating stay in sync without polling.
    //
    // The event.account field identifies the connected account; we look
    // up the shop by stripe_account_id.
    if (event.type === "account.updated") {
      const account = event.data.object as Stripe.Account;
      const status = account.charges_enabled
        ? "active"
        : account.details_submitted
          ? "restricted"
          : "pending";

      const { error: updErr } = await supabase
        .from("shops")
        .update({ stripe_account_status: status })
        .eq("stripe_account_id", account.id);

      if (updErr) {
        console.error("[stripeWebhook] account.updated mirror failed:", updErr.message);
      } else {
        console.log(`[stripeWebhook] Stripe Connect account ${account.id} → ${status}`);
      }
    }

    return Response.json({ received: true }, { headers: CORS });
  } catch (err) {
    console.error("[stripeWebhook] Error processing event:", err);
    return Response.json({ error: String((err as any)?.message ?? err) }, { status: 500, headers: CORS });
  }
});
