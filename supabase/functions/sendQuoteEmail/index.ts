// Send quote/invoice email via Resend
// Sends FROM quotes@inktracker.app (verified domain) with Reply-To set to the
// shop owner or broker's actual email so replies go directly to them.

import { createClient } from "npm:@supabase/supabase-js@2";
import { requireActiveSubscription } from "../_shared/subscriptionGuard.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SEND_FROM      = Deno.env.get("FROM_EMAIL") ?? "quotes@biotamfg.co";

const CORS = {
  "Access-Control-Allow-Origin": "https://www.inktracker.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // Check subscription for authenticated callers (skip for anon/wizard notifications)
    const authHeader = req.headers.get("authorization") || "";
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const { data: profile } = await admin.from("profiles").select("subscription_tier, subscription_status, trial_ends_at").eq("auth_id", user.id).maybeSingle();
        const blocked = requireActiveSubscription(profile);
        if (blocked) return blocked;
      }
    }

    const {
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
    } = await req.json();

    if (!customerEmails?.length) {
      return Response.json({ error: "No recipient emails provided" }, { status: 400, headers: CORS });
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
