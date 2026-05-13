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

  const fresh = await refreshQbToken(profile.qb_refresh_token);
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
      `SELECT Id, CustomerRef FROM Invoice WHERE Id = '${qbInvoiceId}'`
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

async function sendOwnerNotification(quote: any, amountPaid: number, isDeposit: boolean) {
  if (!RESEND_API_KEY || !quote?.shop_owner) return;

  const subject = `Payment Received — Quote #${quote.quote_id}`;
  const paymentType = isDeposit ? "Deposit" : "Full Payment";

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="color:#1e293b">Payment Confirmed!</h2>
      <p style="color:#475569;line-height:1.6">
        <strong>${quote.customer_name}</strong> has completed their payment.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        <tr><td style="padding:8px 0;color:#94a3b8;font-size:14px">Quote #</td><td style="padding:8px 0;font-weight:600;color:#1e293b">${quote.quote_id}</td></tr>
        <tr><td style="padding:8px 0;color:#94a3b8;font-size:14px">Customer</td><td style="padding:8px 0;font-weight:600;color:#1e293b">${quote.customer_name}</td></tr>
        <tr><td style="padding:8px 0;color:#94a3b8;font-size:14px">Type</td><td style="padding:8px 0;font-weight:600;color:#1e293b">${paymentType}</td></tr>
        <tr><td style="padding:8px 0;color:#94a3b8;font-size:14px">Amount</td><td style="padding:8px 0;font-weight:700;color:#4f46e5;font-size:18px">${fmtMoney(amountPaid)}</td></tr>
        ${quote.due_date ? `<tr><td style="padding:8px 0;color:#94a3b8;font-size:14px">In-Hands Date</td><td style="padding:8px 0;font-weight:600;color:#1e293b">${quote.due_date}</td></tr>` : ""}
      </table>
      ${isDeposit ? `<p style="color:#92400e;font-size:13px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px"><strong>Note:</strong> This was a deposit. The remaining balance is due upon completion.</p>` : ""}
      <p style="color:#94a3b8;font-size:12px;margin-top:32px">Stripe-verified · Sent by InkTracker</p>
    </div>
  `;

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

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="color:#1e293b">${isDeposit ? "Deposit Received!" : "Payment Confirmed!"}</h2>
      <p style="color:#475569;line-height:1.6">
        Hi ${quote.customer_name || "there"}, thank you for your payment to <strong>${shopName}</strong>.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        <tr><td style="padding:8px 0;color:#94a3b8;font-size:14px">Order #</td><td style="padding:8px 0;font-weight:600;color:#1e293b">${quote.quote_id}</td></tr>
        <tr><td style="padding:8px 0;color:#94a3b8;font-size:14px">Amount Paid</td><td style="padding:8px 0;font-weight:700;color:#4f46e5;font-size:18px">${fmtMoney(amountPaid)}</td></tr>
        ${quote.due_date ? `<tr><td style="padding:8px 0;color:#94a3b8;font-size:14px">In-Hands Date</td><td style="padding:8px 0;font-weight:600;color:#1e293b">${quote.due_date}</td></tr>` : ""}
      </table>
      ${isDeposit
        ? `<p style="color:#92400e;font-size:13px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px">
             <strong>Deposit received.</strong> The remaining balance will be due upon completion.
           </p>`
        : `<p style="color:#065f46;font-size:13px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px">
             <strong>Payment complete.</strong> We'll be in touch once your order is ready.
           </p>`}
      <p style="color:#475569;font-size:14px;margin-top:24px">
        Questions? Reply to this email or contact ${shopName} directly.
      </p>
      <p style="color:#94a3b8;font-size:12px;margin-top:32px">Sent by InkTracker on behalf of ${shopName}</p>
    </div>
  `;

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

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

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
    return Response.json({ error: String(err.message ?? err) }, { status: 500, headers: CORS });
  }
});
