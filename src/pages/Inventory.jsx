import { useState, useEffect, useMemo } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { fmtMoney } from "../components/shared/pricing";
import { Loader2, RefreshCw, ShoppingBag, Check, ChevronDown, ChevronRight, Search, Plus, X, Edit3, Trash2, ShoppingCart } from "lucide-react";
import EmptyState from "../components/shared/EmptyState";

const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

const DEFAULT_CATEGORIES = ["Blanks", "Chemicals", "Ink", "Other", "Screens", "Tools"];

export default function Inventory() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ item:"", sku:"", category:"Blanks", qty:0, unit:"pcs", reorder:0, cost:0 });
  const [editing, setEditing] = useState(null);
  const [categories, setCategories] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("invCategories")) || DEFAULT_CATEGORIES;
      return [...stored].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    } catch { return DEFAULT_CATEGORIES; }
  });
  const [newCat, setNewCat] = useState("");
  const [showCatEditor, setShowCatEditor] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedProducts, setExpandedProducts] = useState(new Set());
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopifySyncing, setShopifySyncing] = useState(false);
  const [shopifyLiveQty, setShopifyLiveQty] = useState({});
  const [user, setUser] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);
  const [restockSetup, setRestockSetup] = useState(null);
  const [ssCart, setSsCart] = useState(() => {
    try { return JSON.parse(localStorage.getItem("ssCart")) || []; } catch { return []; }
  });
  const [showCart, setShowCart] = useState(false);

  function addToSsCart(items) {
    setSsCart(prev => {
      const next = [...prev, ...items];
      localStorage.setItem("ssCart", JSON.stringify(next));
      return next;
    });
  }

  function clearSsCart() {
    setSsCart([]);
    localStorage.removeItem("ssCart");
  }

  function saveCategories(cats) {
    setCategories(cats);
    localStorage.setItem("invCategories", JSON.stringify(cats));
  }

  function addCategory() {
    const trimmed = newCat.trim();
    if (!trimmed || categories.includes(trimmed)) return;
    saveCategories([...categories, trimmed].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
    setNewCat("");
  }

  function removeCategory(cat) {
    saveCategories(categories.filter(c => c !== cat));
  }

  async function fetchShopifyLive() {
    setShopifySyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/shopifySync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "syncProducts", accessToken: session.access_token }),
      });
      const data = await res.json();
      if (!data.error && data.products) {
        const qtyMap = {};
        for (const p of data.products) {
          const key = (p.title || "").toLowerCase().trim();
          const skuKey = (p.sku || "").toLowerCase().trim();
          qtyMap[key] = p.inventory_quantity || 0;
          if (skuKey) qtyMap[skuKey] = p.inventory_quantity || 0;
        }
        setShopifyLiveQty(qtyMap);

        // Ensure all Shopify products exist in DB, then overlay live quantities
        setItems(prev => {
          const existingNames = new Set(prev.map(i => (i.item || "").toLowerCase().trim()));
          const existingSkus = new Set(prev.map(i => (i.sku || "").toLowerCase().trim()));
          const toCreate = [];
          for (const p of data.products) {
            const nameKey = (p.title || "").toLowerCase().trim();
            const skuKey = (p.sku || "").toLowerCase().trim();
            if (!existingNames.has(nameKey) && (!skuKey || !existingSkus.has(skuKey))) {
              toCreate.push(p);
            }
          }
          // Create missing items in background
          if (toCreate.length > 0 && user?.email) {
            (async () => {
              for (const p of toCreate) {
                try {
                  const created = await base44.entities.InventoryItem.create({
                    item: p.title,
                    sku: p.sku || `SHOP-${p.shopify_variant_id}`,
                    category: "Shopify",
                    qty: p.inventory_quantity || 0,
                    reorder: 2,
                    cost: p.price || 0,
                    unit: "pcs",
                    shop_owner: user.email,
                  });
                  setItems(prev => [...prev, { ...created, _shopifyLive: true }].sort((a, b) =>
                    (a.item || "").localeCompare(b.item || "", undefined, { sensitivity: 'base' })));
                } catch {}
              }
            })();
          }
          // Overlay live quantities on existing items
          return prev.map(item => {
            const nameKey = (item.item || "").toLowerCase().trim();
            const skuKey = (item.sku || "").toLowerCase().trim();
            const liveQty = qtyMap[nameKey] ?? qtyMap[skuKey];
            if (liveQty !== undefined) {
              return { ...item, qty: liveQty, _shopifyLive: true };
            }
            return item;
          });
        });
      }
    } catch {}
    setShopifySyncing(false);
  }

  useEffect(() => {
    base44.entities.InventoryItem.list().then(i => {
      setItems([...i].sort((a, b) => (a.item || "").localeCompare(b.item || "", undefined, { sensitivity: 'base' })));
      setLoading(false);
    });
    base44.auth.me().then(async (u) => {
      setUser(u);
      if (u?.shopify_access_token) {
        setShopifyConnected(true);
        // Auto-fetch live Shopify data
        fetchShopifyLive();
      }
    }).catch(() => {});
    const params = new URLSearchParams(window.location.search);
    if (params.get("shopify_connected") === "1") {
      setShopifyConnected(true);
      fetchShopifyLive();
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("shopify_error")) {
      alert("Shopify connection failed: " + params.get("shopify_error"));
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  async function connectShopify() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/shopifySync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getAuthUrl", accessToken: session.access_token }),
      });
      const data = await res.json();
      if (data.authUrl) window.location.href = data.authUrl;
      else alert("Failed to get Shopify auth URL: " + (data.error || "unknown"));
    } catch (err) {
      alert("Error connecting to Shopify: " + err.message);
    }
  }

  async function updateQty(id, newQty) {
    const updated = await base44.entities.InventoryItem.update(id, { qty: parseInt(newQty) || 0 });
    setItems(prev => prev.map(i => i.id === id ? updated : i));
  }

  async function handleAdd() {
    if (!form.item.trim() || !form.sku.trim()) return;
    const created = await base44.entities.InventoryItem.create({ ...form, shop_owner: user?.email });
    setItems(prev => [...prev, created].sort((a, b) => (a.item || "").localeCompare(b.item || "", undefined, { sensitivity: 'base' })));
    setForm({ item:"", sku:"", category:"Blanks", qty:0, unit:"pcs", reorder:0, cost:0 });
    setShowForm(false);
  }

  async function handleEdit() {
    if (!editing.item.trim() || !editing.sku.trim()) return;
    setSaveStatus("saving");
    try {
      const { variantName, ...payload } = editing;
      const updated = await base44.entities.InventoryItem.update(editing.id, payload);
      setItems(prev => prev.map(i => i.id === editing.id ? updated : i));
      setSaveStatus("saved");
      setTimeout(() => { setSaveStatus(null); setEditing(null); }, 1000);
    } catch (err) {
      console.error("Save failed:", err);
      setSaveStatus(null);
      alert("Save failed: " + (err.message || "Unknown error"));
    }
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this item?")) return;
    await base44.entities.InventoryItem.delete(id);
    setItems(prev => prev.filter(i => i.id !== id));
    setEditing(null);
  }

  const hasShopify = items.some(i => i.category === "Shopify" || i._shopifyLive);
  const cats = ["All", ...categories, ...(hasShopify && !categories.includes("Shopify") ? ["Shopify"] : [])];

  const filtered = useMemo(() => {
    let result = items;
    if (filter !== "All") result = result.filter(i => i.category === filter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(i =>
        i.item?.toLowerCase().includes(q) ||
        i.sku?.toLowerCase().includes(q) ||
        i.category?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [items, filter, searchQuery]);

  // Group items by base product name (everything before " — ")
  const grouped = useMemo(() => {
    const groups = {};
    for (const item of filtered) {
      const parts = item.item?.split(" — ") || [item.item];
      const baseName = parts[0]?.trim() || "Other";
      const variant = parts.slice(1).join(" — ").trim();
      if (!groups[baseName]) {
        groups[baseName] = { baseName, items: [], totalQty: 0, totalValue: 0, hasLowStock: false };
      }
      groups[baseName].items.push({ ...item, variantName: variant || null });
      groups[baseName].totalQty += item.qty || 0;
      groups[baseName].totalValue += (item.qty || 0) * (item.cost || 0);
      if (item.qty <= item.reorder) groups[baseName].hasLowStock = true;
    }
    return Object.values(groups).sort((a, b) => a.baseName.localeCompare(b.baseName));
  }, [filtered]);

  const toggleExpand = (name) => {
    setExpandedProducts(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const low = items.filter(i => i.qty <= i.reorder);
  const totalItems = items.length;
  const totalValue = items.reduce((s, i) => s + (i.qty || 0) * (i.cost || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Inventory</h2>
          <p className="text-sm text-slate-400 mt-0.5">{totalItems} items · {fmtMoney(totalValue)} total value</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {shopifyConnected ? (
            <button onClick={fetchShopifyLive} disabled={shopifySyncing}
              className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold px-3 py-2 rounded-xl transition hover:bg-emerald-100 disabled:opacity-60">
              {shopifySyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {shopifySyncing ? "Refreshing…" : "Refresh Shopify"}
            </button>
          ) : (
            <button onClick={connectShopify}
              className="flex items-center gap-2 bg-white border border-slate-200 text-slate-600 text-sm font-semibold px-3 py-2 rounded-xl transition hover:border-green-300">
              <ShoppingBag className="w-4 h-4" /> Connect Shopify
            </button>
          )}
          <button onClick={() => setShowCatEditor(v=>!v)} className="bg-white border border-slate-200 text-slate-600 text-sm font-semibold px-3 py-2 rounded-xl transition hover:border-indigo-300">
            {showCatEditor ? <X className="w-4 h-4" /> : "Categories"}
          </button>
          <button onClick={() => setShowForm(v=>!v)} className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-3 py-2 rounded-xl transition shadow-sm">
            {showForm ? <X className="w-4 h-4" /> : <><Plus className="w-4 h-4" /> Add Item</>}
          </button>
          {ssCart.length > 0 && (
            <button onClick={() => setShowCart(true)}
              className="relative flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-3 py-2 rounded-xl transition">
              <ShoppingCart className="w-4 h-4" /> S&S Cart
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">{ssCart.length}</span>
            </button>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-slate-100 rounded-xl p-4">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Products</div>
          <div className="text-2xl font-bold text-slate-800">{grouped.length}</div>
          <div className="text-[10px] text-slate-400">{totalItems} variants</div>
        </div>
        <div className={`border rounded-xl p-4 ${low.length > 0 ? "bg-orange-50 border-orange-200" : "bg-white border-slate-100"}`}>
          <div className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${low.length > 0 ? "text-orange-500" : "text-slate-400"}`}>Low Stock</div>
          <div className={`text-2xl font-bold ${low.length > 0 ? "text-orange-600" : "text-slate-800"}`}>{low.length}</div>
          <div className={`text-[10px] ${low.length > 0 ? "text-orange-400" : "text-slate-400"}`}>need reorder</div>
        </div>
        <div className="bg-white border border-slate-100 rounded-xl p-4">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Inventory Value</div>
          <div className="text-2xl font-bold text-slate-800">{fmtMoney(totalValue)}</div>
          <div className="text-[10px] text-slate-400">at cost</div>
        </div>
      </div>


      {/* Category editor */}
      {showCatEditor && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-3">
          <div className="text-xs font-bold text-slate-600 uppercase tracking-widest">Manage Categories</div>
          <div className="flex flex-wrap gap-2">
            {categories.map(c => (
              <span key={c} className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-full px-3 py-1 text-sm font-semibold text-slate-700">
                {c}
                <button onClick={() => removeCategory(c)} className="text-slate-300 hover:text-red-400 transition text-xs leading-none">✕</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={newCat} onChange={e => setNewCat(e.target.value)} onKeyDown={e => e.key === "Enter" && addCategory()} placeholder="New category…"
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 w-56" />
            <button onClick={addCategory} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition">Add</button>
          </div>
        </div>
      )}

      {/* Add item form */}
      {showForm && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-3">
          <div className="text-xs font-bold text-slate-600 uppercase tracking-widest">New Item</div>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            {[
              { key:"item", label:"Item Name *", placeholder:"Gildan 5000 — Black" },
              { key:"sku", label:"SKU *", placeholder:"G5000-BLK" },
              { key:"unit", label:"Unit", placeholder:"pcs" },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{f.label}</label>
                <input value={form[f.key]} onChange={e => setForm({...form,[f.key]:e.target.value})} placeholder={f.placeholder}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
            ))}
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Category</label>
              <select value={form.category} onChange={e => setForm({...form,category:e.target.value})}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300">
                {categories.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            {[
              { key:"qty", label:"Qty", type:"number" },
              { key:"reorder", label:"Reorder At", type:"number" },
              { key:"cost", label:"Cost ($)", type:"number" },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{f.label}</label>
                <input type={f.type} value={form[f.key]} onChange={e => setForm({...form,[f.key]:e.target.value})}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
            ))}
          </div>
          <button onClick={handleAdd} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition">Add Item</button>
        </div>
      )}

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search products, SKUs…"
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {cats.map(c => (
            <button key={c} onClick={() => setFilter(c)}
              className={`text-xs font-semibold px-3 py-2 rounded-xl border transition ${filter===c ? "bg-indigo-600 text-white border-indigo-600" : "bg-white border-slate-200 text-slate-500 hover:border-indigo-300"}`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Product list */}
      <div className="space-y-2">
        {loading && (
          <div className="bg-white rounded-2xl border border-slate-100 px-6 py-12 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-slate-300 mx-auto" />
          </div>
        )}

        {!loading && items.length === 0 && (
          <EmptyState type="inventory" onAction={() => { setForm({ item:"", sku:"", category:"Blanks", qty:0, unit:"pcs", reorder:0, cost:0 }); setShowForm(true); }} />
        )}

        {grouped.map(group => {
          const isExpanded = expandedProducts.has(group.baseName);
          const hasVariants = group.items.length > 1 || group.items[0]?.variantName;
          const firstItem = group.items[0];

          return (
            <div key={group.baseName} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              {/* Product header row */}
              <div
                className={`flex items-center gap-4 px-5 py-4 cursor-pointer transition hover:bg-slate-50 ${group.hasLowStock ? "border-l-4 border-l-orange-400" : ""}`}
                onClick={() => hasVariants && toggleExpand(group.baseName)}
              >
                {/* Expand toggle */}
                <div className="w-5 flex-shrink-0">
                  {hasVariants ? (
                    isExpanded ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />
                  ) : <div className="w-5" />}
                </div>

                {/* Product info */}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800">{group.baseName}</div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
                    <span>{firstItem.category}</span>
                    {firstItem._shopifyLive && <span className="text-emerald-500 font-semibold">Live</span>}
                    {hasVariants && <span>{group.items.length} variant{group.items.length !== 1 ? "s" : ""}</span>}
                    {!hasVariants && <span className="font-mono">{firstItem.sku}</span>}
                  </div>
                </div>

                {/* Stock summary */}
                <div className="text-right flex-shrink-0">
                  <div className="font-bold text-slate-800">{group.totalQty} <span className="text-xs font-normal text-slate-400">{firstItem.unit || "pcs"}</span></div>
                  <div className="text-xs text-slate-400">{fmtMoney(group.totalValue)}</div>
                </div>

                {/* Status badge */}
                <div className="flex-shrink-0 w-20 text-right">
                  {group.hasLowStock
                    ? <span className="text-xs font-semibold text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">Low</span>
                    : <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">In Stock</span>
                  }
                </div>

                {/* Actions */}
                <div className="flex-shrink-0 flex items-center gap-1">
                  <button onClick={(e) => { e.stopPropagation(); setRestockSetup(group); }}
                    className="p-1.5 text-slate-300 hover:text-orange-500 transition" title="Setup Restock">
                    <ShoppingCart className="w-4 h-4" />
                  </button>
                  {!hasVariants && (
                    <button onClick={(e) => { e.stopPropagation(); setEditing({...firstItem}); }}
                      className="p-1.5 text-slate-300 hover:text-slate-600 transition" title="Edit">
                      <Edit3 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded variants */}
              {isExpanded && hasVariants && (
                <div className="border-t border-slate-100 bg-slate-50/50">
                  {/* Variant header */}
                  <div className="grid grid-cols-12 gap-2 px-5 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">
                    <div className="col-span-4">Variant</div>
                    <div className="col-span-2">SKU</div>
                    <div className="col-span-2 text-center">In Stock</div>
                    <div className="col-span-1 text-center">Reorder</div>
                    <div className="col-span-1 text-right">Cost</div>
                    <div className="col-span-1 text-center">Status</div>
                    <div className="col-span-1"></div>
                  </div>
                  {group.items.map(item => (
                    <div key={item.id}
                      className={`grid grid-cols-12 gap-2 items-center px-5 py-3 border-b border-slate-50 last:border-b-0 transition ${item.qty <= item.reorder ? "bg-orange-50/50" : "hover:bg-white"}`}>
                      <div className="col-span-4 text-sm font-medium text-slate-700 truncate">
                        {item.variantName || item.item}
                      </div>
                      <div className="col-span-2 font-mono text-xs text-slate-400 truncate">{item.sku}</div>
                      <div className="col-span-2 flex justify-center">
                        <input type="number" min="0" defaultValue={item.qty}
                          onBlur={e => updateQty(item.id, e.target.value)}
                          className="w-16 text-center font-bold text-slate-800 border border-slate-200 rounded-lg py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                      </div>
                      <div className="col-span-1 text-center text-xs text-slate-500">{item.reorder}</div>
                      <div className="col-span-1 text-right text-sm text-slate-600">{fmtMoney(item.cost)}</div>
                      <div className="col-span-1 text-center">
                        {item.qty <= item.reorder
                          ? <span className="inline-block w-2 h-2 rounded-full bg-orange-400" title="Low stock" />
                          : <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" title="In stock" />
                        }
                      </div>
                      <div className="col-span-1 text-right">
                        <button onClick={() => setEditing({...item})}
                          className="p-1 text-slate-300 hover:text-slate-600 transition">
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Restock modal */}
      {restockSetup && (
        <RestockModal
          group={restockSetup}
          supabaseFuncUrl={SUPABASE_FUNC_URL}
          onAddToCart={addToSsCart}
          onSave={async (updates) => {
            for (const { id, ...fields } of updates) {
              const { variantName, _shopifyLive, ...payload } = fields;
              const updated = await base44.entities.InventoryItem.update(id, payload);
              setItems(prev => prev.map(i => i.id === id ? updated : i));
            }
            setRestockSetup(null);
          }}
          onClose={() => setRestockSetup(null)}
        />
      )}

      {/* S&S Cart modal */}
      {showCart && (
        <SsCartModal
          cart={ssCart}
          onRemove={(idx) => setSsCart(prev => { const next = prev.filter((_, i) => i !== idx); localStorage.setItem("ssCart", JSON.stringify(next)); return next; })}
          onClear={clearSsCart}
          onClose={() => setShowCart(false)}
          supabaseFuncUrl={SUPABASE_FUNC_URL}
          user={user}
        />
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4" onMouseDown={e => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-slate-900">Edit Item</h3>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid gap-3 grid-cols-2">
              {[
                { key:"item", label:"Item Name *", placeholder:"Gildan 5000 — Black" },
                { key:"sku", label:"SKU *", placeholder:"G5000-BLK" },
                { key:"unit", label:"Unit", placeholder:"pcs" },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{f.label}</label>
                  <input value={editing[f.key] || ""} onChange={e => setEditing({...editing,[f.key]:e.target.value})} placeholder={f.placeholder}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
              ))}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Category</label>
                <select value={editing.category} onChange={e => setEditing({...editing,category:e.target.value})}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                  {categories.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              {[
                { key:"qty", label:"Qty" },
                { key:"reorder", label:"Reorder At" },
                { key:"cost", label:"Cost ($)" },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{f.label}</label>
                  <input type="number" value={editing[f.key] || 0} onChange={e => setEditing({...editing,[f.key]:e.target.value})}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={handleEdit} disabled={saveStatus === "saving" || saveStatus === "saved"}
                className={`flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl transition ${saveStatus === "saved" ? "bg-emerald-600 text-white" : "bg-indigo-600 hover:bg-indigo-700 text-white"} disabled:opacity-80`}>
                {saveStatus === "saving" && <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>}
                {saveStatus === "saved" && <><Check className="w-4 h-4" /> Saved</>}
                {!saveStatus && "Save Changes"}
              </button>
              <button onClick={() => handleDelete(editing.id)} className="flex items-center gap-1.5 text-red-400 border border-red-200 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-red-50 transition ml-auto">
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RestockModal({ group, supabaseFuncUrl, onSave, onClose, onAddToCart }) {
  const firstItem = group.items[0];
  const [styleNumber, setStyleNumber] = useState(firstItem?.ss_style_number || "");
  const [ssColor, setSsColor] = useState(firstItem?.ss_color || "");
  const DEFAULT_TARGET = 10;
  const [targets, setTargets] = useState(() => {
    const t = {};
    group.items.forEach(item => {
      const size = (item.variantName || "").toUpperCase();
      t[item.id] = item.restock_to || (size.includes("2XL") || size.includes("3XL") || size.includes("4XL") ? 2 : DEFAULT_TARGET);
    });
    return t;
  });
  const [ssColors, setSsColors] = useState([]);
  const [ssLoading, setSsLoading] = useState(false);
  const [ssLabel, setSsLabel] = useState("");
  const [ssError, setSsError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [ordering, setOrdering] = useState(false);

  const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
  const sortedItems = [...group.items].sort((a, b) => {
    const ia = SIZE_ORDER.indexOf((a.variantName || "").toUpperCase());
    const ib = SIZE_ORDER.indexOf((b.variantName || "").toUpperCase());
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return (a.variantName || "").localeCompare(b.variantName || "");
  });

  async function lookupStyle() {
    if (!styleNumber.trim()) return;
    setSsLoading(true);
    setSsError("");
    setSsColors([]);
    setSsLabel("");
    try {
      const res = await fetch(`${supabaseFuncUrl}/functions/v1/ssLookupStyle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ styleNumber: styleNumber.trim() }),
      });
      const data = await res.json();
      const matches = data.matches || [];
      if (!matches.length) { setSsError("Style not found"); return; }
      const product = matches[0];
      setSsLabel(`${product.brandName || ""} ${product.styleNumber || styleNumber}`.trim());
      const colorsArr = product.colors || [];
      const names = colorsArr.map(c => c.colorName).filter(Boolean).sort();
      setSsColors(names);
      if (names.length && !ssColor) setSsColor(names[0]);
    } catch (err) {
      setSsError("Lookup failed: " + err.message);
    } finally {
      setSsLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updates = group.items.map(item => ({
        id: item.id,
        ...item,
        ss_style_number: styleNumber.trim(),
        ss_color: ssColor,
        restock_to: targets[item.id] || DEFAULT_TARGET,
      }));
      await onSave(updates);
      setSaved(true);
      setTimeout(() => onClose(), 800);
    } catch (err) {
      alert("Save failed: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col" onMouseDown={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900">{group.baseName}</h3>
          <p className="text-xs text-slate-400 mt-0.5">S&S restock setup · {group.items.length} sizes</p>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Style lookup */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">S&S Style #</label>
            <div className="flex gap-2">
              <input value={styleNumber} onChange={e => setStyleNumber(e.target.value)}
                onKeyDown={e => e.key === "Enter" && lookupStyle()}
                placeholder="1717"
                className="flex-1 min-w-0 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              <button onClick={lookupStyle} disabled={ssLoading || !styleNumber.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition disabled:opacity-50 text-xs font-semibold">
                {ssLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Lookup"}
              </button>
            </div>
            {ssLabel && <div className="text-xs text-emerald-600 font-semibold mt-1">{ssLabel}</div>}
            {ssError && <div className="text-xs text-red-500 mt-1">{ssError}</div>}
          </div>

          {/* Color */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Color</label>
            {ssColors.length > 0 ? (
              <select value={ssColor} onChange={e => setSsColor(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                <option value="">Select color…</option>
                {ssColors.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : (
              <input value={ssColor} onChange={e => setSsColor(e.target.value)} placeholder="Black"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            )}
          </div>

          {/* Size breakdown with per-size targets */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Stock & Targets</label>
            <div className="grid grid-cols-5 gap-2">
              {sortedItems.map(item => {
                const t = targets[item.id] || 0;
                const need = Math.max(0, t - (item.qty || 0));
                return (
                  <div key={item.id} className={`rounded-lg px-2 py-2 text-center ${need > 0 ? "bg-orange-50 border border-orange-200" : "bg-slate-50"}`}>
                    <div className="text-xs font-semibold text-slate-500">{item.variantName || "—"}</div>
                    <div className="text-sm font-bold text-slate-800 mt-0.5">{item.qty || 0}</div>
                    <input type="number" min="0" value={t}
                      onChange={e => setTargets(prev => ({ ...prev, [item.id]: parseInt(e.target.value) || 0 }))}
                      className="w-full text-center text-[11px] border border-slate-200 rounded py-0.5 mt-1 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                    {need > 0 && <div className="text-[10px] font-semibold text-orange-600 mt-0.5">+{need}</div>}
                    {need === 0 && <div className="text-[10px] text-emerald-500 mt-0.5">OK</div>}
                  </div>
                );
              })}
            </div>
            <div className="text-[10px] text-slate-400 mt-1.5 text-center">Current stock on top · target below · needed in orange</div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving || saved}
              className={`flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl transition disabled:opacity-80 ${saved ? "bg-emerald-600 text-white" : "bg-white border border-indigo-200 text-indigo-600 hover:bg-indigo-50"}`}>
              {saving && <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>}
              {saved && <><Check className="w-4 h-4" /> Saved</>}
              {!saving && !saved && "Save Settings"}
            </button>
            <button onClick={async () => {
              const needs = sortedItems
                .map(item => ({ size: (item.variantName || "").toUpperCase(), need: Math.max(0, (targets[item.id] || 0) - (item.qty || 0)) }))
                .filter(n => n.need > 0);
              if (!needs.length) { alert("All sizes are at or above target."); return; }
              if (!styleNumber.trim() || !ssColor) { alert("Set S&S Style # and Color first."); return; }
              setOrdering(true);
              try {
                const res = await fetch(`${supabaseFuncUrl}/functions/v1/ssLookupStyle`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ styleNumber: styleNumber.trim() }),
                });
                const data = await res.json();
                const matches = data.matches || [];
                if (!matches.length) { alert("Style not found on S&S"); return; }
                const product = matches[0];
                // Fetch per-size SKUs
                const skuRes = await fetch(`${supabaseFuncUrl}/functions/v1/ssLookupStyle`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ styleNumber: styleNumber.trim(), action: "rawSkus", color: ssColor }),
                });
                const skuData = await skuRes.json();
                const sizeSku = skuData.skus || {};
                if (!Object.keys(sizeSku).length) { alert(`No SKUs found for ${ssColor}`); return; }
                const cartItems = [];
                for (const { size, need } of needs) {
                  const match = sizeSku[size];
                  if (!match) continue;
                  cartItems.push({
                    product: group.baseName,
                    style: styleNumber.trim(),
                    color: ssColor,
                    size,
                    qty: need,
                    sku: match.sku,
                    price: match.price || 0,
                  });
                }
                if (!cartItems.length) { alert("Could not match any sizes to S&S SKUs"); return; }
                onAddToCart(cartItems);
                onClose();
              } catch (err) {
                alert("Error: " + err.message);
              } finally {
                setOrdering(false);
              }
            }} disabled={ordering}
              className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white transition disabled:opacity-60">
              {ordering ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
              {ordering ? "Adding…" : "Add to S&S Cart"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SsCartModal({ cart, onRemove, onClear, onClose, supabaseFuncUrl, user }) {
  const grouped = {};
  cart.forEach((item, idx) => {
    const key = `${item.product} — ${item.color}`;
    if (!grouped[key]) grouped[key] = { product: item.product, style: item.style, color: item.color, items: [] };
    grouped[key].items.push({ ...item, _idx: idx });
  });

  const totalQty = cart.reduce((s, c) => s + c.qty, 0);
  const totalCost = cart.reduce((s, c) => s + c.qty * (c.price || 0), 0);
  function openOnSS(style) {
    window.open(`https://www.ssactivewear.com/ps/product/${encodeURIComponent(style)}`, "_blank");
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onMouseDown={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-orange-500" /> S&S Restock Cart
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">{totalQty} units · {fmtMoney(totalCost)} estimated</p>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {Object.values(grouped).map(g => (
            <div key={`${g.product}-${g.color}`} className="px-6 py-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="font-semibold text-sm text-slate-800">{g.product}</div>
                  <div className="text-xs text-slate-400">Style {g.style} · {g.color}</div>
                </div>
                <button onClick={() => openOnSS(g.style)}
                  className="text-xs font-semibold text-orange-600 border border-orange-200 px-2.5 py-1 rounded-lg hover:bg-orange-50 transition">
                  Open on S&S
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {g.items.map(item => (
                  <div key={item._idx} className="flex items-center gap-1.5 bg-slate-50 rounded-lg px-2.5 py-1.5">
                    <span className="text-xs font-semibold text-slate-600">{item.size}</span>
                    <span className="text-xs font-bold text-slate-800">×{item.qty}</span>
                    <button onClick={() => onRemove(item._idx)} className="text-slate-300 hover:text-red-400 text-xs ml-0.5">✕</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {cart.length === 0 && (
            <div className="px-6 py-8 text-center text-sm text-slate-400">Cart is empty</div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">Close</button>
            {cart.length > 0 && (
              <button onClick={onClear} className="text-sm text-red-400 hover:text-red-600">Clear All</button>
            )}
          </div>
          <div className="text-sm font-semibold text-slate-700">{fmtMoney(totalCost)} est.</div>
        </div>
      </div>
    </div>
  );
}
