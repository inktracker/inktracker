import { useEffect, useState } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import OrderWizard from "../components/wizard/OrderWizard";
import EmbedSnippets from "../components/wizard/EmbedSnippets";
import { ChevronDown, ChevronRight, Code2 } from "lucide-react";

export default function Wizard() {
  const [styles, setStyles] = useState(null);
  const [setups, setSetups] = useState(null);

  const [shopOwner, setShopOwner] = useState("");
  const [shopName, setShopName] = useState("");
  const [embedOpen, setEmbedOpen] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const me = await base44.auth.me();
        if (!me?.email) return;
        setShopOwner(me.email);
        if (me.shop_name) setShopName(me.shop_name);
        const shops = await base44.entities.Shop.filter({ owner_email: me.email });
        const shop = shops?.[0];
        if (shop?.shop_name && !me.shop_name) setShopName(shop.shop_name);
        if (shop?.wizard_styles?.length) setStyles(shop.wizard_styles);
        if (shop?.wizard_setups?.length) setSetups(shop.wizard_setups);
      } catch {
        // Fall back to defaults
      }
    }
    load();
  }, []);

  async function handleSubmit(quote) {
    await base44.entities.Quote.create({ ...quote, shop_owner: shopOwner, source: "wizard" });

    try {
      const linesSummary = (quote.line_items || [])
        .map(li => `${li.style} · ${li.garmentColor} (${Object.values(li.sizes || {}).reduce((s,v) => s + (parseInt(v) || 0), 0)} pcs)`)
        .join("\n");

      const displayShop = shopName || "Your Shop";
      await supabase.functions.invoke("sendQuoteEmail", {
        body: {
          customerEmails: [shopOwner],
          customerName: quote.customer_name || "Customer",
          quoteId: quote.quote_id,
          shopName: displayShop,
          subject: `New Quote Request from ${quote.customer_name || "a customer"}`,
          body: `A new quote request has been submitted through the order wizard.\n\nCustomer: ${quote.customer_name}\nEmail: ${quote.customer_email || "—"}\nPhone: ${quote.phone || "—"}\nCompany: ${quote.company || "—"}\n\nItems:\n${linesSummary}\n\nLog in to InkTracker to review and send a quote.`,
        },
      });

      if (quote.customer_email) {
        await supabase.functions.invoke("sendQuoteEmail", {
          body: {
            customerEmails: [quote.customer_email],
            customerName: quote.customer_name || "Customer",
            quoteId: quote.quote_id,
            shopName: displayShop,
            subject: `We received your quote request — ${displayShop}`,
            body: `Hi ${quote.customer_name || "there"},\n\nThank you for your order request! We've received it and will follow up within 1 business day with a finalized quote.\n\nItems requested:\n${linesSummary}\n\nIf you have any questions, just reply to this email.`,
          },
        });
      }
    } catch (err) {
      console.error("[Wizard] email notification failed:", err?.message);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Order Wizard</h2>
        <p className="text-slate-400 text-sm mt-1">Step-by-step quote builder for walk-in or phone customers</p>
      </div>
      <OrderWizard onSubmit={handleSubmit} styles={styles} setups={setups} shopOwner={shopOwner} />

      {/* Embed snippets — collapsable, closed by default. The wizard
          is the primary thing on this page; embedding is a secondary
          "put it on my site" workflow that doesn't deserve its own
          nav entry but should be one click away. */}
      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
        <button
          onClick={() => setEmbedOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50 transition"
        >
          <div className="flex items-center gap-3">
            <Code2 className="w-5 h-5 text-slate-400" />
            <div>
              <div className="font-bold text-slate-800">Embed on your website</div>
              <div className="text-xs text-slate-400 mt-0.5">
                Paste a snippet on Shopify, Wix, Squarespace, or anywhere — customers submit quote requests directly to your Quotes page.
              </div>
            </div>
          </div>
          {embedOpen ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
        </button>
        {embedOpen && (
          <div className="px-5 pb-5 border-t border-slate-100">
            <div className="pt-5">
              <EmbedSnippets />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}