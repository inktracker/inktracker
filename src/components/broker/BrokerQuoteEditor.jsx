import { useMemo, useState } from "react";
import {
  calcQuoteTotals,
  calcLinkedLinePrice,
  buildLinkedQtyMap,
  getQty,
  fmtMoney,
  tod,
  uid,
  newLineItem,
  BROKER_MARKUP,
  STANDARD_MARKUP,
} from "../shared/pricing";
import { exportQuoteToPDF } from "../shared/pdfExport";
import BrokerLineItemEditor from "./BrokerLineItemEditor";
import { Download } from "lucide-react";

const DEFAULT_EXTRAS_META = [
  { key: "colorMatch", label: "Pantone Match", rate: 1.0 },
  { key: "difficultPrint", label: "Difficult Print", rate: 0.5 },
  { key: "waterbased", label: "Water-Based Ink", rate: 1.0 },
  { key: "tags", label: "Custom Tags", rate: 1.5 },
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
    quote_id: `Q-${new Date().getFullYear()}-${String(
      Math.floor(Math.random() * 900) + 100
    )}`,
    customer_id: "",
    customer_name: "",
    date: tod(),
    due_date: addBusinessDays(new Date(), 10),
    status: "Draft",
    notes: "",
    rush_rate: 0,
    extras: {
      colorMatch: false,
      difficultPrint: false,
      waterbased: false,
      tags: false,
    },
    line_items: [newLineItem()],
    discount: 0,
    tax_rate: 0,
    deposit_pct: 0,
    deposit_paid: false,
    selected_artwork: [],
  };
}

function withBrokerDefaults(quote) {
  return {
    ...quote,
    status: quote?.status || "Draft",
    tax_rate: 0,
    selected_artwork: quote?.selected_artwork || [],
  };
}

export default function BrokerQuoteEditor({
  quote,
  customers,
  onSave,
  onClose,
  onAddCustomer,
  shopAddons,
  shop,
  broker,
}) {
  const addonsMeta = shopAddons?.length ? shopAddons : DEFAULT_EXTRAS_META;
  const [q, setQ] = useState(() => {
    if (quote) return withBrokerDefaults(quote);
    const base = blankQuote();
    // Build extras keys from addonsMeta
    const extrasKeys = (shopAddons?.length ? shopAddons : DEFAULT_EXTRAS_META).map((a) => a.key);
    const extras = {};
    extrasKeys.forEach((k) => { extras[k] = false; });
    return { ...base, extras };
  });
  const [showNewClient, setShowNewClient] = useState(false);
  const [isAddingClient, setIsAddingClient] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [nc, setNc] = useState({
    name: "",
    company: "",
    email: "",
    phone: "",
    address: "",
    notes: "",
  });

  const selectedCustomer = customers.find((c) => c.id === q.customer_id);
  const isTaxExempt = selectedCustomer?.tax_exempt || false;
  const clientArtwork = selectedCustomer?.artwork_files || [];

  const brokerQuote = useMemo(
    () => ({
      ...q,
      tax_rate: 0,
    }),
    [q]
  );

  const totals = calcQuoteTotals(brokerQuote, BROKER_MARKUP);
  const retailTotals = calcQuoteTotals(
    {
      ...q,
      tax_rate: 0,
    },
    STANDARD_MARKUP
  );

  const brokerProfit = Math.max(0, retailTotals.total - totals.total);
  const brokerRemaining = Math.max(0, totals.total - totals.deposit);
  const retailRemaining = Math.max(0, retailTotals.total - retailTotals.deposit);

  const selectedArtworkIds = useMemo(
    () => new Set((q.selected_artwork || []).map((a) => a.id)),
    [q.selected_artwork]
  );

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
    if (!nc.name.trim() || isAddingClient) return;

    try {
      setIsAddingClient(true);

      const payload = {
        orders: 0,
        tax_exempt: false,
        ...nc,
      };

      const savedClient = await onAddCustomer(payload);

      if (!savedClient?.id) {
        throw new Error("Client was not saved correctly.");
      }

      setQ((prev) => ({
        ...prev,
        customer_id: savedClient.id,
        customer_name: savedClient.name || payload.name,
        customer_email: savedClient.email || payload.email || "",
        selected_artwork: [],
      }));

      setShowNewClient(false);
      setNc({
        name: "",
        company: "",
        email: "",
        phone: "",
        address: "",
        notes: "",
      });
    } catch (error) {
      console.error("Failed to add client:", error);
      alert("There was a problem adding the client. Please try again.");
    } finally {
      setIsAddingClient(false);
    }
  }

  function toggleArtwork(art) {
    const exists = selectedArtworkIds.has(art.id);

    setQ((prev) => ({
      ...prev,
      selected_artwork: exists
        ? (prev.selected_artwork || []).filter((a) => a.id !== art.id)
        : [
            ...(prev.selected_artwork || []),
            {
              id: art.id,
              name: art.name,
              url: art.url,
              type: art.type || "",
              note: art.note || "",
            },
          ],
    }));
  }

  async function runSave(status) {
    setSaveError("");
    if (!q.customer_id) {
      setSaveError("Please pick a client before saving.");
      return;
    }
    const hasAnyQty = (q.line_items || []).some(
      (li) => Object.values(li.sizes || {}).reduce((s, v) => s + (parseInt(v, 10) || 0), 0) > 0
    );
    if (!hasAnyQty) {
      setSaveError("Add at least one line item with a quantity.");
      return;
    }
    setSaving(true);
    try {
      // Stamp each line item with computed pricing
      const linkedQtyMap = buildLinkedQtyMap(q.line_items || []);
      const stampedItems = (q.line_items || []).map(li => {
        const qty = getQty(li);
        const r = calcLinkedLinePrice(li, q.rush_rate, q.extras, STANDARD_MARKUP, linkedQtyMap);
        if (!r || !qty) return li;
        return { ...li, _ppp: r.ppp, _lineTotal: r.ppp * qty, _rushFee: r.rushFee };
      });
      // Compute totals from stamped line items — one source of truth
      const lineSubtotal = stampedItems.reduce((s, li) => s + (li._lineTotal || 0), 0);
      const rushTotal = stampedItems.reduce((s, li) => s + (li._rushFee || 0), 0);
      const sub = Math.round((lineSubtotal + rushTotal) * 100) / 100;

      await onSave({
        ...q,
        line_items: stampedItems,
        status,
        tax_rate: 0,
        tax_exempt: isTaxExempt,
        subtotal: sub,
        tax: 0,
        total: sub,
        selected_artwork: q.selected_artwork || [],
      });
    } catch (err) {
      console.error("[BrokerQuoteEditor] save failed:", err);
      setSaveError(err?.message || "Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleSaveDraft() { runSave("Draft"); }
  function handleSubmitToShop() { runSave("Pending"); }

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
                  Client *
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
                        customer_email: c ? (c.email || "") : "",
                        selected_artwork: [],
                      });
                    }}
                    className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  >
                    <option value="">Select client…</option>
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
                      placeholder: "123 Main St",
                    },
                    {
                      key: "notes",
                      label: "Notes",
                      placeholder: "Terms, preferences…",
                    },
                  ].map((f) => (
                    <div key={f.key}>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                        {f.label}
                      </label>
                      <input
                        type={f.type || "text"}
                        value={nc[f.key]}
                        onChange={(e) =>
                          setNc({ ...nc, [f.key]: e.target.value })
                        }
                        placeholder={f.placeholder}
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      />
                    </div>
                  ))}
                </div>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={nc.tax_exempt || false}
                    onChange={e => setNc({ ...nc, tax_exempt: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-300 accent-indigo-600" />
                  <span className="text-sm text-slate-600">Tax Exempt</span>
                </label>

                <button
                  onClick={handleAddClient}
                  disabled={isAddingClient}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
                >
                  {isAddingClient ? "Adding Client..." : "Add Client & Select"}
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
                      <div
                        className={`text-xs font-bold ${
                          isOn ? "text-indigo-700" : "text-slate-700"
                        }`}
                      >
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
              <BrokerLineItemEditor
                key={li.id}
                li={li}
                rushRate={q.rush_rate}
                extras={q.extras}
                allLineItems={q.line_items}
                savedImprints={selectedCustomer?.saved_imprints || []}
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
              <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                Your Broker Price
              </div>

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
                <>
                  <div className="flex justify-between text-sm text-emerald-600">
                    <span>Savings</span>
                    <span className="font-semibold">
                      −{fmtMoney(totals.sub - totals.afterDisc)}
                    </span>
                  </div>

                  <div className="flex justify-between text-sm text-slate-500">
                    <span>Discounted Subtotal</span>
                    <span className="font-semibold text-slate-700">
                      {fmtMoney(totals.afterDisc)}
                    </span>
                  </div>
                </>
              )}

              <div className="flex justify-between items-center text-sm gap-2">
                <span className="text-slate-500 whitespace-nowrap">Tax Rate</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.001"
                    value={0}
                    disabled
                    className="w-20 text-sm text-right border border-slate-200 rounded-lg px-2 py-1 bg-slate-100 text-slate-400"
                  />
                  <span className="text-slate-400 text-xs">%</span>
                </div>
              </div>

              <div className="flex justify-between text-xs text-slate-400 italic">
                <span>Tax</span>
                <span>{fmtMoney(0)}</span>
              </div>

              <div className="border-t border-slate-200 pt-2.5 flex justify-between items-center">
                <span className="font-bold text-slate-800">Your Price</span>
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

              {Number(q.deposit_pct) > 0 && (
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Remaining Balance</span>
                  <span className="font-semibold text-slate-700">
                    {fmtMoney(brokerRemaining)}
                  </span>
                </div>
              )}

              <div className="mt-3 border-t border-slate-200 pt-3 space-y-1.5">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                    Shop Rate
                  </div>
                  {isTaxExempt && (
                    <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                      Tax Exempt
                    </span>
                  )}
                </div>

                <div className="flex justify-between text-xs text-slate-500">
                  <span>Subtotal</span>
                  <span>{fmtMoney(retailTotals.sub)}</span>
                </div>

                {parseFloat(q.discount) > 0 && (
                  <>
                    <div className="flex justify-between text-xs text-emerald-600">
                      <span>Savings</span>
                      <span className="font-semibold">
                        −{fmtMoney(retailTotals.sub - retailTotals.afterDisc)}
                      </span>
                    </div>

                    <div className="flex justify-between text-xs text-slate-500">
                      <span>Discounted Subtotal</span>
                      <span>{fmtMoney(retailTotals.afterDisc)}</span>
                    </div>
                  </>
                )}

                <div className="flex justify-between text-xs text-slate-500">
                  <span>Tax</span>
                  <span>{fmtMoney(retailTotals.tax)}</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-emerald-700">
                    Client Total
                  </span>
                  <span className="text-base font-bold text-emerald-700">
                    {fmtMoney(retailTotals.total)}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 italic">
                  Edit the per-piece price on each line to adjust the client total.
                </div>

                <div className="flex justify-between text-xs text-slate-500">
                  <span>Deposit</span>
                  <span>{fmtMoney(retailTotals.deposit)}</span>
                </div>

                <div className="flex justify-between text-xs text-slate-500">
                  <span>Remaining Balance</span>
                  <span>{fmtMoney(retailRemaining)}</span>
                </div>

                <div className="flex justify-between items-center border-t border-slate-200 pt-2 mt-2">
                  <span className="text-xs font-bold text-violet-700">
                    Total Broker Profit
                  </span>
                  <span className="text-base font-bold text-violet-700">
                    {fmtMoney(brokerProfit)}
                  </span>
                </div>
              </div>
            </div>
          </div>


        </div>

        <div className="px-6 pt-3 bg-slate-50 border-t border-slate-200">
          {saveError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              {saveError}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-3 px-6 py-4 bg-slate-50 rounded-b-2xl">
          <button
            onClick={handleSaveDraft}
            disabled={saving}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-semibold py-2.5 rounded-xl transition"
          >
            {saving ? "Saving…" : "Save Draft"}
          </button>

          <button
            onClick={handleSubmitToShop}
            disabled={saving}
            className="px-5 border border-indigo-200 text-indigo-600 text-sm font-semibold py-2.5 rounded-xl hover:bg-indigo-50 transition disabled:opacity-50"
          >
            {saving ? "Submitting…" : "Submit to Shop"}
          </button>

          <button
            onClick={() => exportQuoteToPDF({ ...q, broker_id: broker?.email || "broker" }, {
              mode: "shop",
              shopName: shop?.shop_name || "",
              logoUrl: shop?.logo_url || "",
            })}
            className="inline-flex items-center gap-1.5 px-4 border border-slate-300 text-slate-600 text-sm font-semibold py-2.5 rounded-xl hover:bg-slate-100 transition"
            title="Download full internal shop form"
          >
            <Download className="w-3.5 h-3.5" /> Shop Form
          </button>

          <button
            onClick={() => exportQuoteToPDF(q, {
              mode: "client",
              shopName: broker?.company_name || broker?.display_name || broker?.full_name || "",
            })}
            className="inline-flex items-center gap-1.5 px-4 border border-slate-300 text-slate-600 text-sm font-semibold py-2.5 rounded-xl hover:bg-slate-100 transition"
            title="Download clean client-facing version"
          >
            <Download className="w-3.5 h-3.5" /> Client Form
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