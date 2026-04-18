import { useState } from "react";
import { base44 } from "@/api/supabaseClient";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function Setup() {
  const [shopName, setShopName] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await base44.auth.updateMe({ shop_name: shopName });
      navigate(createPageUrl("Dashboard"));
    } catch (error) {
      console.error("Setup failed:", error);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl p-8 space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Welcome to InkShop</h1>
            <p className="text-slate-500 mt-2">Let's set up your print shop</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Shop Name</label>
              <input
                type="text"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                placeholder="e.g., Custom Threads"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                required
              />
              <p className="text-xs text-slate-400 mt-1">This will appear throughout your dashboard</p>
            </div>

            <button
              type="submit"
              disabled={loading || !shopName.trim()}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold py-2.5 rounded-xl transition"
            >
              {loading ? "Setting up..." : "Get Started"}
            </button>
          </form>

          <div className="pt-4 border-t border-slate-100">
            <p className="text-xs text-slate-500 text-center">
              You'll be able to manage quotes, orders, invoices, customers, and inventory all in one place.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}