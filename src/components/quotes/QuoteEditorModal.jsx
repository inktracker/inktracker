import { useEffect, useState } from "react";
import { base44 } from "@/api/supabaseClient";
import {
  Q_STATUSES,
  calcQuoteTotals,
  fmtMoney,
  tod,
  uid,
  newLineItem,
} from "../shared/pricing";
import LineItemEditor from "./LineItemEditor";

const DEFAULT_ADDONS = [
  { key: "tags", label: "Custom Tags", rate: 1.5 },
  { key: "difficultPrint", label: "Difficult Print", rate: 0.5 },
  { key: "colorMatch", label: "Pantone Match", rate: 1.0 },
  { key: "waterbased", label: "Water-Based Ink", rate: 1.0 },
];

function addBusinessDays(date, days) {
  const d = new Date(date);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().split("T")[0];
}

function blankQuote() {
  return {
    quote_id: `Q-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-4)}`,
    customer_id: "",
    customer_name: "",
    job_title: "",
    date: tod(),
    due_date: addBusinessDays(new Date(), 10),
    expires_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    status: "Draft",
    notes: "",
    rush_rate: 0,
    extras: {},
    line_items: [newLineItem()],
    discount: 0,
    tax_rate: 8.265,
    deposit_pct: 0,
    deposit_paid: false,
    imprints: [
      {
        id: uid(),
        title: "",
        location: "Front",
        width: "",
        height: "",
        colors: 1,
        pantones: "",
        technique: "Screen Print",
        details: "",
      },
    ],
  };
}

export default function QuoteEditorModal({
  quote,
  prefillLineItem,
  customers,
  onSave,
  onClose,
  onAddCustomer,
}) {
  const [q, setQ] = useState(() => {
    const base = quote ? { ...quote } : blankQuote();
    if (!quote && prefillLineItem) {
      // Replace the default blank line item with one pre-filled from the catalog
      const blank = newLineItem();
      base.line_items = [{
        ...blank,
        style: prefillLineItem.styleNumber || prefillLineItem.style || "",
        brand: prefillLineItem.brandName || prefillLineItem.brand || "",
        garmentColor: prefillLineItem.garmentColor || "",
        garmentCost: prefillLineItem.garmentCost || prefillLineItem.piecePrice || 0,
        casePrice: prefillLineItem.casePrice || 0,
        styleName: prefillLineItem.styleName || prefillLineItem.title || "",
        resolvedStyleNumber: prefillLineItem.resolvedStyleNumber || prefillLineItem.styleNumber || "",
        supplierStyleNumber: prefillLineItem.supplierStyleNumber || prefillLineItem.styleNumber || "",
        productNumber: prefillLineItem.productNumber || prefillLineItem.id || "",
        resolvedTitle: prefillLineItem.resolvedTitle || prefillLineItem.title || "",
        productTitle: prefillLineItem.resolvedTitle || prefillLineItem.title || "",
        supplier: "S&S Activewear",
      }];
    }
    return base;
  });

  const [showNewClient, setShowNewClient] = useState(false);
  const [nc, setNc] = useState({
    name: "",
    company: "",
    email: "",
    phone: "",
    address: "",
    notes: "",
    tax_id: "",
    tax_exempt: false,
  });

  const [user, setUser] = useState(null);
  const [savedImprints, setSavedImprints] = useState([]);
  const [addonsMeta, setAddonsMeta] = useState(DEFAULT_ADDONS);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const totals = calcQuoteTotals(q);

  useEffect(() => {
    async function loadUser() {
      try {
        const currentUser = await base44.auth.me();
        setUser(currentUser);
        // Load addons from Shop entity
        try {
          const shops = await base44.entities.Shop.filter({ owner_email: currentUser.email });
          if (shops?.[0]?.addons?.length) {
            setAddonsMeta(
              shops[0].addons
                .map(a => ({ ...a, rate: parseFloat(a.rate) || 0 }))
                .sort((a, b) => (a.label || "").localeCompare(b.label || "", undefined, { sensitivity: 'base' }))
            );
          }
        } catch {}
      } catch (error) {
        console.error("Error loading current user:", error);
      }
    }

    loadUser();
  }, []);

  useEffect(() => {
    async function loadSavedImprints() {
      if (!q.customer_id) {
        setSavedImprints([]);
        return;
      }
      try {
        const customer = customers.find((c) => c.id === q.customer_id);
        setSavedImprints(customer?.saved_imprints || []);
      } catch {
        setSavedImprints([]);
      }
    }
    loadSavedImprints();
  }, [q.customer_id, customers]);

  function updateLineItem(idx, li) {
    setQ((prev) => ({
      ...prev,
      line_items: prev.line_items.map((x, i) => (i === idx ? li : x)),
    }));
  }

  function addLineItem() {
    setQ((prev) => ({
      ...prev,
      line_items: [...prev.line_items, newLineItem()],
    }));
  }

  function removeLineItem(idx) {
    setQ((prev) => ({
      ...prev,
      line_items: prev.line_items.filter((_, i) => i !== idx),
    }));
  }

  function duplicateLineItem(idx) {
    const li = q.line_items[idx];
    const copy = { ...li, id: uid() };
    setQ((prev) => ({
      ...prev,
      line_items: [
        ...prev.line_items.slice(0, idx + 1),
        copy,
        ...prev.line_items.slice(idx + 1),
      ],
    }));
  }

  async function handleAddClient() {
    if (!nc.name.trim()) return;

    const newCustomer = {
      name: nc.name,
      company: nc.company,
      email: nc.email,
      phone: nc.phone,
      address: nc.address,
      notes: nc.notes,
      tax_id: nc.tax_id,
      tax_exempt: nc.tax_exempt,
      orders: 0,
    };

    const saved = await onAddCustomer(newCustomer);

    setQ((prev) => ({
      ...prev,
      customer_id: saved.id,
      customer_name: saved.name,
      tax_rate: saved.tax_exempt ? 0 : prev.tax_rate || 8.265,
    }));

    setShowNewClient(false);
    setNc({
      name: "",
      company: "",
      email: "",
      phone: "",
      address: "",
      notes: "",
      tax_id: "",
      tax_exempt: false,
    });
  }

  async function handleSave() {
    setSaving(true);
    setSaveError("");
    try {
      // Persist unique imprint presets to the customer record BEFORE closing the modal
      if (q.customer_id) {
        try {
          const allImprints = (q.line_items || []).flatMap((li) => li.imprints || []);
          const meaningful = allImprints.filter((imp) => imp.title || imp.location);
          if (meaningful.length > 0) {
            const existing = savedImprints;
            const existingKeys = new Set(existing.map((i) => `${i.title}|${i.location}`));
            const newOnes = meaningful.filter((imp) => !existingKeys.has(`${imp.title}|${imp.location}`));
            if (newOnes.length > 0) {
              const merged = [...existing, ...newOnes.map(({ title, location, width, height, colors, technique, pantones }) => ({
                title, location, width, height, colors, technique, pantones,
              }))];
              await base44.entities.Customer.update(q.customer_id, { saved_imprints: merged });
            }
          }
        } catch (e) {
          console.error("Failed to save imprints to customer:", e);
        }
      }

      const t = calcQuoteTotals(q);
      await onSave({ ...q, subtotal: t.sub, tax: t.tax, total: t.total });
    } catch (err) {
      setSaveError(err.message || "Failed to save quote. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl my-4">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-200 bg-slate-50 rounded-t-2xl">
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
              {q.quote_id}
            </div>
            <h2 className="text-xl font-bold text-slate-900">Quote Builder</h2>
          </div>

          <div className="flex gap-2 items-center">
            <select
              value={q.status}
              onChange={(e) => setQ({ ...q, status: e.target.value })}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none"
            >
              {Q_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>

            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200 text-lg leading-none"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6 overflow-auto" style={{ maxHeight: "80vh" }}>
          <div className="space-y-3">
            <div className="grid gap-4 grid-cols-4">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  Customer *
                </label>

                <div className="flex gap-2">
                  <select
                    value={q.customer_id}
                    onChange={(e) => {
                      const c = customers.find((x) => x.id === e.target.value);

                      setQ({
                        ...q,
                        customer_id: e.target.value,
                        customer_name: c ? c.name : "",
                        tax_rate: c?.tax_exempt ? 0 : q.tax_rate || 8.265,
                        // Apply the client's default payment terms to this new quote
                        deposit_pct: c ? Number(c.default_deposit_pct ?? 0) : q.deposit_pct,
                      });
                    }}
                    className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  >
                    <option value="">Select customer…</option>
                    {[...customers].sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: 'base' })).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.company ? ` — ${c.company}` : ""}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => setShowNewClient((v) => !v)}
                    className={`flex-shrink-0 text-xs font-semibold px-3 py-2 rounded-lg border transition ${
                      showNewClient
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                    }`}
                  >
                    {showNewClient ? "✕ Cancel" : "+ New Client"}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  Job Title
                </label>
                <input
                  type="text"
                  value={q.job_title || ""}
                  onChange={(e) => setQ({ ...q, job_title: e.target.value })}
                  placeholder="Business Cards, Event Shirts, etc."
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  Quote Date
                </label>
                <input
                  type="date"
                  value={q.date}
                  onChange={(e) => setQ({ ...q, date: e.target.value })}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  In-Hands Date
                </label>
                <input
                  type="date"
                  value={q.due_date}
                  onChange={(e) => {
                    const due = e.target.value;
                    const quoteDate = q.date || tod();
                    const diffDays = due
                      ? Math.round(
                          (new Date(due) - new Date(quoteDate)) /
                            (1000 * 60 * 60 * 24)
                        )
                      : null;
                    const isRush = diffDays !== null && diffDays < 7;

                    setQ({
                      ...q,
                      due_date: due,
                      rush_rate: isRush ? 0.2 : q.rush_rate,
                    });
                  }}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                {q.due_date &&
                  q.date &&
                  Math.round(
                    (new Date(q.due_date) - new Date(q.date)) /
                      (1000 * 60 * 60 * 24)
                  ) < 7 && (
                    <div className="text-xs text-orange-500 font-semibold mt-1">
                      ⚡ Rush automatically applied (under 7 days)
                    </div>
                  )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  Quote Expires
                </label>
                <input
                  type="date"
                  value={q.expires_date || ""}
                  onChange={(e) => setQ({ ...q, expires_date: e.target.value })}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                {q.expires_date && new Date(q.expires_date) < new Date() && (
                  <div className="text-xs text-rose-500 font-semibold mt-1">
                    This quote has expired
                  </div>
                )}
              </div>
            </div>

            {showNewClient && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 space-y-3">
                <div className="text-xs font-bold text-indigo-700 uppercase tracking-widest">
                  New Client
                </div>

                <div className="grid gap-3 grid-cols-2">
                  {[
                    { key: "name", label: "Name *", placeholder: "Jane Smith" },
                    {
                      key: "company",
                      label: "Company / Org",
                      placeholder: "Company name",
                    },
                    {
                      key: "email",
                      label: "Email",
                      placeholder: "jane@example.com",
                      type: "email",
                    },
                    {
                      key: "phone",
                      label: "Phone",
                      placeholder: "(775) 555-0000",
                      type: "tel",
                    },
                    {
                      key: "address",
                      label: "Address",
                      placeholder: "123 Main St, Reno NV",
                    },
                    {
                      key: "tax_id",
                      label: "Tax ID",
                      placeholder: "EIN or Sales Tax ID",
                    },
                  ].map((f) => (
                    <div key={f.key}>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                        {f.label}
                      </label>
                      <input
                        type={f.type || "text"}
                        value={nc[f.key]}
                        onChange={(e) => setNc({ ...nc, [f.key]: e.target.value })}
                        placeholder={f.placeholder}
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      />
                    </div>
                  ))}

                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                      Notes
                    </label>
                    <textarea
                      value={nc.notes}
                      onChange={(e) => setNc({ ...nc, notes: e.target.value })}
                      placeholder="Terms, preferences…"
                      rows={2}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={nc.tax_exempt}
                    onChange={(e) =>
                      setNc({ ...nc, tax_exempt: e.target.checked })
                    }
                    className="w-4 h-4 rounded border-slate-300 accent-indigo-600"
                  />
                  <span className="text-sm font-semibold text-indigo-700">
                    Tax Exempt
                  </span>
                </label>

                <button
                  onClick={handleAddClient}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition w-full"
                >
                  Add Client &amp; Select
                </button>
              </div>
            )}


          </div>

          <div className="grid gap-6 grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Turnaround
              </label>
              <div className="flex gap-2">
                {[
                  { val: 0, label: "Standard", sub: "14 business days" },
                  { val: 0.2, label: "Rush +20%", sub: "7 business days" },
                ].map((opt) => (
                  <button
                    key={opt.val}
                    onClick={() => setQ({ ...q, rush_rate: opt.val })}
                    className={`flex-1 rounded-xl border-2 px-3 py-2.5 text-left transition ${
                      q.rush_rate === opt.val
                        ? "border-indigo-600 bg-indigo-50"
                        : "border-slate-200 hover:border-slate-300 bg-white"
                    }`}
                  >
                    <div
                      className={`text-sm font-bold ${
                        q.rush_rate === opt.val
                          ? "text-indigo-700"
                          : "text-slate-700"
                      }`}
                    >
                      {opt.label}
                    </div>
                    <div className="text-xs text-slate-400">{opt.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Add-ons (per piece)
              </label>
              <div className="grid grid-cols-2 gap-2">
                {addonsMeta.map(({ key, label, rate }) => {
                  const isOn = !!q.extras[key];
                  return (
                    <button
                      key={key}
                      onClick={() =>
                        setQ({
                          ...q,
                          extras: { ...q.extras, [key]: isOn ? false : rate },
                        })
                      }
                      className={`rounded-xl border-2 px-3 py-2 text-left transition ${
                        isOn
                          ? "border-indigo-600 bg-indigo-50"
                          : "border-slate-200 hover:border-slate-300 bg-white"
                      }`}
                    >
                      <div className={`text-xs font-bold ${isOn ? "text-indigo-700" : "text-slate-700"}`}>
                        {label}
                      </div>
                      <div className="text-xs text-slate-400">+${(parseFloat(rate) || 0).toFixed(2)}/pc</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                Line Items
              </h3>
              <button
                onClick={addLineItem}
                className="text-xs font-semibold text-indigo-600 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition"
              >
                + Add Garment Group
              </button>
            </div>

            {q.line_items.map((li, idx) => (
              <LineItemEditor
                key={li.id}
                li={li}
                rushRate={q.rush_rate}
                extras={q.extras}
                allLineItems={q.line_items}
                savedImprints={savedImprints}
                onChange={(updated) => updateLineItem(idx, updated)}
                onRemove={() => removeLineItem(idx)}
                onDuplicate={() => duplicateLineItem(idx)}
                canRemove={q.line_items.length > 1}
              />
            ))}
          </div>

          <div className="grid gap-6 grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Job Notes
              </label>
              <textarea
                rows={4}
                value={q.notes}
                onChange={(e) => setQ({ ...q, notes: e.target.value })}
                placeholder="Rush instructions, art notes, client communication…"
                className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
              />
            </div>

            <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 space-y-2.5">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Subtotal</span>
                <span className="font-semibold text-slate-700">
                  {fmtMoney(totals.sub)}
                </span>
              </div>

              <div className="flex justify-between items-center text-sm gap-2">
                <span className="text-slate-500 whitespace-nowrap">Discount</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={q.discount}
                    onChange={(e) => setQ({ ...q, discount: e.target.value })}
                    className="w-14 text-sm text-right border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                  <span className="text-slate-400 text-xs">%</span>
                </div>
              </div>

              {parseFloat(q.discount) > 0 && (
                <div className="flex justify-between text-sm text-emerald-600">
                  <span>Savings</span>
                  <span className="font-semibold">
                    −{fmtMoney(totals.sub - totals.afterDisc)}
                  </span>
                </div>
              )}

              {(() => {
                const c = customers.find((x) => x.id === q.customer_id);
                return c?.tax_exempt ? (
                  <div className="flex items-center gap-2 text-xs text-purple-600 font-semibold bg-purple-50 border border-purple-100 rounded-lg px-3 py-1.5">
                    <span>✓ Tax Exempt Customer</span>
                    {c.tax_id && (
                      <span className="text-purple-400">· {c.tax_id}</span>
                    )}
                  </div>
                ) : null;
              })()}

              <div className="flex justify-between items-center text-sm gap-2">
                <span className="text-slate-500 whitespace-nowrap">Tax Rate</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.001"
                    value={q.tax_rate}
                    onChange={(e) => setQ({ ...q, tax_rate: e.target.value })}
                    className="w-20 text-sm text-right border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                  <span className="text-slate-400 text-xs">%</span>
                </div>
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Tax</span>
                <span className="font-semibold text-slate-700">
                  {fmtMoney(totals.tax)}
                </span>
              </div>

              <div className="border-t border-slate-200 pt-2.5 flex justify-between items-center">
                <span className="font-bold text-slate-800">Total</span>
                <span className="font-bold text-2xl text-slate-900">
                  {fmtMoney(totals.total)}
                </span>
              </div>

              <div className="flex justify-between items-center gap-2 bg-indigo-50 rounded-xl px-3 py-2 border border-indigo-100">
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={Number(q.deposit_pct) > 0}
                      onChange={(e) =>
                        setQ({
                          ...q,
                          deposit_pct: e.target.checked ? 50 : 0,
                        })
                      }
                      className="accent-indigo-600"
                    />
                    <span className="text-indigo-700 font-semibold text-xs">Deposit</span>
                  </label>
                  {Number(q.deposit_pct) > 0 && (
                    <>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={q.deposit_pct}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          setQ({ ...q, deposit_pct: Number.isFinite(v) ? Math.max(1, Math.min(100, v)) : 50 });
                        }}
                        className="w-10 text-xs text-center border border-indigo-200 rounded px-1 py-0.5 bg-white focus:outline-none"
                      />
                      <span className="text-indigo-400 text-xs">%</span>
                    </>
                  )}
                </div>
                {Number(q.deposit_pct) > 0 && (
                  <span className="font-bold text-indigo-800">
                    {fmtMoney(totals.deposit)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex-wrap">
          {saveError && (
            <div className="w-full text-sm text-red-600 font-semibold bg-red-50 border border-red-200 rounded-xl px-4 py-2">
              {saveError}
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 rounded-xl transition"
          >
            {saving ? "Saving…" : "Save Quote"}
          </button>
          <button
            onClick={onClose}
            className="px-5 border border-slate-200 text-slate-500 text-sm font-semibold py-2.5 rounded-xl hover:bg-slate-100 transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}