import { useState } from "react";
import { lookupStyle, SUPPLIERS } from "@/api/suppliers";
import { mergeItem } from "@/lib/purchaseOrders";
import { Search, Plus, Loader2, AlertCircle } from "lucide-react";
import { fmtMoney } from "@/components/shared/pricing";

// Inline picker on the PO detail view: shop types a style code, we call
// the supplier's lookup edge function (acLookupStyle for AS Colour),
// then they pick colour/size/qty per row and click Add. Repeats addItem
// → mergeItem so duplicate SKUs increment quantity instead of creating
// duplicate rows.
//
// Scoped to one supplier per panel because the PO is supplier-scoped.

export default function AddItemsPanel({ supplier, onAddItems }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [product, setProduct] = useState(null);

  async function search(e) {
    e?.preventDefault?.();
    const trimmed = code.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setProduct(null);
    try {
      const result = await lookupStyle(supplier, { styleNumber: trimmed, styleCode: trimmed });
      const matches = result?.matches || result?.results || result?.items || result?.products || [];
      const first = matches[0] || result?.product || result;
      if (!first || !first.variants) {
        setError("Style not found.");
        return;
      }
      setProduct(first);
    } catch (err) {
      setError(err?.message || "Lookup failed");
    } finally {
      setLoading(false);
    }
  }

  function addVariant(variant, qty) {
    if (!variant || !qty || qty <= 0) return;
    onAddItems((prev) =>
      mergeItem(prev, {
        sku: variant.sku,
        styleCode: product?.styleCode || product?.id,
        color: variant.colour || variant.color || "",
        size: variant.size || "",
        quantity: Number(qty),
        unitPrice: Number(variant.price) || 0,
        warehouse: "",
      }),
    );
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
        Add items from {supplier}
      </div>

      <form onSubmit={search} className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Style code (e.g. 5050)"
          className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2"
        />
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Look up
        </button>
      </form>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {product && (
        <ProductVariantPicker product={product} onAdd={addVariant} />
      )}
    </div>
  );
}

function ProductVariantPicker({ product, onAdd }) {
  // Group variants by colour, then list sizes within each colour.
  const variants = product.variants || [];
  const byColour = variants.reduce((acc, v) => {
    const c = v.colour || v.color || "—";
    if (!acc[c]) acc[c] = [];
    acc[c].push(v);
    return acc;
  }, {});
  const colours = Object.keys(byColour);
  const [activeColour, setActiveColour] = useState(colours[0]);
  const [qtyByVariant, setQtyByVariant] = useState({});

  function setQty(sku, qty) {
    setQtyByVariant((prev) => ({ ...prev, [sku]: qty }));
  }

  function add(variant) {
    const qty = Number(qtyByVariant[variant.sku]) || 0;
    if (qty <= 0) return;
    onAdd(variant, qty);
    setQty(variant.sku, "");
  }

  return (
    <div className="space-y-3 bg-white border border-slate-200 rounded-lg p-3">
      <div className="flex items-start gap-3">
        {product.primaryImage && (
          <img
            src={product.primaryImage}
            alt={product.title}
            className="w-16 h-16 object-cover rounded-lg border border-slate-100"
          />
        )}
        <div className="min-w-0">
          <div className="font-semibold text-sm text-slate-800">{product.title || product.styleCode}</div>
          <div className="text-xs text-slate-400 truncate">{product.styleCode} · {colours.length} colour{colours.length === 1 ? "" : "s"}</div>
        </div>
      </div>

      {/* Colour picker */}
      <div className="flex flex-wrap gap-1">
        {colours.map((c) => (
          <button
            key={c}
            onClick={() => setActiveColour(c)}
            className={`text-[11px] px-2 py-1 rounded-full border ${
              activeColour === c
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Sizes for active colour */}
      <div className="space-y-1.5">
        {(byColour[activeColour] || []).map((v) => (
          <div key={v.sku} className="flex items-center gap-2 text-sm">
            <div className="font-mono text-xs text-slate-500 w-32 truncate">{v.sku}</div>
            <div className="text-xs font-semibold text-slate-700 w-12">{v.size}</div>
            <div className="text-xs text-slate-400 w-16 text-right">{fmtMoney(v.price || 0)}</div>
            <input
              type="number"
              min="0"
              value={qtyByVariant[v.sku] ?? ""}
              onChange={(e) => setQty(v.sku, e.target.value)}
              placeholder="Qty"
              className="w-20 text-right border border-slate-200 rounded px-2 py-1 text-sm"
            />
            <button
              onClick={() => add(v)}
              disabled={!Number(qtyByVariant[v.sku])}
              className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 disabled:text-slate-300 px-2 py-1"
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
