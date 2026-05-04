// Send a thread reply via Resend.
// This is a minimal sibling to sendQuoteEmail — no PDFs, no payment buttons,
// no fancy template. Just shop owner -> customer with the body they typed.
//
// The body is wrapped in a clean HTML envelope so it renders well, but the
// content is exactly what was typed. Reply-to is set to the shop owner's
// email so customer responses go straight to them (and to emailScanner if
// scanning is enabled).
//
// Authenticated request — RLS on messages table is enforced separately when
// the frontend logs the row.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SEND_FROM      = Deno.env.get("FROM_EMAIL") ?? "quotes@inktracker.app";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function bodyToHtml(body: string): string {
  // Preserve line breaks; light typographic frame.
  const safe = escapeHtml(body).replace(/\n/g, "<br>");
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937;">
      <div style="font-size:15px;line-height:1.6;color:#334155;">${safe}</div>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0 12px;">
      <p style="color:#94a3b8;font-size:11px;margin:0;">
        Sent via <a href="https://www.inktracker.app" style="color:#94a3b8;text-decoration:none;">InkTracker</a>
      </p>
    </div>
  `;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const {
      to,                  // string OR string[] — customer email(s)
      subject,             // already include any [Ref: ...] tag
      body,                // plain text the user typed
      shopName,            // display name in From header
      shopOwnerEmail,      // becomes Reply-To
    } = await req.json();

    const toList = Array.isArray(to) ? to.filter(Boolean) : (to ? [to] : []);
    if (toList.length === 0) {
      return Response.json({ error: "No recipient" }, { status: 400, headers: CORS });
    }
    if (!body || typeof body !== "string") {
      return Response.json({ error: "Empty body" }, { status: 400, headers: CORS });
    }

    if (!RESEND_API_KEY) {
      console.log("[sendReply] No RESEND_API_KEY — skipping send for", toList);
      return Response.json({ sent: false, reason: "no_api_key" }, { headers: CORS });
    }

    const escapeQuotes = (s: string) => String(s || "").replace(/"/g, "");
    const fromHeader = `${escapeQuotes(shopName || "InkTracker")} <${SEND_FROM}>`;

    const html = bodyToHtml(body);

    const results = await Promise.all(
      toList.map(async (recipient: string) => {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromHeader,
            to: [recipient],
            subject: subject || "(no subject)",
            html,
            ...(shopOwnerEmail ? { reply_to: shopOwnerEmail } : {}),
            // Bcc the shop owner so they have a copy in their inbox too.
            ...(shopOwnerEmail ? { bcc: [shopOwnerEmail] } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) console.error("[sendReply] Resend error:", data);
        return { to: recipient, ok: res.ok, data };
      })
    );

    const allOk = results.every((r) => r.ok);
    return Response.json({ sent: allOk, results }, { headers: CORS });
  } catch (err) {
    console.error("[sendReply] error:", err);
    return Response.json({ error: String(err.message ?? err) }, { status: 500, headers: CORS });
  }
});
