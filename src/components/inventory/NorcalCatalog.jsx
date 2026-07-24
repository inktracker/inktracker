// Browse a public-Shopify supply vendor's catalog and pull products into stock.
//
// `supplier` selects the vendor ({ key, label, storeUrl, theme }); the parent
// remounts this via key={key} on switch, so all state resets cleanly. Works for
// NorCal, Ryonet, and any future public-Shopify supplier. Accent color follows
// supplier.theme (NorCal rose, Ryonet green).
//
// Props:
//   supplier         — { key, label, storeUrl, theme }
//   onAddToOrder     — (product) => void
//   orderVariantIds  — Set<string> already in the reorder cart
//   onAddToInventory / onRemoveFromInventory — stock toggle
//   addedVariantIds  — Set<string> of supplier_variant_id already stocked
//   readOnly, reason — billing read-only gate.

import { useEffect, useRef, useState } from "react";
import { Search, Loader2, Check, X, ExternalLink, PackageSearch, ShoppingCart, Archive, ChevronLeft, ChevronRight } from "lucide-react";
import { base44 } from "@/api/supabaseClient";
import { notify } from "@/lib/notify";

// Mirrors NorCal's own store navigation (kept in sync with NORCAL_CATEGORIES
// in supabase/functions/_shared/norcal.ts). No "All" — browsing every product
// at once is too much; you pick a category to start.
const CATEGORIES = ["Inks", "Screens", "Chemicals", "Equipment", "Squeegees", "Tape", "Supplies"];

// Products per page in the browse grid. The edge function paginates server-side
// (returns `total` for the whole filtered set); we flip through 30 at a time.
const PAGE_SIZE = 30;

// Per-supplier accent themes. Full literal class strings so Tailwind's content
// scanner keeps them (never build class names by interpolation).
const THEMES = {
  rose: {
    icon: "text-rose-500",
    pill: "text-rose-600 bg-rose-50 border-rose-200",
    dot: "bg-rose-500",
    ring: "focus:ring-rose-300",
    tabActive: "bg-rose-600 text-white border-rose-600",
    tabIdle: "bg-white border-slate-200 text-slate-500 hover:border-rose-300",
    subBorder: "border-rose-100",
    subActive: "bg-rose-100 text-rose-700 border-rose-300",
    subIdle: "bg-white border-slate-200 text-slate-500 hover:border-rose-300",
    text: "text-rose-600",
    btn: "bg-rose-600 hover:bg-rose-700",
    linkHover: "hover:text-rose-600",
  },
  green: {
    icon: "text-green-500",
    pill: "text-green-700 bg-green-50 border-green-200",
    dot: "bg-green-500",
    ring: "focus:ring-green-300",
    tabActive: "bg-green-600 text-white border-green-600",
    tabIdle: "bg-white border-slate-200 text-slate-500 hover:border-green-300",
    subBorder: "border-green-100",
    subActive: "bg-green-100 text-green-800 border-green-300",
    subIdle: "bg-white border-slate-200 text-slate-500 hover:border-green-300",
    text: "text-green-700",
    btn: "bg-green-600 hover:bg-green-700",
    linkHover: "hover:text-green-600",
  },
};

const fmtPrice = (n) => (Number.isFinite(Number(n)) ? `$${Number(n).toFixed(2)}` : "");

export default function NorcalCatalog({
  supplier = { key: "norcal", label: "NorCal", theme: "rose" },
  onAddToOrder, orderVariantIds,
  onAddToInventory, onRemoveFromInventory, addedVariantIds,
  readOnly = false, reason = "",
}) {
  const th = THEMES[supplier.theme] || THEMES.rose;

  const [category, setCategory] = useState(CATEGORIES[0]);
  const [subcategory, setSubcategory] = useState("All");
  const [subcats, setSubcats] = useState([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [addingId, setAddingId] = useState(null);
  const reqSeq = useRef(0);
  const gridTopRef = useRef(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Any filter change starts over at page 1 — landing on "page 5" of a smaller
  // result set would show an empty grid.
  function selectCategory(c) {
    setCategory(c);
    setSubcategory("All");
    setPage(1);
  }
  function selectSubcategory(t) {
    setSubcategory(t);
    setPage(1);
  }
  function onSearchChange(v) {
    setQuery(v);
    setPage(1);
  }
  // Flip pages, clamped to the valid range, and scroll the grid back into view.
  function goToPage(p) {
    const next = Math.min(Math.max(1, p), totalPages);
    if (next === page) return;
    setPage(next);
    gridTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
          supplier: supplier.key,
          category: category === "All" ? "" : category,
          subcategory: subcategory === "All" ? "" : subcategory,
          query: q,
          limit: PAGE_SIZE,
          page,
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
          notify.error(`Couldn't load ${supplier.label} catalog`, err);
        }
      } finally {
        if (seq === reqSeq.current) setLoading(false);
      }
    }, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [supplier.key, supplier.label, category, subcategory, query, page]);

  async function addToStock(product) {
    if (readOnly || addingId) return;
    setAddingId(product.variantId);
    try {
      await onAddToInventory?.(product);
    } finally {
      setAddingId(null);
    }
  }

  async function removeFromStock(product) {
    if (readOnly || addingId) return;
    setAddingId(product.variantId);
    try {
      await onRemoveFromInventory?.(product);
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header + connected state */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PackageSearch className={`w-5 h-5 ${th.icon}`} />
          <div>
            <div className="text-sm font-bold text-slate-900">Browse {supplier.label} Catalog</div>
            <div className="text-xs text-slate-500">{total} products · add any to your stock</div>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold border rounded-full px-3 py-1.5 ${th.pill}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${th.dot}`} /> {supplier.label} connected
        </span>
      </div>

      {/* Search + category tabs */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={query}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={`Search ${supplier.label} products, SKUs, brands…`}
            className={`w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 ${th.ring}`}
          />
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => selectCategory(c)}
            className={`text-xs font-semibold px-3 py-2 rounded-xl border transition ${category === c ? th.tabActive : th.tabIdle}`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Sub-tabs — the vendor's real product_types within the selected category
          (e.g. Inks → Plastisol / Waterbased / Discharge). Only shown when the
          bucket actually splits into more than one type. */}
      {category !== "All" && subcats.length > 1 && (
        <div className={`flex gap-2 flex-wrap pl-1 border-l-2 ${th.subBorder}`}>
          {[{ type: "All", count: total }, ...subcats].map((s) => (
            <button
              key={s.type}
              onClick={() => selectSubcategory(s.type)}
              className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition ${subcategory === s.type ? th.subActive : th.subIdle}`}
            >
              {s.type}
              {s.type !== "All" ? <span className="ml-1 text-slate-400">{s.count}</span> : null}
            </button>
          ))}
        </div>
      )}

      {/* Scroll anchor — page flips bring the top of the grid back into view. */}
      <div ref={gridTopRef} className="scroll-mt-4" />

      {/* Result count / page position */}
      {!loading && total > 0 && (
        <div className="text-xs text-slate-500">
          Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
        </div>
      )}

      {/* Product grid */}
      {loading ? (
        <div className="py-16 flex items-center justify-center text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : results.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-500">
          No {supplier.label} products match your search.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {results.map((p) => {
            const added = addedVariantIds?.has(String(p.variantId));
            const inOrder = orderVariantIds?.has(String(p.variantId));
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
                    {/* Primary: add to the reorder cart. */}
                    {inOrder ? (
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold ${th.text}`}>
                        <Check className="w-3.5 h-3.5" /> In order
                      </span>
                    ) : (
                      <button
                        onClick={() => onAddToOrder?.(p)}
                        disabled={readOnly}
                        title={readOnly ? reason : undefined}
                        className={`inline-flex items-center gap-1 text-xs font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed rounded-lg px-2.5 py-1.5 transition ${th.btn}`}
                      >
                        <ShoppingCart className="w-3.5 h-3.5" /> Add to order
                      </button>
                    )}
                    {/* Secondary: track it in your own inventory. When stocked,
                        this toggles — click again to remove from inventory. */}
                    {added ? (
                      <button
                        onClick={() => removeFromStock(p)}
                        disabled={readOnly || isAdding}
                        title="In your inventory — click to remove"
                        className="group/stk inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 hover:text-red-500 border border-transparent hover:border-red-200 rounded-lg px-2 py-1.5 transition disabled:opacity-50"
                      >
                        {isAdding ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <>
                            <Check className="w-3.5 h-3.5 group-hover/stk:hidden" />
                            <X className="w-3.5 h-3.5 hidden group-hover/stk:inline" />
                          </>
                        )}
                        <span className="group-hover/stk:hidden">Stocked</span>
                        <span className="hidden group-hover/stk:inline">Remove</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => addToStock(p)}
                        disabled={readOnly || isAdding}
                        title="Track in my inventory"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 rounded-lg px-2 py-1.5 transition disabled:opacity-50"
                      >
                        {isAdding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
                        Stock
                      </button>
                    )}
                    {p.url ? (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`ml-auto inline-flex items-center gap-0.5 text-xs font-semibold text-slate-400 ${th.linkHover}`}
                        title={`View on ${supplier.label}`}
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

      {/* Pagination — only when the filtered set spans more than one page. */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-1">
          <button
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Prev
          </button>
          <span className="text-xs text-slate-500 px-1 tabular-nums">Page {page} of {totalPages}</span>
          <button
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
