// Send quote/invoice email via Resend
// Sends FROM quotes@inktracker.app (verified domain) with Reply-To set to the
// shop owner or broker's actual email so replies go directly to them.

import { createClient } from "npm:@supabase/supabase-js@2";
import { requireActiveSubscription } from "../_shared/subscriptionGuard.ts";
import {
  renderEmailLayout,
  renderEmailButton,
  renderEmailHighlight,
  EMAIL_INK,
  EMAIL_MUTED,
} from "../_shared/emailLayout.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
// Default to the verified InkTracker domain (SPF/DKIM/DMARC set up there).
// biotamfg.co isn't an InkTracker sending domain; if FROM_EMAIL env var is
// unset, fall back to inktracker.app so mail actually delivers.
const SEND_FROM      = Deno.env.get("FROM_EMAIL") ?? "quotes@inktracker.app";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // Identify the caller. Authenticated callers (shop owners sending quotes
    // from /Quotes) get the full body-control surface. Anonymous callers (the
    // public wizard at /Wizard and /QuoteRequest) get a locked-down path:
    // recipients must belong to the quote, no payment links / PDFs / broker
    // fields, and shopName is forced to come from the DB. Without this,
    // anyone who could insert a quote (anon insert is allowed for the wizard)
    // could turn this endpoint into a phishing payload generator using the
    // verified quotes@inktracker.app domain.
    const authHeader = req.headers.get("authorization") || "";
    let isAuthed = false;
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        isAuthed = true;
        const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const { data: profile } = await admin.from("profiles").select("subscription_tier, subscription_status, trial_ends_at").eq("auth_id", user.id).maybeSingle();
        const blocked = requireActiveSubscription(profile);
        if (blocked) return blocked;
      }
    }

    const payload = await req.json();
    let {
      customerEmails,
      customerName,
      quoteId,
      quoteTotal,
      paymentLink,
      approveLink,
      shopName,
      shopLogoUrl,
      subject,
      body,
      brokerName,
      brokerEmail,
      pdfBase64,
      pdfFilename,
      buttonLabel,
      shopOwnerEmail,
    } = payload;

    if (!customerEmails?.length) {
      return Response.json({ error: "No recipient emails provided" }, { status: 400, headers: CORS });
    }

    // ── Anonymous-caller lockdown ─────────────────────────────────────
    if (!isAuthed) {
      if (!quoteId) {
        return Response.json({ error: "quoteId required" }, { status: 400, headers: CORS });
      }
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: quote } = await admin
        .from("quotes")
        .select("shop_owner, customer_email, sent_to")
        .eq("quote_id", quoteId)
        .maybeSingle();
      if (!quote) {
        return Response.json({ error: "Quote not found" }, { status: 404, headers: CORS });
      }
      // Recipients must be one of: the shop owner, the quote's customer email,
      // or sent_to (legacy field some quotes use for the customer address).
      const allowed = new Set(
        [quote.shop_owner, quote.customer_email, quote.sent_to]
          .filter(Boolean)
          .map((e: string) => e.toLowerCase()),
      );
      const requested = (Array.isArray(customerEmails) ? customerEmails : [])
        .map((e: any) => String(e || "").toLowerCase())
        .filter(Boolean);
      if (requested.length === 0 || requested.some((e) => !allowed.has(e))) {
        return Response.json(
          { error: "Recipient not associated with this quote" },
          { status: 403, headers: CORS },
        );
      }
      // No payment links, PDFs, or broker fields on the anonymous path —
      // the wizard never passes them; an attacker would use them to dress
      // up a phishing email.
      if (paymentLink || approveLink || pdfBase64 || brokerName || brokerEmail) {
        return Response.json(
          { error: "Anonymous callers may not include payment links, attachments, or broker fields" },
          { status: 403, headers: CORS },
        );
      }
      // Force shopName + logo from the DB so one shop can't impersonate
      // another. The wizard never sets shopLogoUrl; an attacker who did
      // would get the DB value here anyway.
      const { data: shop } = await admin
        .from("shops")
        .select("shop_name")
        .eq("owner_email", quote.shop_owner)
        .maybeSingle();
      shopName = shop?.shop_name || "InkTracker";
      const { data: ownerProfile } = await admin
        .from("profiles")
        .select("logo_url")
        .eq("email", quote.shop_owner)
        .maybeSingle();
      shopLogoUrl = ownerProfile?.logo_url || null;
      // Force Reply-To / Bcc target to the legitimate shop owner.
      shopOwnerEmail = quote.shop_owner;
    }

    const emailSubject = subject || `Your Quote from ${shopName} - Quote #${quoteId}`;
    const total = Number(quoteTotal || 0).toFixed(2);
    const firstName = (customerName || "").split(" ")[0] || "there";

    // If a custom body was provided, use it. Otherwise build a clean default.
    const customBody = body ? body
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>") : "";

    const bodyHtml = `
      ${customBody
        ? `<p style="color:${EMAIL_INK};font-size:15px;line-height:1.65;margin:0 0 20px;">${customBody}</p>`
        : `
          <p style="color:${EMAIL_INK};font-size:15px;line-height:1.65;margin:0 0 12px;">Hi ${firstName},</p>
          <p style="color:${EMAIL_INK};font-size:15px;line-height:1.65;margin:0 0 24px;">Your quote is ready for review. Click below to view, approve, or pay online.</p>
        `
      }
      ${renderEmailHighlight("Quote Total", `$${total}`)}
      ${(paymentLink || approveLink) ? renderEmailButton(buttonLabel || "View Quote & Pay Online", paymentLink || approveLink) : ""}
      ${brokerName ? `<p style="color:${EMAIL_MUTED};font-size:13px;margin:8px 0 0;">Submitted by ${brokerName}${brokerEmail ? ` &middot; ${brokerEmail}` : ""}</p>` : ""}
    `;

    const html = renderEmailLayout({
      shopName: shopName || "Your Quote",
      subhead: quoteId ? `Quote #${quoteId}` : "",
      contentHtml: bodyHtml,
      footerHtml: "Sales tax shown reflects jurisdictions where we are registered to collect. Buyer is responsible for any use tax owed to their home jurisdiction.",
      logoUrl: shopLogoUrl,
    });

    if (!RESEND_API_KEY) {
      console.log("[sendQuoteEmail] No RESEND_API_KEY set — email not sent");
      console.log("[sendQuoteEmail] Would have sent to:", customerEmails);
      console.log("[sendQuoteEmail] Subject:", emailSubject);
      return Response.json({ sent: false, reason: "no_api_key" }, { headers: CORS });
    }

    // From: shows the shop or broker name, sends from verified inktracker.app domain
    // Reply-To: the actual person's email so customer replies go directly to them
    const escapeQuotes = (s: string) => String(s || "").replace(/"/g, "");
    const isBrokerSend = !!brokerName;
    const displayName = isBrokerSend
      ? escapeQuotes(brokerName)
      : escapeQuotes(shopName || "InkTracker");
    const fromHeader = `${displayName} <${SEND_FROM}>`;
    const replyTo = isBrokerSend
      ? (brokerEmail || shopOwnerEmail)
      : (shopOwnerEmail || undefined);

    const results = await Promise.all(
      customerEmails.map(async (to: string) => {
        const bccList = [shopOwnerEmail, brokerEmail].filter(Boolean);
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromHeader,
            to: [to],
            subject: emailSubject,
            html,
            ...(replyTo ? { reply_to: replyTo } : {}),
            ...(bccList.length > 0 ? { bcc: bccList } : {}),
            ...(pdfBase64 ? {
              attachments: [{
                filename: pdfFilename || `Quote-${quoteId}.pdf`,
                content: pdfBase64,
              }],
            } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) console.error("[sendQuoteEmail] Resend error:", data);
        return { to, ok: res.ok, data };
      })
    );

    const allOk = results.every((r) => r.ok);
    return Response.json({ sent: allOk, results }, { headers: CORS });
  } catch (err) {
    console.error("[sendQuoteEmail] error:", err);
    return Response.json({ error: String(err.message ?? err) }, { status: 500, headers: CORS });
  }
});
