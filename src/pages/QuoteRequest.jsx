import { useState, useEffect } from "react";
import { base44 } from "@/api/supabaseClient";
import OrderWizard from "../components/wizard/OrderWizard";
import { fmtMoney, calcQuoteTotals } from "../components/shared/pricing";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

// ─── Client Review Mode ──────────────────────────────────────────────────────
// Shown when the URL has ?quoteId=...&clientReview=true
// Lets the customer see the quote summary and approve it.

function ClientReviewPage({ quoteId }) {
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    base44.entities.Quote.get(quoteId)
      .then((q) => {
        setQuote(q);
        if (q?.status === "Approved" || q?.status === "Approved and Paid" || q?.status === "Client Approved") {
          setApproved(true);
        }
      })
      .catch(() => setError("Quote not found or has expired."))
      .finally(() => setLoading(false));
  }, [quoteId]);

  async function handleApprove() {
    setApproving(true);
    try {
      await base44.entities.Quote.update(quoteId, {
        status: "Client Approved",
        client_approved_at: new Date().toISOString(),
      });
      setApproved(true);
    } catch {
      setError("Something went wrong. Please try again or contact your shop.");
    } finally {
      setApproving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl border border-red-200 p-8 max-w-md w-full text-center shadow-sm">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-800 mb-2">Quote Not Found</h2>
          <p className="text-slate-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (approved) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl border border-emerald-200 p-8 max-w-md w-full text-center shadow-sm">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-800 mb-2">Quote Approved!</h2>
          <p className="text-slate-500 text-sm">
            Thank you, {quote?.customer_name}. Your approval has been recorded and the shop has been notified.
          </p>
        </div>
      </div>
    );
  }

  const totals = calcQuoteTotals(quote || {});
  const lineItems = quote?.line_items || [];

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900">Review Your Quote</h1>
          <p className="text-slate-500 mt-1 text-sm">
            Quote #{quote?.quote_id} · {quote?.customer_name}
          </p>
        </div>

        {/* Line items summary */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Items</div>
          </div>
          {lineItems.length === 0 ? (
            <div className="px-5 py-6 text-sm text-slate-400">No line items.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {lineItems.map((li, idx) => {
                const qty = Object.values(li.sizes || {}).reduce((s, v) => s + (parseInt(v) || 0), 0);
                return (
                  <div key={idx} className="px-5 py-4 flex items-start justify-between gap-4">
                    <div>
                      <div className="font-semibold text-slate-800 text-sm">
                        {li.brand ? `${li.brand} ` : ""}{li.style || "Item"}{li.garmentColor ? ` — ${li.garmentColor}` : ""}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Qty: {qty}
                        {li.imprints?.length > 0 && (
                          <span className="ml-2">
                            · {li.imprints.map((imp) => `${imp.location} (${imp.colors}c ${imp.technique || "Screen Print"})`).join(", ")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Totals */}
        <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4 space-y-2.5">
          <div className="flex justify-between text-sm text-slate-600">
            <span>Subtotal</span><span>{fmtMoney(totals.sub)}</span>
          </div>
          {parseFloat(quote?.discount) > 0 && (
            <div className="flex justify-between text-sm text-emerald-600">
              <span>Discount ({quote.discount}%)</span>
              <span>−{fmtMoney(totals.sub - totals.afterDisc)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm text-slate-600">
            <span>Tax ({quote?.tax_rate || 0}%)</span><span>{fmtMoney(totals.tax)}</span>
          </div>
          <div className="flex justify-between font-bold text-slate-900 border-t border-slate-100 pt-2.5">
            <span>Total</span><span className="text-xl text-indigo-700">{fmtMoney(totals.total)}</span>
          </div>
        </div>

        {quote?.notes && (
          <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1.5">Notes</div>
            <p className="text-sm text-slate-700 leading-relaxed">{quote.notes}</p>
          </div>
        )}

        {/* Approve button */}
        <button
          onClick={handleApprove}
          disabled={approving}
          className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-4 rounded-2xl text-base transition disabled:opacity-60"
        >
          {approving ? (
            <><Loader2 className="w-5 h-5 animate-spin" /> Approving…</>
          ) : (
            <><CheckCircle2 className="w-5 h-5" /> Approve This Quote</>
          )}
        </button>

        <p className="text-center text-xs text-slate-400">
          By approving, you confirm the details above and authorize the shop to proceed with your order.
        </p>
      </div>
    </div>
  );
}

// ─── Default: New Quote Request ──────────────────────────────────────────────
export default function QuoteRequest() {
  const params = new URLSearchParams(window.location.search);
  const quoteId = params.get("quoteId");
  const clientReview = params.get("clientReview") === "true";
  const shopParam = params.get("shop") || "";

  const [shop, setShop] = useState(null);
  const [wizardStyles, setWizardStyles] = useState(null);
  const [wizardSetups, setWizardSetups] = useState(null);
  const [shopOwner, setShopOwner] = useState(shopParam);

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
          if (s.wizard_setups?.length) setWizardSetups(s.wizard_setups);
        }
      } catch {}
    }
    loadShop();
  }, [shopParam]);

  if (clientReview && quoteId) {
    return <ClientReviewPage quoteId={quoteId} />;
  }

  async function handleSubmit(quote) {
    await base44.entities.Quote.create({ ...quote, shop_owner: shopOwner });
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="text-center mb-8">
          {shop?.logo_url && (
            <img src={shop.logo_url} alt="" className="w-16 h-16 rounded-full mx-auto mb-4 border border-slate-200" />
          )}
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            {shop?.shop_name ? `${shop.shop_name} — Request a Quote` : "Request a Quote"}
          </h1>
          <p className="text-slate-500">Fill out the form below and we'll get back to you within 1 business day.</p>
        </div>
        <OrderWizard
          onSubmit={handleSubmit}
          styles={wizardStyles}
          setups={wizardSetups}
          shopOwner={shopOwner}
        />
        <div className="text-center mt-10 text-xs text-slate-400">
          Questions? Call or text us at your shop phone number.
        </div>
      </div>
    </div>
  );
}
