// Send quote/invoice email via Resend
// Sends FROM quotes@inktracker.app (verified domain) with Reply-To set to the
// shop owner or broker's actual email so replies go directly to them.

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { requireActiveSubscription } from "../_shared/subscriptionGuard.ts";
import { escapeHtml, sanitizeEmailBody } from "../_shared/emailSanitize.js";
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
    let caller: { email: string; shop_owner: string; assigned_shops: string[] } | null = null;
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        isAuthed = true;
        const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const { data: profile } = await admin.from("profiles")
          .select("email, shop_owner, assigned_shops, subscription_tier, subscription_status, trial_ends_at")
          .eq("auth_id", user.id).maybeSingle();
        const blocked = requireActiveSubscription(profile);
        if (blocked) return blocked;
        caller = {
          email: String(profile?.email || user.email || "").toLowerCase(),
          shop_owner: String(profile?.shop_owner || "").toLowerCase(),
          assigned_shops: Array.isArray(profile?.assigned_shops)
            ? profile.assigned_shops.map((e: any) => String(e || "").toLowerCase())
            : [],
        };
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
      proofImages,
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
      // Rate-limit the anon path: at most 10 sends/hour per quote. The
      // wizard fires 1–2 legit emails per submission, so this is generous for
      // real use but stops an attacker replaying one created quote to
      // email-bomb the customer/owner from the verified domain.
      const { data: underLimit, error: rateErr } = await admin.rpc("check_anon_email_rate", {
        p_key: `quote:${quoteId}`,
        p_limit_per_hr: 10,
      });
      if (rateErr) {
        // Fail open on a counter error (don't drop legit sends), but log it.
        console.error("[sendQuoteEmail] anon rate check failed (allowing):", rateErr.message);
      } else if (underLimit === false) {
        return Response.json(
          { error: "Too many emails for this quote right now. Please try again later." },
          { status: 429, headers: CORS },
        );
      }
      // No payment links, PDFs, or broker fields on the anonymous path —
      // the wizard never passes them; an attacker would use them to dress
      // up a phishing email.
      if (paymentLink || approveLink || pdfBase64 || brokerName || brokerEmail || (Array.isArray(proofImages) && proofImages.length)) {
        return Response.json(
          { error: "Anonymous callers may not include payment links, attachments, proof images, or broker fields" },
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
      const { data: ownerProfile } = await admin
        .from("profiles")
        .select("shop_name, logo_url")
        .eq("email", quote.shop_owner)
        .maybeSingle();
      // profiles.shop_name is the canonical name the owner edits on Account;
      // shops.shop_name is a mirror that can lag (renames didn't sync it).
      // Prefer the profile so the email brand never shows a stale shop name.
      shopName = ownerProfile?.shop_name || shop?.shop_name || "InkTracker";
      shopLogoUrl = ownerProfile?.logo_url || null;
      // Force Reply-To / Bcc target to the legitimate shop owner.
      shopOwnerEmail = quote.shop_owner;
    }

    // ── Authenticated-caller authorization ────────────────────────────
    // Without this, ANY subscribed account (shop, manager, employee, broker,
    // trial) could send arbitrary email — custom subject/body/payment link, to
    // arbitrary recipients, with a spoofed shop name — from the verified
    // quotes@inktracker.app domain. Require that the caller's shop actually owns
    // the quote, and force the merchant-of-record brand fields from the DB so
    // the sender identity can't be spoofed.
    if (isAuthed) {
      if (!quoteId) {
        return Response.json({ error: "quoteId required" }, { status: 400, headers: CORS });
      }
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: q } = await admin
        .from("quotes")
        .select("shop_owner, broker_id, broker_name, broker_company, broker_email")
        .eq("quote_id", quoteId)
        .maybeSingle();
      if (!q) {
        return Response.json({ error: "Quote not found" }, { status: 404, headers: CORS });
      }
      const qShopOwner = String(q.shop_owner || "").toLowerCase();
      const email = caller?.email || "";
      const ownsQuote =
        (!!qShopOwner && (
          qShopOwner === email ||                                   // shop owner
          (!!caller?.shop_owner && caller.shop_owner === qShopOwner) || // member of that shop
          caller?.assigned_shops.includes(qShopOwner)               // manager/employee/broker assigned
        )) ||
        (!!q.broker_id && String(q.broker_id).toLowerCase() === email); // broker who submitted it
      if (!ownsQuote) {
        return Response.json({ error: "You don't have access to this quote." }, { status: 403, headers: CORS });
      }
      // Force brand / merchant-of-record from the DB (never the payload). Mirrors
      // getCustomerFacingBrandName: broker quotes show the broker; otherwise the shop.
      if (q.broker_id) {
        brokerName  = q.broker_name || "";
        brokerEmail = q.broker_email || "";
      } else {
        brokerName = "";
        brokerEmail = "";
      }
      const { data: shopRow } = await admin.from("shops").select("shop_name").eq("owner_email", q.shop_owner).maybeSingle();
      const { data: ownerProf } = await admin.from("profiles").select("shop_name, logo_url").eq("email", q.shop_owner).maybeSingle();
      // Prefer the owner's canonical profiles.shop_name over the shops mirror.
      shopName = (q.broker_id ? (q.broker_company || q.broker_name) : "") || ownerProf?.shop_name || shopRow?.shop_name || shopName || "InkTracker";
      shopLogoUrl = ownerProf?.logo_url || null;
    }

    const emailSubject = subject || `Your Quote from ${shopName} - Quote #${quoteId}`;
    const total = Number(quoteTotal || 0).toFixed(2);

    // Anything that flows from user-controlled fields (customer name from
    // the public wizard, broker-set display name + email, the custom body)
    // needs HTML-escaping before it lands in the email body — otherwise a
    // `<script>` or `<img onerror=…>` renders in the recipient's inbox. Shared,
    // unit-tested escaper (escapes quotes too — INT-04).
    const firstName = escapeHtml((customerName || "").split(" ")[0] || "there");
    const safeBrokerName  = escapeHtml(brokerName);
    const safeBrokerEmail = escapeHtml(brokerEmail);

    // Custom body: fully escape (incl. quotes), then newlines → <br>. Was
    // escaping only &<> (INT-04) — fine in element content, latent elsewhere.
    const customBody = sanitizeEmailBody(body);

    // Inline art proof(s). Strictly allowlisted: https + our public storage
    // path only, so a crafted payload can't smuggle a tracking pixel or a
    // javascript:/data: URL into the recipient's inbox. (The anon path already
    // rejects proofImages entirely above.)
    const safeProofImages = (Array.isArray(proofImages) ? proofImages : [])
      .filter((p: any) =>
        p && typeof p.url === "string" &&
        /^https:\/\//i.test(p.url) &&
        p.url.includes("/storage/v1/object/public/"))
      .slice(0, 6);
    const proofHtml = safeProofImages.length
      ? `<div style="margin:4px 0 24px;">
           <p style="color:${EMAIL_MUTED};font-size:13px;font-weight:600;margin:0 0 8px;">Art Proof</p>
           ${safeProofImages.map((p: any) =>
             `<img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.name || "Art proof")}" style="display:block;max-width:100%;border:1px solid #e5e7eb;border-radius:8px;margin:0 0 10px;" />`).join("")}
         </div>`
      : "";

    const bodyHtml = `
      ${customBody
        ? `<p style="color:${EMAIL_INK};font-size:15px;line-height:1.65;margin:0 0 20px;">${customBody}</p>`
        : `
          <p style="color:${EMAIL_INK};font-size:15px;line-height:1.65;margin:0 0 12px;">Hi ${firstName},</p>
          <p style="color:${EMAIL_INK};font-size:15px;line-height:1.65;margin:0 0 24px;">Your quote is ready for review. Click below to view, approve, or pay online.</p>
        `
      }
      ${proofHtml}
      ${renderEmailHighlight("Quote Total", `$${total}`)}
      ${(paymentLink || approveLink) ? renderEmailButton(buttonLabel || "View Quote & Pay Online", paymentLink || approveLink) : ""}
      ${brokerName ? `<p style="color:${EMAIL_MUTED};font-size:13px;margin:8px 0 0;">Submitted by ${safeBrokerName}${brokerEmail ? ` &middot; ${safeBrokerEmail}` : ""}</p>` : ""}
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
    return Response.json({ error: String((err as any)?.message ?? err) }, { status: 500, headers: CORS });
  }
});
