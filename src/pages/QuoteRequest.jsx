import { useState, useEffect } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import OrderWizard from "../components/wizard/OrderWizard";

// ─── Public New-Quote Wizard ─────────────────────────────────────────────────
// Customer-facing quote-request form. Embedded on shop websites via Embed.jsx,
// or linked as a standalone URL.
//
// NOTE: A `?clientReview=true&quoteId=X` flow used to live here that let
// anyone with the URL approve a quote — no token gate. It was superseded by
// the public_token-gated /quotepayment route, was never linked from anywhere
// else in the codebase, and was removed on 2026-05-12 to close the
// anon-update vector. If you need a customer review/approve page, use
// /quotepayment which validates the token server-side.

export default function QuoteRequest() {
  const params = new URLSearchParams(window.location.search);
  const shopParam = params.get("shop") || "";

  const [shop, setShop] = useState(null);
  const [wizardStyles, setWizardStyles] = useState(null);
  const [shopOwner, setShopOwner] = useState(shopParam);
  // Gate the wizard render on the shop fetch finishing — without it,
  // OrderWizard mounts with shop=null, paints the default teal CSS vars,
  // then re-paints with the shop's brand_color when the fetch resolves.
  // That's the "split-second wrong color" flash. Brief spinner during
  // load is better than that flicker.
  const [shopLoading, setShopLoading] = useState(true);

  useEffect(() => {
    async function loadShop() {
      try {
        // Try ?shop= param first (for embeds), fall back to logged-in user
        let ownerEmail = shopParam;
        if (!ownerEmail) {
          const me = await base44.auth.me().catch(() => null);
          if (me?.email) ownerEmail = me.email;
        }
        if (!ownerEmail) return;
        setShopOwner(ownerEmail);
        const shops = await base44.entities.Shop.filter({ owner_email: ownerEmail });
        const s = shops?.[0];
        if (s) {
          setShop(s);
          if (s.wizard_styles?.length) setWizardStyles(s.wizard_styles);
          // Hydrate the shared pricing module with the shop's per-shop
          // config so getEnabledTechniques() returns ALL methods the
          // shop offers (Screen Print + Embroidery + DTF + …), not just
          // the screen-print default. Without this hydration step the
          // module-level `_pc` stays null for anonymous wizard visitors
          // (AuthContext only fires for logged-in users), and the
          // Technique dropdown on every print location shows just
          // "Screen Print" even when the shop has embroidery enabled.
          if (s.pricing_config) {
            const { loadShopPricingConfig } = await import("@/components/shared/pricing");
            loadShopPricingConfig(s.pricing_config);
          }
        }
      } catch {} finally {
        setShopLoading(false);
      }
    }
    loadShop();
  }, [shopParam]);

  async function handleSubmit(quote) {
    // Public wizard submission goes through a SECURITY DEFINER RPC,
    // NOT a direct table INSERT. See src/lib/wizardSubmit.js +
    // migration 20260531_quotes_anon_lockdown.sql for the rationale —
    // the RLS policies on quotes are locked down so anon clients
    // can't read or write the table directly.
    const { submitWizardQuote } = await import("@/lib/wizardSubmit");
    await submitWizardQuote(supabase, quote, shopOwner);

    // Send notification emails — failures don't block the submission
    try {
      const linesSummary = (quote.line_items || [])
        .map(li => `${li.style} · ${li.garmentColor} (${Object.values(li.sizes || {}).reduce((s,v) => s + (parseInt(v) || 0), 0)} pcs)`)
        .join("\n");

      // Notify the shop owner
      const { data: ownerRes, error: ownerErr } = await supabase.functions.invoke("sendQuoteEmail", {
        body: {
          customerEmails: [shopOwner],
          customerName: quote.customer_name || "Customer",
          quoteId: quote.quote_id,
          shopName: shop?.shop_name || "Your Shop",
          subject: `New Quote Request from ${quote.customer_name || "a customer"}`,
          body: `A new quote request has been submitted through your order wizard.\n\nCustomer: ${quote.customer_name}\nEmail: ${quote.customer_email || "—"}\nPhone: ${quote.phone || "—"}\nCompany: ${quote.company || "—"}\n\nItems:\n${linesSummary}\n\nLog in to InkTracker to review and send a quote.`,
        },
      });
      if (ownerErr) console.error("[QuoteRequest] owner email error:", ownerErr);
      if (ownerRes?.error) console.error("[QuoteRequest] owner email failed:", ownerRes.error);

      // Confirm to the customer
      if (quote.customer_email) {
        const { error: custErr } = await supabase.functions.invoke("sendQuoteEmail", {
          body: {
            customerEmails: [quote.customer_email],
            customerName: quote.customer_name || "Customer",
            quoteId: quote.quote_id,
            shopName: shop?.shop_name || "Print Shop",
            subject: `We received your quote request — ${shop?.shop_name || "Print Shop"}`,
            body: `Hi ${quote.customer_name || "there"},\n\nThank you for your order request! We've received it and will follow up within 1 business day with a finalized quote.\n\nItems requested:\n${linesSummary}\n\nIf you have any questions, just reply to this email.`,
          },
        });
        if (custErr) console.error("[QuoteRequest] customer email error:", custErr);
      }
    } catch (err) {
      console.error("[QuoteRequest] notification email failed:", err?.message);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-4 py-10">
        {shopLoading ? (
          <div className="flex items-center justify-center py-32">
            <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <OrderWizard
              onSubmit={handleSubmit}
              styles={wizardStyles}
              shopOwner={shopOwner}
              shop={shop}
            />
            <div className="text-center mt-10 text-xs text-slate-400">
              Questions? Reach out and we'll get back to you within 1 business day.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
