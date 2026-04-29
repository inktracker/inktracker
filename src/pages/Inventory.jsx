import { useState, useEffect } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { fmtMoney } from "../components/shared/pricing";
import Icon from "../components/shared/Icon";
import AdvancedFilters from "../components/AdvancedFilters";
import { Loader2, RefreshCw, ShoppingBag, Check } from "lucide-react";

const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

const DEFAULT_CATEGORIES = ["Blanks", "Chemicals", "Ink", "Other", "Screens", "Tools"];

export default function Inventory() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ item:"", sku:"", category:"Ink", qty:0, unit:"", reorder:0, cost:0 });
  const [editing, setEditing] = useState(null);
  const [categories, setCategories] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("invCategories")) || DEFAULT_CATEGORIES;
      return [...stored].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    } catch { return DEFAULT_CATEGORIES; }
  });
  const [newCat, setNewCat] = useState("");
  const [showCatEditor, setShowCatEditor] = useState(false);
  const [advFilters, setAdvFilters] = useState({});
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopifySyncing, setShopifySyncing] = useState(false);
  const [shopifyProducts, setShopifyProducts] = useState(null);
  const [shopifyImporting, setShopifyImporting] = useState(false);

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

  useEffect(() => {
    base44.entities.InventoryItem.list().then(i => {
      setItems([...i].sort((a, b) => (a.item || "").localeCompare(b.item || "", undefined, { sensitivity: 'base' })));
      setLoading(false);
    });
    // Check if Shopify is connected
    base44.auth.me().then(u => {
      if (u?.shopify_access_token) setShopifyConnected(true);
    }).catch(() => {});
    // Check URL params for OAuth callback result
    const params = new URLSearchParams(window.location.search);
    if (params.get("shopify_connected") === "1") {
      setShopifyConnected(true);
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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: "getAuthUrl" }),
      });
      const data = await res.json();
      if (data.authUrl) window.location.href = data.authUrl;
      else alert("Failed to get Shopify auth URL");
    } catch (err) {
      alert("Error connecting to Shopify: " + err.message);
    }
  }

  async function syncShopify() {
    setShopifySyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/shopifySync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: "syncProducts" }),
      });
      const data = await res.json();
      if (data.error) {
        alert("Sync failed: " + data.error);
      } else {
        setShopifyProducts(data.products || []);
      }
    } catch (err) {
      alert("Sync error: " + err.message);
    } finally {
      setShopifySyncing(false);
    }
  }

  async function importShopifyProducts(selected) {
    setShopifyImporting(true);
    try {
      const existing = items.map(i => i.sku?.toLowerCase()).filter(Boolean);
      let imported = 0;
      for (const sp of selected) {
        if (sp.sku && existing.includes(sp.sku.toLowerCase())) continue;
        const created = await base44.entities.InventoryItem.create({
          item: sp.title,
          sku: sp.sku || `SHOP-${sp.shopify_variant_id}`,
          category: sp.product_type || "Shopify",
          qty: sp.inventory_quantity || 0,
          reorder: 0,
          cost: sp.price || 0,
          unit: "pcs",
        });
        setItems(prev => [...prev, created].sort((a, b) => (a.item || "").localeCompare(b.item || "", undefined, { sensitivity: 'base' })));
        imported++;
      }
      alert(`Imported ${imported} items. ${selected.length - imported} skipped (duplicate SKU).`);
      setShopifyProducts(null);
    } catch (err) {
      alert("Import error: " + err.message);
    } finally {
      setShopifyImporting(false);
    }
  }

  const handleAdvFilterChange = (key, value) => {
    setAdvFilters(prev => value ? { ...prev, [key]: value } : { ...prev, [key]: undefined });
  };

  const cats = ["All", ...categories];
  let filtered = filter === "All" ? items : items.filter(i=>i.category===filter);
  filtered = filtered.filter(i => {
    if (advFilters.item && !i.item?.toLowerCase().includes(advFilters.item.toLowerCase())) return false;
    if (advFilters.sku && !i.sku?.toLowerCase().includes(advFilters.sku.toLowerCase())) return false;
    if (advFilters.lowStock && i.qty > i.reorder) return false;
    return true;
  });

  const advFilterOptions = [
    { key: "item", label: "Item Name", type: "text" },
    { key: "sku", label: "SKU", type: "text" },
    { key: "lowStock", label: "Low Stock Only", type: "checkbox" },
  ];

  const low = items.filter(i=>i.qty<=i.reorder);

  async function handleAdd() {
    if (!form.item.trim() || !form.sku.trim()) return;
    const created = await base44.entities.InventoryItem.create(form);
    setItems(prev => [...prev, created].sort((a, b) => (a.item || "").localeCompare(b.item || "", undefined, { sensitivity: 'base' })));
    setForm({ item:"", sku:"", category:"Ink", qty:0, unit:"", reorder:0, cost:0 });
    setShowForm(false);
  }

  async function updateQty(id, newQty) {
    const updated = await base44.entities.InventoryItem.update(id, { qty: parseInt(newQty) || 0 });
    setItems(prev => prev.map(i => i.id === id ? updated : i));
  }

  async function handleEdit() {
    if (!editing.item.trim() || !editing.sku.trim()) return;
    const updated = await base44.entities.InventoryItem.update(editing.id, editing);
    setItems(prev => prev.map(i => i.id === editing.id ? updated : i));
    setEditing(null);
  }

  async function handleDelete(id) {
    await base44.entities.InventoryItem.delete(id);
    setItems(prev => prev.filter(i => i.id !== id));
    setEditing(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-900">Inventory</h2>
        <div className="flex gap-2">
          {shopifyConnected ? (
            <button onClick={syncShopify} disabled={shopifySyncing}
              className="flex items-center gap-2 bg-white border border-emerald-200 text-emerald-700 text-sm font-semibold px-4 py-2.5 rounded-xl transition hover:border-emerald-400 disabled:opacity-60">
              {shopifySyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {shopifySyncing ? "Syncing…" : "Sync Shopify"}
            </button>
          ) : (
            <button onClick={connectShopify}
              className="flex items-center gap-2 bg-white border border-slate-200 text-slate-600 text-sm font-semibold px-4 py-2.5 rounded-xl transition hover:border-green-300">
              <ShoppingBag className="w-4 h-4" /> Connect Shopify
            </button>
          )}
          <button onClick={() => setShowCatEditor(v=>!v)} className="bg-white border border-slate-200 text-slate-600 text-sm font-semibold px-4 py-2.5 rounded-xl transition hover:border-indigo-300">
            {showCatEditor ? "✕ Categories" : "⚙ Categories"}
          </button>
          <button onClick={() => setShowForm(v=>!v)} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition shadow-sm">
            {showForm ? "✕ Cancel" : "+ Add Item"}
          </button>
        </div>
      </div>

      {low.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-5 py-3 text-sm text-orange-700 font-semibold flex items-center gap-2">
          <Icon name="warning" className="w-4 h-4 flex-shrink-0" />
          Reorder needed: {low.map(i=>i.item).join(" · ")}
        </div>
      )}

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
            <input value={newCat} onChange={e => setNewCat(e.target.value)} onKeyDown={e => e.key === "Enter" && addCategory()} placeholder="New category name…"
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 w-56" />
            <button onClick={addCategory} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition">Add</button>
          </div>
        </div>
      )}

      {showForm && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-3">
          <div className="text-xs font-bold text-slate-600 uppercase tracking-widest">New Item</div>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            {[
              { key:"item", label:"Item Name *", placeholder:"Plastisol Ink — Black" },
              { key:"sku", label:"SKU *", placeholder:"INK-BLK" },
              { key:"unit", label:"Unit", placeholder:"qt, gal, pcs" },
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

      <div className="flex gap-2 flex-wrap">
         {cats.map(c=><button key={c} onClick={()=>setFilter(c)} className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${filter===c?"bg-indigo-600 text-white border-indigo-600":"bg-white border-slate-200 text-slate-500 hover:border-indigo-300"}`}>{c}</button>)}
       </div>

       <AdvancedFilters filters={advFilters} onFilterChange={handleAdvFilterChange} filterOptions={advFilterOptions} />

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            {["Item","SKU","Category","In Stock","Reorder At","Cost","Status",""].map(h=><th key={h} className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-widest">{h}</th>)}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-300">Loading…</td></tr>}
            {filtered.map(item=>(
              <tr key={item.id} className={`border-b border-slate-50 transition ${item.qty<=item.reorder?"bg-orange-50/40 hover:bg-orange-50":"hover:bg-slate-50"}`}>
                <td className="px-5 py-3.5 font-semibold text-slate-800">{item.item}</td>
                <td className="px-5 py-3.5 font-mono text-xs text-slate-400">{item.sku}</td>
                <td className="px-5 py-3.5 text-slate-500">{item.category}</td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <input type="number" min="0" defaultValue={item.qty}
                      onBlur={e => updateQty(item.id, e.target.value)}
                      className="w-16 text-center font-bold text-slate-800 border border-slate-200 rounded-lg py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    <span className="text-slate-400 text-xs">{item.unit}</span>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-slate-500">{item.reorder} {item.unit}</td>
                <td className="px-5 py-3.5 text-slate-600">{fmtMoney(item.cost)}</td>
                <td className="px-5 py-3.5">{item.qty<=item.reorder
                  ?<span className="text-xs font-semibold text-orange-600 bg-orange-50 border border-orange-200 px-2.5 py-1 rounded-full">Reorder</span>
                  :<span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">OK</span>}
                </td>
                <td className="px-5 py-3.5">
                  <button onClick={() => setEditing({...item})} className="text-xs font-semibold text-slate-400 border border-slate-200 px-2.5 py-1 rounded-lg hover:bg-slate-50 transition">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {shopifyProducts && (
        <ShopifyImportModal
          products={shopifyProducts}
          existingSkus={items.map(i => i.sku?.toLowerCase()).filter(Boolean)}
          onImport={importShopifyProducts}
          onClose={() => setShopifyProducts(null)}
          importing={shopifyImporting}
        />
      )}

      {editing && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4" onMouseDown={e => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-slate-900">Edit Item</h3>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
            </div>
            <div className="grid gap-3 grid-cols-2">
              {[
                { key:"item", label:"Item Name *", placeholder:"Plastisol Ink — Black" },
                { key:"sku", label:"SKU *", placeholder:"INK-BLK" },
                { key:"unit", label:"Unit", placeholder:"qt, gal, pcs" },
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
              <button onClick={handleEdit} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition">Save Changes</button>
              <button onClick={() => handleDelete(editing.id)} className="text-red-400 border border-red-200 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-red-50 transition ml-auto">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ShopifyImportModal({ products, existingSkus, onImport, onClose, importing }) {
  const [selected, setSelected] = useState(() => new Set(products.map((_, i) => i)));

  const toggle = (idx) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(prev => prev.size === products.length ? new Set() : new Set(products.map((_, i) => i)));
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onMouseDown={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Shopify Products</h3>
            <p className="text-xs text-slate-400 mt-0.5">{products.length} products found · {selected.size} selected</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
          <div className="px-6 py-2 bg-slate-50 flex items-center gap-3">
            <input type="checkbox" checked={selected.size === products.length} onChange={toggleAll}
              className="rounded border-slate-300" />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Select All</span>
          </div>
          {products.map((p, idx) => {
            const isDupe = p.sku && existingSkus.includes(p.sku.toLowerCase());
            return (
              <div key={idx} className={`px-6 py-3 flex items-center gap-4 ${isDupe ? "opacity-50" : ""}`}>
                <input type="checkbox" checked={selected.has(idx)} onChange={() => toggle(idx)}
                  className="rounded border-slate-300" />
                {p.image && <img src={p.image} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-100" />}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-slate-800 truncate">{p.title}</div>
                  <div className="text-xs text-slate-400">
                    SKU: {p.sku || "—"} · Stock: {p.inventory_quantity} · {fmtMoney(p.price)}
                    {isDupe && <span className="ml-2 text-orange-500 font-semibold">Already exists</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
          <button onClick={() => onImport(products.filter((_, i) => selected.has(i)))} disabled={importing || selected.size === 0}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition disabled:opacity-60">
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {importing ? "Importing…" : `Import ${selected.size} Items`}
          </button>
        </div>
      </div>
    </div>
  );
}