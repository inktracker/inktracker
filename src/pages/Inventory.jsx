import { useState, useEffect } from "react";
import { base44 } from "@/api/supabaseClient";
import { fmtMoney } from "../components/shared/pricing";
import Icon from "../components/shared/Icon";
import AdvancedFilters from "../components/AdvancedFilters";

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
  }, []);

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