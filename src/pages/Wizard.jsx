import { useEffect, useState } from "react";
import { base44 } from "@/api/supabaseClient";
import OrderWizard from "../components/wizard/OrderWizard";

export default function Wizard() {
  const [styles, setStyles] = useState(null);
  const [setups, setSetups] = useState(null);

  const [shopOwner, setShopOwner] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const me = await base44.auth.me();
        if (!me?.email) return;
        setShopOwner(me.email);
        const shops = await base44.entities.Shop.filter({ owner_email: me.email });
        const shop = shops?.[0];
        if (shop?.wizard_styles?.length) setStyles(shop.wizard_styles);
        if (shop?.wizard_setups?.length) setSetups(shop.wizard_setups);
      } catch {
        // Fall back to defaults
      }
    }
    load();
  }, []);

  async function handleSubmit(quote) {
    await base44.entities.Quote.create(quote);
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