import { useState, useEffect } from "react";
import { base44 } from "@/api/supabaseClient";
import { Search, X } from "lucide-react";
import { createPageUrl } from "@/utils";
import ModalBackdrop from "./shared/ModalBackdrop";

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
      const q = query.toLowerCase();
      const shopOwner = user.email;

      try {
        const [customers, orders, quotes, invoices, inventory] = await Promise.all([
          base44.entities.Customer.filter({ shop_owner: shopOwner }),
          base44.entities.Order.filter({ shop_owner: shopOwner }),
          base44.entities.Quote.filter({ shop_owner: shopOwner }),
          base44.entities.Invoice.filter({ shop_owner: shopOwner }),
          base44.entities.InventoryItem.list(),
        ]);

        setResults({
          customers: customers
            .filter(c => c.name?.toLowerCase().includes(q) || c.company?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q))
            .sort((a, b) => ((a.company || a.name) || "").localeCompare((b.company || b.name) || "", undefined, { sensitivity: 'base' }))
            .slice(0, 5),
          orders: orders.filter(o => o.customer_name?.toLowerCase().includes(q) || o.order_id?.toLowerCase().includes(q)).slice(0, 5),
          quotes: quotes.filter(qt => qt.customer_name?.toLowerCase().includes(q) || qt.quote_id?.toLowerCase().includes(q)).slice(0, 5),
          invoices: invoices.filter(i => i.customer_name?.toLowerCase().includes(q) || i.invoice_id?.toLowerCase().includes(q)).slice(0, 5),
          inventory: inventory
            .filter(i => i.item?.toLowerCase().includes(q) || i.sku?.toLowerCase().includes(q))
            .sort((a, b) => (a.item || "").localeCompare(b.item || "", undefined, { sensitivity: 'base' }))
            .slice(0, 5),
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
        className="hidden md:flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition text-sm text-slate-500"
      >
        <Search className="w-4 h-4" />
        <span>Search...</span>
      </button>

      {open && (
        <ModalBackdrop onClose={() => setOpen(false)} z="z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mt-4 max-h-[90vh] overflow-y-auto">
            {/* Search Input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
              <Search className="w-5 h-5 text-slate-400" />
              <input
                autoFocus
                type="text"
                placeholder="Search customers, orders, quotes, invoices, inventory..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="flex-1 outline-none text-slate-700"
              />
              <button onClick={() => { setOpen(false); setQuery(""); }} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Results */}
            <div className="max-h-96 overflow-y-auto">
              {loading && <div className="px-4 py-8 text-center text-slate-400">Searching...</div>}
              {!loading && !hasResults && query && <div className="px-4 py-8 text-center text-slate-400">No results found</div>}

              {!loading && hasResults && (
                <div className="divide-y divide-slate-100">
                  {results.customers.length > 0 && (
                    <div className="p-4">
                      <div className="text-xs font-semibold text-slate-400 uppercase mb-2">Customers</div>
                      {results.customers.map(c => (
                        <a key={c.id} href={createPageUrl("Customers")} onClick={() => setOpen(false)} className="block px-3 py-2 rounded hover:bg-slate-50 text-sm">
                          <div className="font-semibold text-slate-900">{c.company || c.name}</div>
                          <div className="text-xs text-slate-500">{c.email}</div>
                        </a>
                      ))}
                    </div>
                  )}

                  {results.orders.length > 0 && (
                    <div className="p-4">
                      <div className="text-xs font-semibold text-slate-400 uppercase mb-2">Orders</div>
                      {results.orders.map(o => (
                        <a key={o.id} href={createPageUrl("Orders")} onClick={() => setOpen(false)} className="block px-3 py-2 rounded hover:bg-slate-50 text-sm">
                          <div className="font-semibold text-slate-900">{o.order_id}</div>
                          <div className="text-xs text-slate-500">{o.customer_name}</div>
                        </a>
                      ))}
                    </div>
                  )}

                  {results.quotes.length > 0 && (
                    <div className="p-4">
                      <div className="text-xs font-semibold text-slate-400 uppercase mb-2">Quotes</div>
                      {results.quotes.map(q => (
                        <a key={q.id} href={createPageUrl("Quotes")} onClick={() => setOpen(false)} className="block px-3 py-2 rounded hover:bg-slate-50 text-sm">
                          <div className="font-semibold text-slate-900">{q.quote_id}</div>
                          <div className="text-xs text-slate-500">{q.customer_name}</div>
                        </a>
                      ))}
                    </div>
                  )}

                  {results.invoices.length > 0 && (
                    <div className="p-4">
                      <div className="text-xs font-semibold text-slate-400 uppercase mb-2">Invoices</div>
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
                      <div className="text-xs font-semibold text-slate-400 uppercase mb-2">Inventory</div>
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