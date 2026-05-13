// Send quote/invoice email via Resend
// Sends FROM quotes@inktracker.app (verified domain) with Reply-To set to the
// shop owner or broker's actual email so replies go directly to them.

import { createClient } from "npm:@supabase/supabase-js@2";
import { requireActiveSubscription } from "../_shared/subscriptionGuard.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SEND_FROM      = Deno.env.get("FROM_EMAIL") ?? "quotes@biotamfg.co";

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
      // Force shopName from the DB so one shop can't impersonate another.
      const { data: shop } = await admin
        .from("shops")
        .select("shop_name")
        .eq("owner_email", quote.shop_owner)
        .maybeSingle();
      shopName = shop?.shop_name || "InkTracker";
      // Force Reply-To / Bcc target to the legitimate shop owner.
      shopOwnerEmail = quote.shop_owner;
    }

    const emailSubject = subject || `Your Quote from ${shopName} - Quote #${quoteId}`;
    const total = Number(quoteTotal || 0).toFixed(2);
    const firstName = (customerName || "").split(" ")[0] || "there";

    // If a custom body was provided, use it. Otherwise build a clean default.
    const customBody = body ? body
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>") : "";

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:0;">
        <!-- Header -->
        <div style="background:#1e293b;padding:28px 32px;border-radius:16px 16px 0 0;text-align:center;">
          <h1 style="color:#ffffff;font-size:20px;font-weight:700;margin:0;">${shopName || "Your Quote"}</h1>
          <p style="color:#94a3b8;font-size:13px;margin:6px 0 0;">Quote #${quoteId || ""}</p>
        </div>

        <!-- Body -->
        <div style="background:#ffffff;padding:32px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
          ${customBody ? `<p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">${customBody}</p>` : `
            <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 8px;">Hi ${firstName},</p>
            <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">Your quote is ready for review. Click below to view, approve, or pay online.</p>
          `}

          <!-- Total -->
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;text-align:center;margin-bottom:28px;">
            <p style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px;">Quote Total</p>
            <p style="color:#1e293b;font-size:32px;font-weight:800;margin:0;">$${total}</p>
          </div>

          <!-- CTA Button -->
          ${(paymentLink || approveLink) ? `
            <div style="text-align:center;margin-bottom:24px;">
              <a href="${paymentLink || approveLink}"
                style="display:inline-block;background:#4f46e5;color:#ffffff;font-size:15px;font-weight:600;padding:14px 36px;border-radius:12px;text-decoration:none;">
                ${buttonLabel || "View Quote &amp; Pay Online"}
              </a>
            </div>
          ` : ""}

          ${brokerName ? `<p style="color:#94a3b8;font-size:13px;margin:0 0 16px;">Submitted by ${brokerName}${brokerEmail ? ` &middot; ${brokerEmail}` : ""}</p>` : ""}
        </div>

        <!-- Footer -->
        <div style="background:#f8fafc;padding:20px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;">
          <p style="color:#94a3b8;font-size:11px;line-height:1.5;margin:0 0 12px;">
            Sales tax shown reflects jurisdictions where we are registered to collect.
            Buyer is responsible for any use tax owed to their home jurisdiction.
          </p>
          <p style="color:#cbd5e1;font-size:11px;margin:0;">
            Powered by <a href="https://www.inktracker.app" style="color:#94a3b8;text-decoration:none;">InkTracker</a>
          </p>
        </div>
      </div>
    `;

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
