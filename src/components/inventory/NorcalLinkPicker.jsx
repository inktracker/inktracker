// "Link to NorCal product" control for the inventory add/edit forms.
//
// NorCal (norcalsps.com) is a Shopify supplier whose catalog we pull via the
// norcalCatalog edge function. Linking a supply to a NorCal variant stamps the
// variant id + live price + image + product URL onto the item, which lets the
// Shopping List show NorCal pricing and (Slice 2) build a one-click pre-filled
// NorCal cart from the shop's low-stock list.
//
// Props:
//   value    — the current link, or null. Shape: the same fields we persist
//              ({ supplier_variant_id, supplier_title, supplier_size, supplier_price,
//                 supplier_image_url, supplier_product_url }).
//   onLink   — (linkFields) => void. Called with the persist-shaped object when
//              the user picks a variant.
//   onUnlink — () => void. Clears the link.

import { useEffect, useRef, useState } from "react";
import { Search, X, Loader2, Link2, ExternalLink } from "lucide-react";
import { base44 } from "@/api/supabaseClient";
import { notify } from "@/lib/notify";

// Map a norcalCatalog result row to the fields we persist on the inventory item.
function toLinkFields(v) {
  return {
    supplier_variant_id: String(v.variantId),
    supplier_title: v.title || "",
    supplier_size: v.size || "",
    supplier_price: Number(v.price) || 0,
    supplier_image_url: v.image || "",
    supplier_product_url: v.url || "",
  };
}

const fmtPrice = (n) =>
  Number.isFinite(Number(n)) ? `$${Number(n).toFixed(2)}` : "";

export default function NorcalLinkPicker({ value, onLink, onUnlink }) {
  const linked = value && value.supplier_variant_id;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const reqSeq = useRef(0);

  // Debounced catalog search. A monotonically increasing sequence guards
  // against out-of-order responses clobbering a newer query's results.
  useEffect(() => {
    const q = query.trim();
    if (!open) return undefined;
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const seq = ++reqSeq.current;
    const t = setTimeout(async () => {
      try {
        const { data, error } = await base44.functions.invoke("norcalCatalog", {
          query: q,
          limit: 8,
        });
        if (seq !== reqSeq.current) return; // a newer query superseded this one
        if (error) throw error;
        setResults(Array.isArray(data?.products) ? data.products : []);
      } catch (err) {
        if (seq === reqSeq.current) {
          setResults([]);
          notify.error("Couldn't search NorCal", err);
        }
      } finally {
        if (seq === reqSeq.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query, open]);

  function pick(v) {
    onLink?.(toLinkFields(v));
    setOpen(false);
    setQuery("");
    setResults([]);
  }

  if (linked) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2">
        {value.supplier_image_url ? (
          <img
            src={value.supplier_image_url}
            alt=""
            className="w-10 h-10 rounded object-contain bg-white border border-rose-100 flex-shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded bg-white border border-rose-100 flex items-center justify-center flex-shrink-0">
            <Link2 className="w-4 h-4 text-rose-400" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold text-rose-600 uppercase tracking-wide flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> Linked to NorCal
          </div>
          <div className="text-sm font-semibold text-slate-800 truncate">
            {value.supplier_title}
            {value.supplier_size ? <span className="text-slate-500 font-normal"> · {value.supplier_size}</span> : null}
          </div>
          <div className="text-xs text-slate-500">
            {fmtPrice(value.supplier_price)}
            {value.supplier_product_url ? (
              <a
                href={value.supplier_product_url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 inline-flex items-center gap-0.5 text-rose-600 hover:text-rose-700 font-semibold"
              >
                View <ExternalLink className="w-3 h-3" />
              </a>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onUnlink?.()}
          className="text-xs font-semibold text-slate-500 hover:text-red-500 px-2 py-1 rounded flex-shrink-0"
        >
          Unlink
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-rose-600 hover:text-rose-700 border border-rose-200 hover:border-rose-300 bg-rose-50/50 rounded-lg px-3 py-2 transition"
      >
        <Link2 className="w-4 h-4" /> Link to NorCal
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
        <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search NorCal products…"
          className="flex-1 text-sm bg-transparent focus:outline-none"
        />
        {loading && <Loader2 className="w-4 h-4 text-slate-400 animate-spin flex-shrink-0" />}
        <button
          type="button"
          onClick={() => { setOpen(false); setQuery(""); setResults([]); }}
          className="text-slate-400 hover:text-slate-600 flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {query.trim().length < 2 ? (
          <div className="px-3 py-4 text-xs text-slate-400">Type at least 2 characters to search NorCal.</div>
        ) : (!loading && results.length === 0) ? (
          <div className="px-3 py-4 text-xs text-slate-400">No NorCal products match “{query.trim()}”.</div>
        ) : (
          results.map((v) => (
            <button
              type="button"
              key={v.variantId}
              onClick={() => pick(v)}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-rose-50/60 text-left transition"
            >
              {v.image ? (
                <img src={v.image} alt="" className="w-9 h-9 rounded object-contain bg-white border border-slate-100 flex-shrink-0" />
              ) : (
                <div className="w-9 h-9 rounded bg-slate-50 border border-slate-100 flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-800 truncate">
                  {v.title}
                  {v.size ? <span className="text-slate-500 font-normal"> · {v.size}</span> : null}
                </div>
                <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                  <span className="font-bold text-slate-700">{fmtPrice(v.price)}</span>
                  {v.sku ? <span className="font-mono">{v.sku}</span> : null}
                  {!v.available ? <span className="text-amber-600 font-semibold">out of stock</span> : null}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
