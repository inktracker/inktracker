import { useState, useEffect } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { Search, X } from "lucide-react";
import { createPageUrl } from "@/utils";
import ModalBackdrop from "./shared/ModalBackdrop";
import { getDisplayName } from "./shared/pricing";
import { resolveJobLabel } from "@/lib/calendar/resolveJobLabel";

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState({ customers: [], orders: [], quotes: [], invoices: [], inventory: [] });
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    async function getUser() {
      try {
        const currentUser = await base44.auth.me();
        setUser(currentUser);
      } catch {
        // Not authenticated, skip search
        setUser(null);
      }
    }
    getUser();
  }, []);

  useEffect(() => {
    if (!query.trim() || !user) {
      setResults({ customers: [], orders: [], quotes: [], invoices: [], inventory: [] });
      return;
    }

    const searchEntities = async () => {
      setLoading(true);

      // Server-side ilike with a hard limit per table. The old version pulled
      // the ENTIRE tenant (every quote/order/invoice ever) into the browser
      // per keystroke-batch to find 5 matches — linear cost in shop history.
      // No shop_owner filter on purpose: RLS scopes results to what the
      // caller can see, which also fixes managers/brokers (filtering on
      // user.email returned nothing for them — their rows key to the OWNER).
      //
      // Characters with meaning in PostgREST or() / LIKE syntax are dropped
      // from the search term, not escaped — search UX is unaffected and the
      // filter string can't be broken out of.
      const term = query.replace(/[,()"'\\%_]/g, " ").trim();
      if (!term) { setLoading(false); return; }
      const pat = `*${term}*`;

      const grab = (table, orClause, sort) =>
        supabase.from(table).select("*").or(orClause).order(sort, { ascending: true }).limit(5)
          .then(({ data, error }) => {
            if (error) { console.error(`[GlobalSearch] ${table}:`, error.message); return []; }
            return data || [];
          });

      try {
        const [customers, orders, quotes, invoices, inventory] = await Promise.all([
          grab("customers",       `name.ilike.${pat},company.ilike.${pat},email.ilike.${pat}`, "name"),
          grab("orders",          `customer_name.ilike.${pat},order_id.ilike.${pat}`,          "order_id"),
          grab("quotes",          `customer_name.ilike.${pat},quote_id.ilike.${pat}`,          "quote_id"),
          grab("invoices",        `customer_name.ilike.${pat},invoice_id.ilike.${pat}`,        "invoice_id"),
          grab("inventory_items", `item.ilike.${pat},sku.ilike.${pat}`,                        "item"),
        ]);

        setResults({
          customers: customers
            .sort((a, b) => ((a.company || a.name) || "").localeCompare((b.company || b.name) || "", undefined, { sensitivity: 'base' })),
          orders,
          quotes,
          invoices,
          inventory,
        });
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(searchEntities, 300);
    return () => clearTimeout(timer);
  }, [query, user]);

  const hasResults = Object.values(results).some(arr => arr.length > 0);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="hidden md:flex items-center gap-2 px-3 py-2 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500"
      >
        <Search className="w-4 h-4" />
        <span>Search</span>
      </button>

      {open && (
        <ModalBackdrop onClose={() => setOpen(false)} z="z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mt-4 max-h-[90vh] overflow-y-auto">
            {/* Search Input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
              <Search className="w-5 h-5 text-slate-500" />
              <input
                autoFocus
                type="text"
                placeholder="Search customers, orders, quotes, invoices, inventory..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="flex-1 outline-none text-slate-700"
              />
              <button onClick={() => { setOpen(false); setQuery(""); }} aria-label="Close search" className="text-slate-500 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Results */}
            <div className="max-h-96 overflow-y-auto">
              {loading && <div className="px-4 py-8 text-center text-slate-500">Searching...</div>}
              {!loading && !hasResults && query && <div className="px-4 py-8 text-center text-slate-500">No results found</div>}

              {!loading && hasResults && (
                <div className="divide-y divide-slate-100">
                  {results.customers.length > 0 && (
                    <div className="p-4">
                      <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Customers</div>
                      {results.customers.map(c => (
                        <a key={c.id} href={createPageUrl("Customers")} onClick={() => setOpen(false)} className="block px-3 py-2 rounded hover:bg-slate-50 text-sm">
                          <div className="font-semibold text-slate-900">{getDisplayName(c)}</div>
                          <div className="text-xs text-slate-500">{c.email}</div>
                        </a>
                      ))}
                    </div>
                  )}

                  {results.orders.length > 0 && (
                    <div className="p-4">
                      <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Orders</div>
                      {results.orders.map(o => (
                        <a key={o.id} href={createPageUrl("Orders")} onClick={() => setOpen(false)} className="block px-3 py-2 rounded hover:bg-slate-50 text-sm">
                          <div className="font-semibold text-slate-900">{o.order_id}</div>
                          <div className="text-xs text-slate-500">{resolveJobLabel(o)}</div>
                        </a>
                      ))}
                    </div>
                  )}

                  {results.quotes.length > 0 && (
                    <div className="p-4">
                      <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Quotes</div>
                      {results.quotes.map(q => (
                        <a key={q.id} href={createPageUrl("Quotes")} onClick={() => setOpen(false)} className="block px-3 py-2 rounded hover:bg-slate-50 text-sm">
                          <div className="font-semibold text-slate-900">{q.quote_id}</div>
                          <div className="text-xs text-slate-500">{resolveJobLabel(q)}</div>
                        </a>
                      ))}
                    </div>
                  )}

                  {results.invoices.length > 0 && (
                    <div className="p-4">
                      <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Invoices</div>
                      {results.invoices.map(i => (
                        <a key={i.id} href={createPageUrl("Invoices")} onClick={() => setOpen(false)} className="block px-3 py-2 rounded hover:bg-slate-50 text-sm">
                          <div className="font-semibold text-slate-900">{i.invoice_id}</div>
                          <div className="text-xs text-slate-500">{i.customer_name}</div>
                        </a>
                      ))}
                    </div>
                  )}

                  {results.inventory.length > 0 && (
                    <div className="p-4">
                      <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Inventory</div>
                      {results.inventory.map(it => (
                        <a key={it.id} href={createPageUrl("Inventory")} onClick={() => setOpen(false)} className="block px-3 py-2 rounded hover:bg-slate-50 text-sm">
                          <div className="font-semibold text-slate-900">{it.item}</div>
                          <div className="text-xs text-slate-500">SKU: {it.sku}</div>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </ModalBackdrop>
      )}
    </>
  );
}