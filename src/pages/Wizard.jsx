import { useEffect, useState } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import OrderWizard from "../components/wizard/OrderWizard";

export default function Wizard() {
  const [styles, setStyles] = useState(null);
  const [setups, setSetups] = useState(null);

  const [shopOwner, setShopOwner] = useState("");
  const [shopName, setShopName] = useState("");

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
    </div>
  );
}