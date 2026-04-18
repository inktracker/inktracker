// Send quote email via Resend
// Set RESEND_API_KEY in Supabase secrets to enable email sending.
// Without it, the function returns success but logs instead of sending.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL     = Deno.env.get("FROM_EMAIL") ?? "quotes@inktracker.app";
const FROM_NAME      = Deno.env.get("FROM_NAME")  ?? "InkTracker";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
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
    } = await req.json();

    if (!customerEmails?.length) {
      return Response.json({ error: "No recipient emails provided" }, { status: 400, headers: CORS });
    }

    const emailSubject = subject || `Quote ${quoteId} from ${shopName}`;
    const emailBody = body || `Hi ${customerName},\n\nPlease find your quote attached.\n\nTotal: $${Number(quoteTotal).toFixed(2)}\n\nView & Pay: ${paymentLink}`;

    const htmlBody = emailBody
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");

    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2 style="color:#1e293b">${emailSubject}</h2>
        <p style="color:#475569;line-height:1.6">${htmlBody}</p>
        <div style="margin:32px 0">
          <a href="${approveLink}"
            style="background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
            View Quote &amp; Pay Online
          </a>
        </div>
        ${brokerName ? `<p style="color:#94a3b8;font-size:13px">Submitted by ${brokerName}${brokerEmail ? ` · ${brokerEmail}` : ""}</p>` : ""}
        <div style="color:#94a3b8;font-size:11px;font-style:italic;margin-top:28px;line-height:1.5">
          <p style="margin:0 0 8px 0">
            Sales tax shown reflects jurisdictions where we are registered to collect.
            Buyer is responsible for any use tax owed to their home jurisdiction.
          </p>
          <p style="margin:0">
            Production tolerance: industry-standard spoilage applies. Orders short up to 3%
            will receive a credit to your account. Defect rates above 3% will be reprinted
            at no charge within 7–10 business days. Claims must be submitted with photos
            within 72 hours of delivery. Misprinted garments do not need to be returned.
            Approved proofs are final.
          </p>
        </div>
        <p style="color:#cbd5e1;font-size:12px;margin-top:16px">Powered by InkTracker</p>
      </div>
    `;

    if (!RESEND_API_KEY) {
      // Log and return success so the UI still marks the quote as sent
      console.log("[sendQuoteEmail] No RESEND_API_KEY set — email not sent");
      console.log("[sendQuoteEmail] Would have sent to:", customerEmails);
      console.log("[sendQuoteEmail] Subject:", emailSubject);
      return Response.json({ sent: false, reason: "no_api_key" }, { headers: CORS });
    }

    // If a broker sent this quote, show the broker's name on the From line and
    // route replies to their actual inbox. Send domain stays on our verified
    // biotamfg.co so SPF/DKIM pass.
    const escapeQuotes = (s: string) => String(s || "").replace(/"/g, "");
    const fromName = brokerName ? escapeQuotes(brokerName) : FROM_NAME;
    const fromHeader = `${fromName} <${FROM_EMAIL}>`;
    const replyTo = brokerEmail || undefined;

    const results = await Promise.all(
      customerEmails.map(async (to: string) => {
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
            // BCC the broker so they have a copy in their own inbox
            ...(brokerEmail ? { bcc: [brokerEmail] } : {}),
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
