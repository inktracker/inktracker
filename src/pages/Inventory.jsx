import { useState, useEffect, useMemo } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { cachedFilter } from "@/lib/queries/cachedEntity";
import { fmtMoney } from "../components/shared/pricing";
import ModalBackdrop from "../components/shared/ModalBackdrop";
import { Loader2, Check, ChevronDown, ChevronRight, Search, Plus, X, Edit3, Trash2, ShoppingCart } from "lucide-react";
import EmptyState from "../components/shared/EmptyState";
import ShoppingList from "../components/inventory/ShoppingList";
import NorcalLinkPicker from "../components/inventory/NorcalLinkPicker";
import NorcalCatalog from "../components/inventory/NorcalCatalog";
import NorcalOrderModal from "../components/inventory/NorcalOrderModal";

// NorCal bucket (from the catalog) → the shop's own inventory category, so an
// added NorCal product lands under a sensible local category.
const NORCAL_CAT_TO_SHOP = { Inks: "Ink", Screens: "Screens", Chemicals: "Chemicals", Equipment: "Tools", Squeegees: "Tools", Tape: "Other", Supplies: "Other" };
import { notify } from "@/lib/notify";
import { shopScope } from "@/lib/shopScope";
import { useReadOnly } from "@/lib/billing-gate";
import ReactivateLink from "@/components/shared/ReactivateLink";

const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

const DEFAULT_CATEGORIES = ["Blanks", "Chemicals", "Ink", "Other", "Screens", "Tools"];

export default function Inventory() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");
  const [showForm, setShowForm] = useState(false);
  const [view, setView] = useState("inventory"); // "inventory" | "catalog" (Browse NorCal)
  const [form, setForm] = useState({ item:"", sku:"", category:"Blanks", supplier:"", qty:0, unit:"pcs", reorder:0, cost:0, norcal_variant_id:null, norcal_product_url:null, norcal_image_url:null, norcal_title:null, norcal_size:null, norcal_price:null });
  const [adding, setAdding] = useState(false);
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
  const [user, setUser] = useState(null);
  const { readOnly, reason, reactivateHref } = useReadOnly(user);
  const [saveStatus, setSaveStatus] = useState(null);
  const [restockSetup, setRestockSetup] = useState(null);
  const [ssCart, setSsCart] = useState(() => {
    try { return JSON.parse(localStorage.getItem("ssCart")) || []; } catch { return []; }
  });
  const [showCart, setShowCart] = useState(false);

  // NorCal order list ("shopping list") — built by adding products from Browse
  // NorCal, persisted so it survives navigation, submitted to NorCal in one
  // click. Each entry: { variantId, title, size, price, image, url, sku, qty }.
  const [norcalOrder, setNorcalOrder] = useState(() => {
    try { return JSON.parse(localStorage.getItem("norcalOrder")) || []; } catch { return []; }
  });
  const [showOrder, setShowOrder] = useState(false);
  function persistOrder(next) {
    localStorage.setItem("norcalOrder", JSON.stringify(next));
    return next;
  }
  function addToNorcalOrder(product) {
    setNorcalOrder(prev => {
      const key = String(product.variantId);
      if (prev.some(i => String(i.variantId) === key)) return prev; // already queued
      return persistOrder([...prev, {
        variantId: key, title: product.title, size: product.size || "",
        price: Number(product.price) || 0, image: product.image || "",
        url: product.url || "", sku: product.sku || "", qty: 1,
      }]);
    });
    setShowOrder(true);
  }
  function setNorcalOrderQty(variantId, qty) {
    setNorcalOrder(prev => persistOrder(prev.map(i => String(i.variantId) === String(variantId) ? { ...i, qty } : i)));
  }
  function removeFromNorcalOrder(variantId) {
    setNorcalOrder(prev => persistOrder(prev.filter(i => String(i.variantId) !== String(variantId))));
  }
  function clearNorcalOrder() {
    setNorcalOrder(persistOrder([]));
    setShowOrder(false);
  }

  // Per-item restock routes to the item's ACTUAL vendor: a NorCal-linked supply
  // goes straight to the NorCal order; a garment/blank stays on the S&S restock
  // flow (which is really for blanks). Prevents a NorCal ink opening an "S&S
  // restock" by mistake.
  function handleItemRestock(group) {
    const first = group.items?.[0] || {};
    if (first.norcal_variant_id) {
      addToNorcalOrder({
        variantId: first.norcal_variant_id,
        title: first.norcal_title || first.item,
        size: first.norcal_size || "",
        price: Number(first.norcal_price) || Number(first.cost) || 0,
        image: first.norcal_image_url || "",
        url: first.norcal_product_url || "",
        sku: first.sku || "",
      });
      return;
    }
    setRestockSetup(group); // S&S garment/blank restock setup
  }

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

  useEffect(() => {
    base44.auth.me().then(async (u) => {
      setUser(u);
      try {
        const i = await cachedFilter("InventoryItem", { filters: { shop_owner: shopScope(u) } });
        setItems([...i].sort((a, b) => (a.item || "").localeCompare(b.item || "", undefined, { sensitivity: 'base' })));
      } catch (err) {
        notify.error("Couldn't load inventory", err);
      } finally {
        setLoading(false);
      }
    }).catch((err) => {
      notify.error("Couldn't load inventory", err);
      setLoading(false);
    });
  }, []);

  async function updateQty(id, newQty) {
    try {
      const updated = await base44.entities.InventoryItem.update(id, { qty: parseInt(newQty) || 0 });
      setItems(prev => prev.map(i => i.id === id ? updated : i));
    } catch (err) {
      notify.error("Couldn't update quantity", err);
    }
  }

  async function handleAdd() {
    if (!form.item.trim() || !form.sku.trim()) return;
    // Double-click guard — without this, a slow network would let the
    // user click twice and create two identical inventory rows.
    if (adding) return;
    setAdding(true);
    let created;
    try {
      created = await base44.entities.InventoryItem.create({ ...form, shop_owner: shopScope(user) });
    } catch (err) {
      notify.error("Couldn't add item", err);
      setAdding(false);
      return;
    }
    setItems(prev => [...prev, created].sort((a, b) => (a.item || "").localeCompare(b.item || "", undefined, { sensitivity: 'base' })));
    setForm({ item:"", sku:"", category:"Blanks", supplier:"", qty:0, unit:"pcs", reorder:0, cost:0, norcal_variant_id:null, norcal_product_url:null, norcal_image_url:null, norcal_title:null, norcal_size:null, norcal_price:null });
    setShowForm(false);
    setAdding(false);
  }

  // "Add to my inventory" from the Browse NorCal catalog: create a stocked item
  // pre-linked to the NorCal variant (price/image/url) so it immediately shows
  // NorCal pricing and feeds the reorder/cart flows. Starts at qty 0 — the shop
  // sets its on-hand count and reorder threshold after.
  async function handleAddFromCatalog(product) {
    const payload = {
      item: [product.title, product.size].filter(Boolean).join(" — "),
      sku: product.sku || String(product.variantId),
      category: NORCAL_CAT_TO_SHOP[product.category] || "Other",
      supplier: "NorCal",
      qty: 0,
      unit: "",
      reorder: 0,
      cost: Number(product.price) || 0,
      norcal_variant_id: String(product.variantId),
      norcal_product_url: product.url || null,
      norcal_image_url: product.image || null,
      norcal_title: product.title || null,
      norcal_size: product.size || null,
      norcal_price: Number(product.price) || 0,
      shop_owner: shopScope(user),
    };
    try {
      const created = await base44.entities.InventoryItem.create(payload);
      setItems(prev => [...prev, created].sort((a, b) => (a.item || "").localeCompare(b.item || "", undefined, { sensitivity: 'base' })));
      notify.success(`Added ${product.title} to your inventory.`);
    } catch (err) {
      notify.error("Couldn't add to inventory", err);
    }
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
      setSaveStatus(null);
      notify.error("Save failed", err);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this item?")) return;
    try {
      await base44.entities.InventoryItem.delete(id);
      setItems(prev => prev.filter(i => i.id !== id));
      setEditing(null);
    } catch (err) {
      notify.error("Couldn't delete item", err);
    }
  }

  const hasShopify = items.some(i => i.category === "Shopify");
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

  // NorCal-linked supplies running low — surfaced as a gentle reminder at
  // checkout (NOT auto-added to the order).
  const norcalLowReminders = items
    .filter(i => i.norcal_variant_id && Number(i.qty) <= Number(i.reorder))
    .map(i => ({
      variantId: String(i.norcal_variant_id),
      title: i.norcal_title || i.item,
      size: i.norcal_size || "",
      price: Number(i.norcal_price) || Number(i.cost) || 0,
      image: i.norcal_image_url || "",
      url: i.norcal_product_url || "",
      sku: i.sku || "",
    }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Inventory</h2>
          <p className="text-sm text-slate-500 mt-0.5">{totalItems} items · {fmtMoney(totalValue)} total value</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowCatEditor(v=>!v)} className="bg-white border border-slate-200 text-slate-600 text-sm font-semibold px-3 py-2 rounded-xl transition hover:border-teal-300">
            {showCatEditor ? <X className="w-4 h-4" /> : "Categories"}
          </button>
          <button onClick={() => setShowForm(v=>!v)} disabled={readOnly} title={readOnly ? reason : undefined}
            className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-3 py-2 rounded-xl transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
            {showForm ? <X className="w-4 h-4" /> : <><Plus className="w-4 h-4" /> Add Item</>}
          </button>
          <ReactivateLink show={readOnly} href={reactivateHref} className="self-center" />
          {norcalOrder.length > 0 && (
            <button onClick={() => setShowOrder(true)}
              className="relative flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold px-3 py-2 rounded-xl transition">
              <ShoppingCart className="w-4 h-4" /> NorCal Order
              <span className="absolute -top-1.5 -right-1.5 bg-slate-900 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">{norcalOrder.length}</span>
            </button>
          )}
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
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Total Products</div>
          <div className="text-2xl font-bold text-slate-800">{grouped.length}</div>
          <div className="text-[10px] text-slate-500">{totalItems} variants</div>
        </div>
        <div className={`border rounded-xl p-4 ${low.length > 0 ? "bg-orange-50 border-orange-200" : "bg-white border-slate-100"}`}>
          <div className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${low.length > 0 ? "text-orange-500" : "text-slate-500"}`}>Low Stock</div>
          <div className={`text-2xl font-bold ${low.length > 0 ? "text-orange-600" : "text-slate-800"}`}>{low.length}</div>
          <div className={`text-[10px] ${low.length > 0 ? "text-orange-400" : "text-slate-500"}`}>need reorder</div>
        </div>
        <div className="bg-white border border-slate-100 rounded-xl p-4">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Inventory Value</div>
          <div className="text-2xl font-bold text-slate-800">{fmtMoney(totalValue)}</div>
          <div className="text-[10px] text-slate-500">at cost</div>
        </div>
      </div>

      {/* Supplier autocomplete options — sourced from existing items so
          users get suggestions for suppliers they've already used. */}
      <datalist id="inventory-supplier-suggestions">
        {Array.from(new Set(items.map(i => i.supplier).filter(Boolean))).sort().map(s => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {/* View toggle: the shop's own stock vs. browsing NorCal's catalog. */}
      <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1">
        <button
          onClick={() => setView("inventory")}
          className={`text-sm font-semibold px-4 py-1.5 rounded-lg transition ${view === "inventory" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >
          My Inventory
        </button>
        <button
          onClick={() => setView("catalog")}
          className={`text-sm font-semibold px-4 py-1.5 rounded-lg transition ${view === "catalog" ? "bg-white text-rose-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >
          Browse NorCal
        </button>
      </div>

      {view === "catalog" ? (
        <NorcalCatalog
          onAddToOrder={addToNorcalOrder}
          orderVariantIds={new Set(norcalOrder.map(i => String(i.variantId)))}
          onAddToInventory={handleAddFromCatalog}
          addedVariantIds={new Set(items.map(i => i.norcal_variant_id).filter(Boolean).map(String))}
          readOnly={readOnly}
          reason={reason}
        />
      ) : (
      <>
      {/* Shopping list — auto-populated from low-stock items, filterable
          by supplier, with bulk "Mark as Ordered" + per-item Receive. */}
      <ShoppingList
        items={items}
        readOnly={readOnly}
        reason={reason}
        reactivateHref={reactivateHref}
        onItemUpdated={(updated) => setItems(prev => prev.map(i => i.id === updated.id ? updated : i))}
        onRefresh={() => {
          if (!user?.email) return;
          base44.entities.InventoryItem.filter({ shop_owner: shopScope(user) }).then(i => {
            setItems([...i].sort((a, b) => (a.item || "").localeCompare(b.item || "", undefined, { sensitivity: 'base' })));
          });
        }}
      />

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
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-teal-300 w-56" />
            <button onClick={addCategory} className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition">Add</button>
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
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-teal-300" />
              </div>
            ))}
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Category</label>
              <select value={form.category} onChange={e => setForm({...form,category:e.target.value})}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-teal-300">
                {categories.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Supplier</label>
              <input value={form.supplier} onChange={e => setForm({...form,supplier:e.target.value})} placeholder="S&S Activewear"
                list="inventory-supplier-suggestions"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-teal-300" />
            </div>
            {[
              { key:"qty", label:"Qty", type:"number" },
              { key:"reorder", label:"Reorder At", type:"number" },
              { key:"cost", label:"Cost ($)", type:"number" },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{f.label}</label>
                <input type={f.type} value={form[f.key]} onChange={e => setForm({...form,[f.key]:e.target.value})}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-teal-300" />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleAdd}
              disabled={readOnly || adding || !form.item.trim() || !form.sku.trim()}
              title={readOnly ? reason : undefined}
              className="bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
            >
              {adding ? "Adding…" : "Add Item"}
            </button>
            <ReactivateLink show={readOnly} href={reactivateHref} />
          </div>
        </div>
      )}

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search products, SKUs…"
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-teal-300"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {cats.map(c => (
            <button key={c} onClick={() => setFilter(c)}
              className={`text-xs font-semibold px-3 py-2 rounded-xl border transition ${filter===c ? "bg-teal-600 text-white border-teal-600" : "bg-white border-slate-200 text-slate-500 hover:border-teal-300"}`}>
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
          <EmptyState type="inventory" onAction={() => { setForm({ item:"", sku:"", category:"Blanks", qty:0, unit:"pcs", reorder:0, cost:0 }); setShowForm(true); }} readOnly={readOnly} reactivateHref={reactivateHref} />
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
                    isExpanded ? <ChevronDown className="w-5 h-5 text-slate-500" /> : <ChevronRight className="w-5 h-5 text-slate-500" />
                  ) : <div className="w-5" />}
                </div>

                {/* Product info */}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800">{group.baseName}</div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                    <span>{firstItem.category}</span>
                    {hasVariants && <span>{group.items.length} variant{group.items.length !== 1 ? "s" : ""}</span>}
                    {!hasVariants && <span className="font-mono">{firstItem.sku}</span>}
                  </div>
                </div>

                {/* Stock summary */}
                <div className="text-right flex-shrink-0">
                  <div className="font-bold text-slate-800">{group.totalQty} <span className="text-xs font-normal text-slate-500">{firstItem.unit || "pcs"}</span></div>
                  <div className="text-xs text-slate-500">{fmtMoney(group.totalValue)}</div>
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
                  <button onClick={(e) => { e.stopPropagation(); handleItemRestock(group); }}
                    disabled={readOnly}
                    className={`p-1.5 text-slate-300 transition disabled:opacity-50 disabled:cursor-not-allowed ${firstItem.norcal_variant_id ? "hover:text-rose-600" : "hover:text-orange-500"}`}
                    title={readOnly ? reason : (firstItem.norcal_variant_id ? "Add to NorCal order" : "Setup restock")}>
                    <ShoppingCart className="w-4 h-4" />
                  </button>
                  {!hasVariants && (
                    <button onClick={(e) => { e.stopPropagation(); setEditing({...firstItem}); }}
                      disabled={readOnly}
                      className="p-1.5 text-slate-300 hover:text-slate-600 transition disabled:opacity-50 disabled:cursor-not-allowed" title={readOnly ? reason : "Edit"}>
                      <Edit3 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded variants */}
              {isExpanded && hasVariants && (
                <div className="border-t border-slate-100 bg-slate-50/50">
                  {/* Variant header */}
                  <div className="grid grid-cols-12 gap-2 px-5 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-100">
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
                      <div className="col-span-2 font-mono text-xs text-slate-500 truncate">{item.sku}</div>
                      <div className="col-span-2 flex justify-center">
                        <input type="number" min="0" defaultValue={item.qty}
                          onBlur={e => updateQty(item.id, e.target.value)}
                          disabled={readOnly} title={readOnly ? reason : undefined}
                          className="w-16 text-center font-bold text-slate-800 border border-slate-200 rounded-lg py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-300 disabled:opacity-50 disabled:cursor-not-allowed" />
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
                          disabled={readOnly} title={readOnly ? reason : "Edit"}
                          className="p-1 text-slate-300 hover:text-slate-600 transition disabled:opacity-50 disabled:cursor-not-allowed">
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
          readOnly={readOnly}
          reason={reason}
          reactivateHref={reactivateHref}
          onAddToCart={addToSsCart}
          onSave={async (updates) => {
            for (const { id, ...fields } of updates) {
              const { variantName, ...payload } = fields;
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
          readOnly={readOnly}
          reason={reason}
          reactivateHref={reactivateHref}
        />
      )}

      </>
      )}

      {/* NorCal order list — available from both views via the header button. */}
      {showOrder && (
        <NorcalOrderModal
          order={norcalOrder}
          onSetQty={setNorcalOrderQty}
          onRemove={removeFromNorcalOrder}
          onClear={clearNorcalOrder}
          onClose={() => setShowOrder(false)}
          onAddLowItem={addToNorcalOrder}
          lowReminders={norcalLowReminders}
          onOrdered={() => setShowOrder(false)}
        />
      )}

      {/* Edit modal */}
      {editing && (
        <ModalBackdrop onClose={() => setEditing(null)} z="z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-slate-900">Edit Item</h3>
              <button onClick={() => setEditing(null)} className="text-slate-500 hover:text-slate-600">
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
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                </div>
              ))}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Category</label>
                <select value={editing.category} onChange={e => setEditing({...editing,category:e.target.value})}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300">
                  {categories.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Supplier</label>
                <input value={editing.supplier || ""} onChange={e => setEditing({...editing,supplier:e.target.value})}
                  list="inventory-supplier-suggestions" placeholder="S&S Activewear"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300" />
              </div>
              {[
                { key:"qty", label:"Qty" },
                { key:"reorder", label:"Reorder At" },
                { key:"cost", label:"Cost ($)" },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{f.label}</label>
                  <input type="number" value={editing[f.key] || 0} onChange={e => setEditing({...editing,[f.key]:e.target.value})}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                </div>
              ))}
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">NorCal product</label>
                <NorcalLinkPicker
                  value={editing}
                  onLink={(link) => setEditing(e => ({ ...e, ...link, supplier: e.supplier?.trim() ? e.supplier : "NorCal" }))}
                  onUnlink={() => setEditing(e => ({ ...e, norcal_variant_id:null, norcal_product_url:null, norcal_image_url:null, norcal_title:null, norcal_size:null, norcal_price:null }))}
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2 items-center">
              <button onClick={handleEdit} disabled={readOnly || saveStatus === "saving" || saveStatus === "saved"}
                title={readOnly ? reason : undefined}
                className={`flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl transition ${saveStatus === "saved" ? "bg-emerald-600 text-white" : "bg-teal-600 hover:bg-teal-700 text-white"} disabled:opacity-50 disabled:cursor-not-allowed`}>
                {saveStatus === "saving" && <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>}
                {saveStatus === "saved" && <><Check className="w-4 h-4" /> Saved</>}
                {!saveStatus && "Save Changes"}
              </button>
              <ReactivateLink show={readOnly} href={reactivateHref} />
              <button onClick={() => handleDelete(editing.id)} disabled={readOnly}
                title={readOnly ? reason : undefined}
                className="flex items-center gap-1.5 text-red-400 border border-red-200 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-red-50 transition ml-auto disabled:opacity-50 disabled:cursor-not-allowed">
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}
    </div>
  );
}

function RestockModal({ group, supabaseFuncUrl, onSave, onClose, onAddToCart, readOnly, reason, reactivateHref }) {
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
      const { data, error: invErr } = await base44.functions.invoke("ssLookupStyle", {
        styleNumber: styleNumber.trim(),
      });
      if (invErr) {
        setSsError(invErr.message || "Lookup failed");
        return;
      }
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
      notify.error("Save failed", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalBackdrop onClose={onClose} z="z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900">{group.baseName}</h3>
          <p className="text-xs text-slate-500 mt-0.5">S&S restock setup · {group.items.length} sizes</p>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Style lookup */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">S&S Style #</label>
            <div className="flex gap-2">
              <input value={styleNumber} onChange={e => setStyleNumber(e.target.value)}
                onKeyDown={e => e.key === "Enter" && lookupStyle()}
                placeholder="1717"
                className="flex-1 min-w-0 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300" />
              <button onClick={lookupStyle} disabled={ssLoading || !styleNumber.trim()}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition disabled:opacity-50 text-xs font-semibold">
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
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300">
                <option value="">Select color…</option>
                {ssColors.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : (
              <input value={ssColor} onChange={e => setSsColor(e.target.value)} placeholder="Black"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300" />
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
                      className="w-full text-center text-[11px] border border-slate-200 rounded py-0.5 mt-1 bg-white focus:outline-none focus:ring-1 focus:ring-teal-300" />
                    {need > 0 && <div className="text-[10px] font-semibold text-orange-600 mt-0.5">+{need}</div>}
                    {need === 0 && <div className="text-[10px] text-emerald-500 mt-0.5">OK</div>}
                  </div>
                );
              })}
            </div>
            <div className="text-[10px] text-slate-500 mt-1.5 text-center">Current stock on top · target below · needed in orange</div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
            <ReactivateLink show={readOnly} href={reactivateHref} />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={readOnly || saving || saved}
              title={readOnly ? reason : undefined}
              className={`flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl transition disabled:opacity-80 disabled:cursor-not-allowed ${saved ? "bg-emerald-600 text-white" : "bg-white border border-teal-200 text-teal-600 hover:bg-teal-50"}`}>
              {saving && <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>}
              {saved && <><Check className="w-4 h-4" /> Saved</>}
              {!saving && !saved && "Save Settings"}
            </button>
            <button onClick={async () => {
              const needs = sortedItems
                .map(item => ({ size: (item.variantName || "").toUpperCase(), need: Math.max(0, (targets[item.id] || 0) - (item.qty || 0)) }))
                .filter(n => n.need > 0);
              if (!needs.length) { notify.info("All sizes are at or above target."); return; }
              if (!styleNumber.trim() || !ssColor) { notify.info("Set S&S Style # and Color first."); return; }
              setOrdering(true);
              try {
                const { data, error: invErr1 } = await base44.functions.invoke("ssLookupStyle", {
                  styleNumber: styleNumber.trim(),
                });
                if (invErr1) { notify.error("Lookup failed", invErr1); return; }
                const matches = data?.matches || [];
                if (!matches.length) { notify.error("Style not found on S&S"); return; }
                const product = matches[0];
                // Fetch per-size SKUs
                const { data: skuData, error: invErr2 } = await base44.functions.invoke("ssLookupStyle", {
                  styleNumber: styleNumber.trim(),
                  action: "rawSkus",
                  color: ssColor,
                });
                if (invErr2) { notify.error("SKU lookup failed", invErr2); return; }
                const sizeSku = skuData.skus || {};
                if (!Object.keys(sizeSku).length) { notify.error(`No SKUs found for ${ssColor}`); return; }
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
                if (!cartItems.length) { notify.error("Could not match any sizes to S&S SKUs"); return; }
                onAddToCart(cartItems);
                onClose();
              } catch (err) {
                notify.error("S&S cart add failed", err);
              } finally {
                setOrdering(false);
              }
            }} disabled={readOnly || ordering}
              title={readOnly ? reason : undefined}
              className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white transition disabled:opacity-60 disabled:cursor-not-allowed">
              {ordering ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
              {ordering ? "Adding…" : "Add to S&S Cart"}
            </button>
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function SsCartModal({ cart, onRemove, onClear, onClose, supabaseFuncUrl, user, readOnly, reason, reactivateHref }) {
  const [ordering, setOrdering] = useState(false);
  const [orderResult, setOrderResult] = useState(null);
  const [orderError, setOrderError] = useState("");
  // Stable idempotency key for THIS order attempt — survives retries (so a
  // network-timeout retry can't place a second real order, audit INT-01),
  // regenerated only after a confirmed success below.
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());

  const grouped = {};
  cart.forEach((item, idx) => {
    const key = `${item.product} — ${item.color}`;
    if (!grouped[key]) grouped[key] = { product: item.product, style: item.style, color: item.color, items: [] };
    grouped[key].items.push({ ...item, _idx: idx });
  });

  const totalQty = cart.reduce((s, c) => s + c.qty, 0);
  const totalCost = cart.reduce((s, c) => s + c.qty * (c.price || 0), 0);

  async function handlePlaceOrder() {
    setOrdering(true);
    setOrderError("");
    try {
      const lines = cart.map(item => ({
        sku: item.sku || "",
        style: item.style || "",
        color: item.color || "",
        size: item.size || "",
        qty: item.qty,
      })).filter(l => l.qty > 0);

      const poNumber = `INKT-${Date.now().toString(36).toUpperCase()}`;
      const { data, error: fnError } = await supabase.functions.invoke("ssPlaceOrder", {
        body: {
          poNumber,
          idempotencyKey: idemKey,
          shipTo: {
            name: user?.shop_name || "My Shop",
            address1: user?.address || "",
            city: user?.city || "",
            state: user?.state || "",
            zip: user?.zip || "",
          },
          lines,
          shippingMethod: "Ground",
          testOrder: false,
        },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setOrderResult(data);
      // New key for the next distinct order; the just-used key stays "spent"
      // so an accidental re-submit of this same order replays, not re-orders.
      setIdemKey(crypto.randomUUID());
      onClear();
    } catch (err) {
      setOrderError(err.message || "Failed to place order");
    } finally {
      setOrdering(false);
    }
  }
  function openOnSS(style) {
    window.open(`https://www.ssactivewear.com/search?q=${encodeURIComponent(style)}`, "_blank");
  }

  function downloadCSV() {
    // S&S bulk order CSV format: SKU, Qty
    const rows = [["SKU", "Qty"]];
    for (const item of cart) {
      const sku = item.sku || `${item.style}${(item.color || "").replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 6)}-${item.size}`;
      rows.push([sku, item.qty]);
    }
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ss-order-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <ModalBackdrop onClose={onClose} z="z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-orange-500" /> S&S Restock Cart
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">{totalQty} units · {fmtMoney(totalCost)} estimated</p>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {Object.values(grouped).map(g => (
            <div key={`${g.product}-${g.color}`} className="px-6 py-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="font-semibold text-sm text-slate-800">{g.product}</div>
                  <div className="text-xs text-slate-500">Style {g.style} · {g.color}</div>
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
          {cart.length === 0 && !orderResult && (
            <div className="px-6 py-8 text-center text-sm text-slate-500">Cart is empty</div>
          )}

          {orderResult && (
            <div className="px-6 py-8 text-center space-y-3">
              <Check className="w-10 h-10 text-emerald-500 mx-auto" />
              <div className="text-sm font-bold text-slate-800">Order placed with S&S</div>
              {orderResult.order?.orderNumber && (
                <div className="text-xs text-slate-500">S&S Order #: <span className="font-mono font-bold">{orderResult.order.orderNumber}</span></div>
              )}
            </div>
          )}

          {orderError && (
            <div className="mx-6 mb-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{orderError}</div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 space-y-3">
          {cart.length > 0 && !orderResult && (
            <>
              <button onClick={handlePlaceOrder} disabled={readOnly || ordering}
                title={readOnly ? reason : undefined}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 rounded-xl transition flex items-center justify-center gap-2">
                {ordering ? <><Loader2 className="w-4 h-4 animate-spin" /> Placing Order...</> : <><ShoppingCart className="w-4 h-4" /> Place Order with S&S ({totalQty} items)</>}
              </button>
              {readOnly && (
                <div className="text-center">
                  <ReactivateLink show={readOnly} href={reactivateHref} />
                </div>
              )}
            </>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">Close</button>
              {cart.length > 0 && !orderResult && (
                <button onClick={onClear} className="text-sm text-red-400 hover:text-red-600">Clear All</button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {cart.length > 0 && !orderResult && (
                <button onClick={downloadCSV}
                  className="text-xs font-semibold text-teal-600 border border-teal-200 px-3 py-1.5 rounded-lg hover:bg-teal-50 transition">
                  Download CSV
                </button>
              )}
              {cart.length > 0 && <div className="text-sm font-semibold text-slate-700">{fmtMoney(totalCost)} est.</div>}
            </div>
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
}
