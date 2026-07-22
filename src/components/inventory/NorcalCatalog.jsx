// Browse NorCal's catalog inside InkTracker and pull products into your stock.
//
// NorCal Screen Print Supply (norcalsps.com) is a Shopify supplier whose public
// catalog we serve through the norcalCatalog edge function. This is the "Browse
// NorCal" view: category tabs + search over their real catalog, product cards
// with photo / price / stock, and an "Add to my inventory" action per product
// that creates a stocked item already linked to that NorCal variant.
//
// Props:
//   onAdd            — async (product) => void. Creates the inventory item.
//   addedVariantIds  — Set<string> of norcal_variant_id already in the shop's
//                      inventory, so already-added products show as stocked.
//   readOnly, reason — billing read-only gate.

import { useEffect, useRef, useState } from "react";
import { Search, Loader2, Check, Plus, ExternalLink, PackageSearch } from "lucide-react";
import { base44 } from "@/api/supabaseClient";
import { notify } from "@/lib/notify";

// Mirrors NorCal's own store navigation (kept in sync with NORCAL_CATEGORIES
// in supabase/functions/_shared/norcal.ts).
const CATEGORIES = ["All", "Inks", "Screens", "Chemicals", "Equipment", "Squeegees", "Tape", "Supplies"];

const fmtPrice = (n) => (Number.isFinite(Number(n)) ? `$${Number(n).toFixed(2)}` : "");

export default function NorcalCatalog({ onAdd, addedVariantIds, readOnly = false, reason = "" }) {
  const [category, setCategory] = useState("All");
  const [subcategory, setSubcategory] = useState("All");
  const [subcats, setSubcats] = useState([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [addingId, setAddingId] = useState(null);
  const reqSeq = useRef(0);

  // Selecting a top category resets the sub-tab back to "All".
  function selectCategory(c) {
    setCategory(c);
    setSubcategory("All");
  }

  // Fetch on category / subcategory / query change. Query is debounced; the
  // rest fetch immediately. A sequence guard drops out-of-order responses.
  useEffect(() => {
    const q = query.trim();
    setLoading(true);
    const seq = ++reqSeq.current;
    const t = setTimeout(async () => {
      try {
        const { data, error } = await base44.functions.invoke("norcalCatalog", {
          category: category === "All" ? "" : category,
          subcategory: subcategory === "All" ? "" : subcategory,
          query: q,
          limit: 60,
        });
        if (seq !== reqSeq.current) return;
        if (error) throw error;
        setResults(Array.isArray(data?.products) ? data.products : []);
        setTotal(Number(data?.total) || 0);
        setSubcats(Array.isArray(data?.subcategories) ? data.subcategories : []);
      } catch (err) {
        if (seq === reqSeq.current) {
          setResults([]);
          setTotal(0);
          notify.error("Couldn't load NorCal catalog", err);
        }
      } finally {
        if (seq === reqSeq.current) setLoading(false);
      }
    }, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [category, subcategory, query]);

  async function add(product) {
    if (readOnly || addingId) return;
    setAddingId(product.variantId);
    try {
      await onAdd?.(product);
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header + connected state */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PackageSearch className="w-5 h-5 text-rose-500" />
          <div>
            <div className="text-sm font-bold text-slate-900">Browse NorCal Catalog</div>
            <div className="text-xs text-slate-500">{total} products · add any to your stock</div>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-full px-3 py-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> NorCal connected
        </span>
      </div>

      {/* Search + category tabs */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search NorCal products, SKUs, brands…"
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-rose-300"
          />
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => selectCategory(c)}
            className={`text-xs font-semibold px-3 py-2 rounded-xl border transition ${
              category === c
                ? "bg-rose-600 text-white border-rose-600"
                : "bg-white border-slate-200 text-slate-500 hover:border-rose-300"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Sub-tabs — the real NorCal product_types within the selected category
          (e.g. Inks → Plastisol / Waterbase / Discharge). Only shown when the
          bucket actually splits into more than one type. */}
      {category !== "All" && subcats.length > 1 && (
        <div className="flex gap-2 flex-wrap pl-1 border-l-2 border-rose-100">
          {[{ type: "All", count: total }, ...subcats].map((s) => (
            <button
              key={s.type}
              onClick={() => setSubcategory(s.type)}
              className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition ${
                subcategory === s.type
                  ? "bg-rose-100 text-rose-700 border-rose-300"
                  : "bg-white border-slate-200 text-slate-500 hover:border-rose-300"
              }`}
            >
              {s.type}
              {s.type !== "All" ? <span className="ml-1 text-slate-400">{s.count}</span> : null}
            </button>
          ))}
        </div>
      )}

      {/* Product grid */}
      {loading ? (
        <div className="py-16 flex items-center justify-center text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : results.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-500">
          No NorCal products match your search.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {results.map((p) => {
            const added = addedVariantIds?.has(String(p.variantId));
            const isAdding = addingId === p.variantId;
            return (
              <div key={p.variantId} className="border border-slate-200 rounded-2xl bg-white p-3 flex gap-3">
                {p.image ? (
                  <img src={p.image} alt="" className="w-16 h-16 rounded-lg object-contain bg-slate-50 border border-slate-100 flex-shrink-0" />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-slate-50 border border-slate-100 flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1 flex flex-col">
                  <div className="text-sm font-semibold text-slate-900 leading-snug line-clamp-2">
                    {p.title}
                    {p.size ? <span className="text-slate-500 font-normal"> · {p.size}</span> : null}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-slate-700 text-xs">{fmtPrice(p.price)}</span>
                    {p.vendor ? <span>{p.vendor}</span> : null}
                    {!p.available ? <span className="text-amber-600 font-semibold">out of stock</span> : null}
                  </div>
                  <div className="mt-auto pt-2 flex items-center gap-2">
                    {added ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                        <Check className="w-3.5 h-3.5" /> In your stock
                      </span>
                    ) : (
                      <button
                        onClick={() => add(p)}
                        disabled={readOnly || isAdding}
                        title={readOnly ? reason : undefined}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg px-2.5 py-1.5 transition"
                      >
                        {isAdding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                        Add to inventory
                      </button>
                    )}
                    {p.url ? (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-xs font-semibold text-slate-400 hover:text-rose-600"
                        title="View on NorCal"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
