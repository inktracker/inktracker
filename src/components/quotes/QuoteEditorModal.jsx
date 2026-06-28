import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { base44, supabase } from "@/api/supabaseClient";
import {
  Q_STATUSES,
  calcQuoteTotals,
  calcLinkedLinePrice,
  buildLinkedQtyMap,
  getLineExtras,
  calcSetupFees,
  getShopPricingConfig,
  loadShopPricingConfig,
  getQty,
  fmtMoney,
  tod,
  uid,
  newLineItem,
  getStandardTurnaroundDays,
  getRushTiers,
  getRushRateForDaysOut,
  buildQBInvoicePayload,
} from "../shared/pricing";
import { isBrokerQuote } from "@/lib/quotes/customerFacingQuote";
import { normalizeShipTo, isShipToComplete } from "@/lib/tax/address";
import { buildAddonsByScope, getActiveAddonLabels } from "@/lib/pricing/extrasScopes";
import { sumAdditionalCharges, normalizeAdditionalCharges } from "@/lib/pricing/additionalCharges";
import { roundedQuoteTotals } from "@/lib/pricing/quoteRounding";
import LineItemEditor from "./LineItemEditor";
import { shopScope } from "@/lib/shopScope";

const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

// Hard-coded fallback used until the shop's own pricing_config loads
// (or for shops that haven't customized their extras at all). Every
// entry uses `mode: "flat"` because the historical UI was flat-only;
// once the shop saves their config the live values + modes take over.
const DEFAULT_ADDONS = [
  { key: "tags",           label: "Custom Tags",      rate: 1.5, mode: "flat" },
  { key: "difficultPrint", label: "Difficult Print",  rate: 0.5, mode: "flat" },
  { key: "colorMatch",     label: "Ink Color Match",  rate: 1.0, mode: "flat" },
  { key: "waterbased",     label: "Water-Based Ink",  rate: 1.0, mode: "flat" },
];

// Friendly default labels for the standard keys so a freshly-saved
// shop's extras render with sensible names before they customize.
const DEFAULT_LABELS = {
  tags:           "Custom Tags",
  difficultPrint: "Difficult Print",
  colorMatch:     "Ink Color Match",
  waterbased:     "Water-Based Ink",
};

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

function blankQuote(defaultTaxRate = 8.265) {
  return {
    quote_id: `Q-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-4)}`,
    customer_id: "",
    customer_name: "",
    job_title: "",
    date: tod(),
    due_date: addBusinessDays(new Date(), getStandardTurnaroundDays()),
    expires_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    status: "Draft",
    notes: "",
    rush_rate: 0,
    extras: {},
    line_items: [newLineItem()],
    discount: 0,
    discount_type: "percent",
    tax_rate: defaultTaxRate,
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
  defaultTaxRate,
}) {
  const [q, setQ] = useState(() => {
    const base = quote ? { ...quote } : blankQuote(defaultTaxRate || 8.265);
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
  // Per-technique addons. `root` seeds with the Screen Print defaults
  // so the legacy fee buttons render before the shop's pricing_config
  // loads; embroidery + custom start empty (no defaults outside Screen
  // Print) and the load effect below replaces with the live data.
  const [addonsByScope, setAddonsByScope] = useState({
    root: DEFAULT_ADDONS,
    embroidery: [],
    custom: {},
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  // "Calculate tax" — fetch QB's authoritative tax for the ship-to and fill the
  // rate, so the quote matches what QB will charge (no send-time hold).
  const [calcTax, setCalcTax] = useState({ loading: false, error: "", result: null });
  // Inline ship-to editor — edit the selected customer's ship-to address right
  // here (it drives the tax), instead of leaving to Customers → edit. Persisted
  // back to the customer on calculate/save.
  const [shipTo, setShipTo] = useState(null);
  const [savingShipTo, setSavingShipTo] = useState(false);

  // Paste Order: paste an email/spreadsheet and have the parser prefill
  // line_items. Hidden 2026-06-02 for customer-facing release — parser
  // still misclassifies enough edge cases to generate support load.
  //
  // Internal-only override for testing without flipping the whole shop:
  //   Visit any quote modal once with `?paste=1` in the URL → sets a
  //   localStorage flag → button stays visible for THIS browser/profile
  //   indefinitely.
  // To turn off: visit with `?paste=0`, or run
  //   `localStorage.removeItem('inktracker.devtools.pasteOrder')`
  // in the browser console.
  //
  // Persists across sessions but not across browsers/devices, which is
  // exactly what we want for an internal-test flag (nothing leaks to
  // a real shop without them deliberately opting in via URL).
  const PASTE_FLAG_KEY = "inktracker.devtools.pasteOrder";
  const [pasteOrderEnabled, setPasteOrderEnabled] = useState(false);
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const override = sp.get("paste");
      if (override === "1") window.localStorage.setItem(PASTE_FLAG_KEY, "1");
      if (override === "0") window.localStorage.removeItem(PASTE_FLAG_KEY);
      setPasteOrderEnabled(window.localStorage.getItem(PASTE_FLAG_KEY) === "1");
    } catch {
      // localStorage blocked (private mode) — feature stays off, which
      // is the conservative default.
    }
  }, []);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasting, setPasting] = useState(false);
  const [pasteError, setPasteError] = useState("");

  const totals = calcQuoteTotals(q);

  // Setup fees layered on top of the line-item totals. Computed live in
  // the editor; stamped onto the saved quote at handleSave time so
  // viewers read the static `setup_total` (snapshot invariant).
  const setupFeesConfig = getShopPricingConfig()?.setupFees || {};
  const setupFees = calcSetupFees({
    lineItems: q.line_items,
    override: Number.isInteger(q.setup_screens_override) ? q.setup_screens_override : undefined,
    isReorder: !!q.is_reorder,
    skippedFeeIds: q.setup_skipped_fee_ids || [],
    config: setupFeesConfig,
  });
  // All shop-configured fees, including the skipped ones, so the editor
  // can render every fee as a toggleable row (skipped ones show with
  // strike-through, not hidden).
  const allFeeItems = (setupFeesConfig.items || []);
  const skippedSet = new Set(q.setup_skipped_fee_ids || []);
  const autoScreenCount = setupFees.enabled ? (
    Number.isInteger(q.setup_screens_override) ? q.setup_screens_override : setupFees.screens
  ) : 0;
  // Additional fees — one-off named charges (shipping, rush, etc). Taxable
  // charges join the taxed base; non-taxable charges are added after tax.
  const addl = sumAdditionalCharges(q.additional_charges);
  // Single rounding contract (shared with the save path) so the previewed
  // total is exactly what gets stored and the column foots. Discounts apply to
  // the line subtotal only; setup + taxable fees join the taxed base;
  // non-taxable fees are added after tax.
  const _rt = roundedQuoteTotals({
    sub: totals.sub,
    discount: q.discount,
    discountType: q.discount_type,
    setup: setupFees.total,
    addlTaxable: addl.taxable,
    addlNonTax: addl.nonTaxable,
    taxRate: q.tax_rate,
  });
  const taxableBaseWithSetup = _rt.taxableBase;
  const taxWithSetup = _rt.tax;
  const totalWithSetup = _rt.total;

  useEffect(() => {
    async function loadUser() {
      try {
        const currentUser = await base44.auth.me();
        setUser(currentUser);
        // Load addons. Source of truth is pricing_config: root extras
        // (+ extraLabels + extraModes) for Screen Print, embroidery.*
        // for Embroidery, custom_techniques[name].* for custom methods.
        // Per-line resolution by technique happens in LineItemEditor
        // via getAddonsForTechnique. Legacy shops.addons is a separate
        // column kept around for safety but no longer populated.
        try {
          const shops = await base44.entities.Shop.filter({ owner_email: shopScope(currentUser) });
          const cfg = shops?.[0]?.pricing_config;
          // Hydrate the module-level pricing config for THIS shop so
          // getEnabledTechniques() (technique dropdown) reflects the shop's
          // real enabled methods — including Embroidery — when editing. Without
          // this the editor relied on login-time hydration, which is stale/absent
          // for brokers, hard refreshes, or any path that skipped AuthContext.
          // A shop that enabled embroidery would otherwise see it vanish from the
          // dropdown on edit. Mirrors QuoteRequest.jsx's anon-wizard hydration.
          if (cfg) loadShopPricingConfig(cfg);
          if (cfg && (cfg.extras || cfg.embroidery?.extras || cfg.custom_techniques)) {
            setAddonsByScope(buildAddonsByScope(cfg, DEFAULT_LABELS));
          } else if (shops?.[0]?.addons?.length) {
            // Legacy fall-through: a few early shops have shops.addons
            // populated but no pricing_config.extras yet. Only seeds
            // the root scope — embroidery/custom stay empty.
            setAddonsByScope({
              root: shops[0].addons
                .map(a => ({ ...a, rate: parseFloat(a.rate) || 0, mode: a.mode === "percent" ? "percent" : "flat" }))
                .sort((a, b) => (a.label || "").localeCompare(b.label || "", undefined, { sensitivity: 'base' })),
              embroidery: [],
              custom: {},
            });
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

  // Load the selected customer's ship-to into the inline editor when the
  // customer changes (read-once per customer; user edits are local until saved).
  useEffect(() => {
    const c = customers.find((x) => x.id === q.customer_id);
    setShipTo(c ? normalizeShipTo(c.ship_to_address) : null);
    setCalcTax({ loading: false, error: "", result: null });
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

  // Send the pasted text to emailScanner.parseOnly, then merge the returned
  // line items into the modal's state. The user reviews + edits + saves
  // through the normal flow — no quote is created until they click Save.
  async function handlePasteOrder() {
    if (!pasteText.trim()) {
      setPasteError("Paste some text first.");
      return;
    }
    setPasting(true);
    setPasteError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setPasteError("Not signed in. Please refresh and try again.");
        return;
      }
      const { data, error: invErr } = await base44.functions.invoke("emailScanner", {
        action: "parseOnly",
        text: pasteText,
        accessToken: session.access_token,
      });
      if (invErr) {
        setPasteError(invErr.message || "Failed to parse");
        return;
      }
      if (data?.error) {
        setPasteError(data.error);
        return;
      }
      const parsed = (data.lineItems || []).map((li) => ({ ...newLineItem(), ...li }));
      if (parsed.length === 0) {
        setPasteError("Couldn't extract any line items from the text. Try adding more detail (sizes, garment names, style numbers).");
        return;
      }

      // If the backend wasn't confident this was a quote-request format,
      // keep going — we still want to apply whatever customer / notes data
      // it did pick up, since the user may just be jotting context first.
      const lowConfidence = data.isQuoteRequest === false;

      // The lookup happens inside LineItemEditor itself when an item mounts
      // with a style # but no resolved brand — see the autoLookup useEffect
      // there. This way the brand dropdown shows up populated with all
      // matching brands and the user can pick the right one.
      const finalItems = parsed;

      // Merge: replace existing items if the only one is blank, otherwise append.
      setQ((prev) => {
        const onlyBlank =
          prev.line_items.length === 1 &&
          !prev.line_items[0].style &&
          !prev.line_items[0].brand &&
          Object.keys(prev.line_items[0].sizes || {}).length === 0;

        // Build a header block summarizing the email's intent so it's the
        // first thing visible in Job Notes.
        const headerLines = [];
        if (data.summary) headerLines.push(data.summary);
        if (data.inHandsDate) headerLines.push(`In-hands: ${data.inHandsDate}`);
        if (data.phone) headerLines.push(`Phone: ${data.phone}`);
        if (data.company) headerLines.push(`Company: ${data.company}`);
        const header = headerLines.join("\n");

        return {
          ...prev,
          line_items: onlyBlank ? finalItems : [...prev.line_items, ...finalItems],
          // Customer info — only set if not already populated
          ...(!prev.customer_name && data.customerName ? { customer_name: data.customerName } : {}),
          ...(!prev.customer_email && data.customerEmail ? { customer_email: data.customerEmail } : {}),
          // Job title — pull from summary if blank
          ...(!prev.job_title && data.summary ? { job_title: data.summary.slice(0, 80) } : {}),
          // In-hands date — only override if currently the auto-default
          ...(data.inHandsDate ? { due_date: data.inHandsDate } : {}),
          // Rush flag
          ...(data.rushNeeded && !prev.rush_rate ? { rush_rate: 0.2 } : {}),
          // Notes — prepend the parsed header, then any existing notes, then the raw paste body
          notes: [header, prev.notes, data.notes].filter(Boolean).join("\n\n").trim(),
        };
      });

      setPasteText("");
      setShowPaste(false);
      if (lowConfidence) {
        // soft toast — the prefill landed but parser wasn't sure
        setPasteError("");
      }
    } catch (err) {
      console.error("Paste Order failed:", err);
      setPasteError(err.message || "Something went wrong.");
    } finally {
      setPasting(false);
    }
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
      company: saved.company || "",
      tax_rate: saved.tax_exempt ? 0 : prev.tax_rate || defaultTaxRate || 8.265,
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

  // Ask QuickBooks to calculate the real sales tax for this quote's ship-to
  // (a non-posting Estimate round-trip) and fill the rate, so the quote shows
  // exactly what QB will charge — no send-time hold. Non-broker only.
  async function handleCalculateTax() {
    setCalcTax({ loading: true, error: "", result: null });
    try {
      const cust = customers.find((c) => c.id === q.customer_id);
      if (!cust) throw new Error("Pick a customer first — QuickBooks needs their ship-to address.");
      const ship = normalizeShipTo(shipTo);
      if (!isShipToComplete(ship)) {
        throw new Error("Enter the ship-to state + ZIP below so QuickBooks can source the right tax.");
      }
      if ((q.line_items || []).every((li) => getQty(li) === 0)) {
        throw new Error("Add at least one line item before calculating tax.");
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not signed in.");
      // Persist the (possibly just-edited) ship-to back to the customer so it
      // sticks for next time — best-effort, don't block the calc on it.
      try { await base44.entities.Customer.update(cust.id, { ship_to_address: ship }); } catch { /* non-fatal */ }
      const invoicePayload = buildQBInvoicePayload(q);
      const { data, error: invErr } = await base44.functions.invoke("qbSync", {
        action: "estimateTax",
        accessToken: session.access_token,
        quote: q,
        customer: {
          id: cust.id,
          name: cust.name,
          email: cust.email || q.customer_email || "",
          company: cust.company || "",
          address: cust.address || "",
          qb_customer_id: cust.qb_customer_id || "",
          ship_to_address: ship,
          tax_exempt: cust.tax_exempt || false,
          exemption_expires_at: cust.exemption_expires_at || null,
          exemption_states: cust.exemption_states || null,
        },
        invoicePayload,
      });
      if (invErr) {
        let msg = invErr.message;
        try { const b = await invErr.context?.json?.(); msg = b?.error || msg; } catch { /* fall back */ }
        throw new Error(msg || "Couldn't reach QuickBooks. Try again.");
      }
      if (data?.error) throw new Error(data.error);
      const rate = Number(data.effectiveRate || 0);
      setQ((prev) => ({ ...prev, tax_rate: rate }));
      setCalcTax({
        loading: false,
        error: "",
        result: { tax: Number(data.tax || 0), rate, exempt: !!data.exempt, state: ship.state },
      });
    } catch (e) {
      setCalcTax({ loading: false, error: e.message || "Tax calculation failed.", result: null });
    }
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

      // Stamp each line item with computed pricing so every view reads saved numbers
      const linkedQtyMap = buildLinkedQtyMap(q.line_items || []);
      // Add-on label display is a shop-wide opt-in (Account → Pricing). Snapshot
      // the active add-on labels onto each line at save so EVERY view — including
      // the anon customer page, which has no pricing_config — can render them
      // without a live config lookup. Off → empty array (hidden, the default).
      const savePc = getShopPricingConfig();
      const showAddonLabels = !!savePc?.show_addons_in_description;
      const stampedItems = (q.line_items || []).map(li => {
        const qty = getQty(li);
        // Per-line add-ons (li.extras) — NOT q.extras. The 2026-06-04 per-line
        // extras move left this stamp on the legacy quote-level field, so
        // per-line add-ons (Pantone Match, Water-Based Ink, …) toggled on in the
        // editor were silently dropped from the SAVED line total ("not sticking"):
        // the live preview uses getLineExtras, but the snapshot read q.extras.
        const r = calcLinkedLinePrice(li, q.rush_rate, getLineExtras(li, q), undefined, linkedQtyMap);
        if (!r || !qty) return li;
        // Respect clientPpp override if set
        const override = Number(li?.clientPpp);
        const hasOverride = Number.isFinite(override) && override > 0;
        const ppp = hasOverride ? override : r.ppp;
        const lineTotal = ppp * qty;
        const rushFee = hasOverride ? 0 : r.rushFee;
        return {
          ...li,
          _ppp: ppp,
          _lineTotal: lineTotal,
          _rushFee: rushFee,
          _addon_labels: showAddonLabels ? getActiveAddonLabels(li, q, savePc) : [],
        };
      });
      // Compute totals from stamped line items — one source of truth
      const lineSubtotal = stampedItems.reduce((s, li) => s + (li._lineTotal || 0), 0);
      const rushTotal = stampedItems.reduce((s, li) => s + (li._rushFee || 0), 0);
      const sub = Math.round((lineSubtotal + rushTotal) * 100) / 100;

      // Setup fees — snapshotted onto the quote at save time so all
      // downstream viewers (customer, broker, invoice, QB sync) read
      // the same numbers without depending on per-viewer pricing config.
      const setupSnap = calcSetupFees({
        lineItems: stampedItems,
        override: Number.isInteger(q.setup_screens_override) ? q.setup_screens_override : undefined,
        isReorder: !!q.is_reorder,
        skippedFeeIds: q.setup_skipped_fee_ids || [],
        config: getShopPricingConfig()?.setupFees || {},
      });
      const setupTotalSnap = Math.round(setupSnap.total * 100) / 100;

      // Additional fees snapshot — drop half-typed rows, split by taxable.
      const addlSnap = sumAdditionalCharges(q.additional_charges);

      // Round once per component via the shared contract (same one the live
      // preview uses) so the stored total matches the true math and the
      // displayed lines foot. Discounts apply to the line subtotal only; setup
      // + taxable fees join the taxed base; non-taxable fees are added post-tax.
      const _rt = roundedQuoteTotals({
        sub,
        discount: q.discount,
        discountType: q.discount_type,
        setup: setupTotalSnap,
        addlTaxable: addlSnap.taxable,
        addlNonTax: addlSnap.nonTaxable,
        taxRate: q.tax_rate,
      });
      const tax = _rt.tax;
      const total = _rt.total;

      const stampedQuote = { ...q, line_items: stampedItems };
      await onSave({
        ...stampedQuote,
        subtotal: sub,
        setup_total: setupTotalSnap,
        is_reorder: !!q.is_reorder,
        setup_screens_override: Number.isInteger(q.setup_screens_override) ? q.setup_screens_override : null,
        setup_skipped_fee_ids: q.setup_skipped_fee_ids || [],
        // Save the per-fee breakdown so customer views can render the
        // itemized lines without re-resolving against shop config that
        // might have drifted since the quote was sent.
        setup_fee_breakdown: { screens: setupSnap.screens, items: setupSnap.items },
        // Normalized one-off charges so customer/PDF views render the same
        // itemized lines without recomputing.
        additional_charges: normalizeAdditionalCharges(q.additional_charges),
        tax,
        total,
      });
    } catch (err) {
      setSaveError(err.message || "Failed to save quote. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // Render via Portal at document.body so the backdrop's `fixed` is
  // positioned relative to the true viewport — not any ancestor that
  // might have transform/filter/contain CSS creating a containing
  // block. Previously the backdrop appeared to start "slightly low"
  // because the surrounding Layout/Routes hierarchy was producing
  // exactly that effect.
  return createPortal(
    <div
      className="fixed bg-slate-900/70 backdrop-blur-sm z-[60] flex items-start justify-center p-4 overflow-auto"
      style={{ top: 0, left: 0, right: 0, bottom: 0, width: "100vw", height: "100vh" }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-5xl my-4">
        <div className="flex justify-between items-center px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-t-2xl">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
              {q.quote_id}
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Quote Builder</h2>
          </div>

          <div className="flex gap-2 items-center">
            <select
              value={q.status}
              onChange={(e) => setQ({ ...q, status: e.target.value })}
              className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-900 focus:outline-none"
            >
              {Q_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>

            <button
              onClick={onClose}
              className="text-slate-500 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200 text-lg leading-none"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-6 overflow-auto" style={{ maxHeight: "80vh" }}>
          <div className="space-y-3">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              <div>
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
                        // Denormalize company onto the quote so the list/email/
                        // payment views show the shop name even when the viewer
                        // can't read the full customer record (e.g. a manager
                        // with the Customers section turned off) or it was later
                        // deleted/merged. getDisplayName still prefers the live
                        // customer record when available.
                        company: c ? (c.company || "") : "",
                        tax_rate: c?.tax_exempt ? 0 : q.tax_rate || defaultTaxRate || 8.265,
                        // Apply the client's default payment terms to this new quote
                        deposit_pct: c ? Number(c.default_deposit_pct ?? 0) : q.deposit_pct,
                      });
                    }}
                    className="flex-1 min-w-0 text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-300 truncate"
                  >
                    <option value="">Select customer…</option>
                    {[...customers]
                      .sort((a, b) => {
                        // Sort by company first, fall back to contact
                        // name. Mirrors the display order below so the
                        // visible alphabetical run lines up with the
                        // key the user is scanning for.
                        const aKey = (a.company || a.name || "").trim();
                        const bKey = (b.company || b.name || "").trim();
                        return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
                      })
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.company
                            ? `${c.company}${c.name ? ` — ${c.name}` : ""}`
                            : c.name}
                        </option>
                      ))}
                  </select>

                  <button
                    onClick={() => setShowNewClient((v) => !v)}
                    className={`flex-shrink-0 text-xs font-semibold px-3 py-2 rounded-lg border transition ${
                      showNewClient
                        ? "bg-teal-600 text-white border-teal-600"
                        : "border-teal-200 text-teal-600 hover:bg-teal-50"
                    }`}
                  >
                    {showNewClient ? "✕ Cancel" : "+ New Customer"}
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
                  className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
              </div>
            </div>

            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  Quote Date
                </label>
                <input
                  type="date"
                  value={q.date}
                  onChange={(e) => setQ({ ...q, date: e.target.value })}
                  className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300"
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
                    // Variable rush: the rate is determined by the
                    // shop's rushTiers + the days-out. Any change in
                    // due date can move the rate to a different tier
                    // (or to zero when standard).
                    const autoRate = diffDays !== null
                      ? getRushRateForDaysOut(diffDays)
                      : q.rush_rate;

                    setQ({
                      ...q,
                      due_date: due,
                      rush_rate: autoRate,
                    });
                  }}
                  className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
                {(() => {
                  if (!q.due_date || !q.date) return null;
                  const diff = Math.round((new Date(q.due_date) - new Date(q.date)) / (1000 * 60 * 60 * 24));
                  const rate = getRushRateForDaysOut(diff);
                  if (rate <= 0) return null;
                  return (
                    <div className="text-xs text-orange-500 font-semibold mt-1">
                      ⚡ Rush +{Math.round(rate * 100)}% (auto from tier table)
                    </div>
                  );
                })()}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  Quote Expires
                </label>
                <input
                  type="date"
                  value={q.expires_date || ""}
                  onChange={(e) => setQ({ ...q, expires_date: e.target.value })}
                  className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
                {q.expires_date && new Date(q.expires_date) < new Date() && (
                  <div className="text-xs text-rose-500 font-semibold mt-1">
                    This quote has expired
                  </div>
                )}
              </div>
            </div>

            {showNewClient && (
              <div className="bg-teal-50 border border-teal-200 rounded-2xl p-4 space-y-3">
                <div className="text-xs font-bold text-teal-700 uppercase tracking-widest">
                  New Client
                </div>

                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
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
                        className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-300"
                      />
                    </div>
                  ))}

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                      Notes
                    </label>
                    <textarea
                      value={nc.notes}
                      onChange={(e) => setNc({ ...nc, notes: e.target.value })}
                      placeholder="Terms, preferences…"
                      rows={2}
                      className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-300 resize-none"
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
                    className="w-4 h-4 rounded border-slate-300 accent-teal-600"
                  />
                  <span className="text-sm font-semibold text-teal-700">
                    Tax Exempt
                  </span>
                </label>

                <button
                  onClick={handleAddClient}
                  className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition w-full"
                >
                  Add Client &amp; Select
                </button>
              </div>
            )}


          </div>

          <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Turnaround
              </label>
              <div className="flex flex-wrap gap-2">
                {(() => {
                  // Build a button per tier — Standard at the loose
                  // end, then one entry per configured rush tier
                  // (sorted by tightest → loosest day count). Picking
                  // a button slides the due date to that tier's
                  // window and applies its rate. The actual rate that
                  // gets charged at render time still comes from the
                  // tier table via getRushRateForDaysOut, so the
                  // operator can also slide the due date manually
                  // and the rate follows.
                  const stdDays = getStandardTurnaroundDays();
                  const tiers = getRushTiers().slice().sort((a, b) => b.maxDays - a.maxDays); // loosest → tightest, render right-to-left tightening
                  const opts = [
                    { key: "std",       label: "Standard",                                          sub: `${stdDays} business days`,           daysOut: stdDays, rate: 0 },
                  ];
                  for (const t of tiers) {
                    // Pick a representative "days out" for the tier
                    // that's one shorter than the cliff (so 'less than 5'
                    // sets due to 4 days out).
                    const repDays = Math.max(1, t.maxDays - 1);
                    opts.push({
                      key:   `tier-${t.maxDays}`,
                      label: `Rush +${Math.round(t.rate * 100)}%`,
                      sub:   `${repDays} business day${repDays === 1 ? "" : "s"}`,
                      daysOut: repDays,
                      rate:  t.rate,
                    });
                  }
                  return opts;
                })().map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setQ({
                      ...q,
                      rush_rate: opt.rate,
                      // Slide the due date to match the picked tier's
                      // representative window. Operators were doing
                      // this by hand after every toggle change.
                      due_date: addBusinessDays(new Date(q.date || tod()), opt.daysOut),
                    })}
                    className={`flex-1 rounded-xl border-2 px-3 py-2.5 text-left transition ${
                      Math.abs((q.rush_rate || 0) - opt.rate) < 0.0001
                        ? "border-teal-600 bg-teal-50"
                        : "border-slate-200 dark:border-slate-700 hover:border-slate-300 bg-white dark:bg-slate-900"
                    }`}
                  >
                    <div
                      className={`text-sm font-bold ${
                        Math.abs((q.rush_rate || 0) - opt.rate) < 0.0001
                          ? "text-teal-700"
                          : "text-slate-700"
                      }`}
                    >
                      {opt.label}
                    </div>
                    <div className="text-xs text-slate-500">{opt.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Per-line add-ons. The quote-level toggle block that
                used to live here was removed on 2026-06-04 — each
                LineItemEditor now renders its own toggle group so a
                fee can apply to one garment without inflating every
                other line in the order. */}
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                Line Items
              </h3>
              <div className="flex items-center gap-2">
                {pasteOrderEnabled && (
                  <button
                    onClick={() => { setShowPaste((v) => !v); setPasteError(""); }}
                    className="text-xs font-semibold text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-lg hover:bg-emerald-50 transition"
                    title="Paste an email or spreadsheet to auto-fill line items"
                  >
                    📋 Paste Order
                  </button>
                )}
                <button
                  onClick={addLineItem}
                  className="text-xs font-semibold text-teal-600 border border-teal-200 px-3 py-1.5 rounded-lg hover:bg-teal-50 transition"
                >
                  + Add Garment Group
                </button>
              </div>
            </div>

            {pasteOrderEnabled && showPaste && (
              <div className="border border-emerald-200 bg-emerald-50/40 rounded-xl p-4 space-y-2">
                <div className="text-xs font-semibold text-slate-700">
                  Paste a customer email or order list — sizes, style numbers, garment names. The parser will extract line items.
                </div>
                <textarea
                  rows={8}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={"Womens Crop Tee 1580\nXS: 4\nS: 3\nM: 3\n\nMens Hammer Tee 75000\nS: 4\nM: 4\nL: 4\nXL: 2"}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-y"
                  disabled={pasting}
                />
                {pasteError && (
                  <div className="text-xs text-rose-600">{pasteError}</div>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { setShowPaste(false); setPasteText(""); setPasteError(""); }}
                    disabled={pasting}
                    className="text-xs font-semibold text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handlePasteOrder}
                    disabled={pasting || !pasteText.trim()}
                    className="text-xs font-semibold text-white bg-emerald-600 px-4 py-1.5 rounded-lg hover:bg-emerald-700 transition disabled:opacity-50"
                  >
                    {pasting ? "Parsing…" : "Parse & Prefill"}
                  </button>
                </div>
              </div>
            )}

            {q.line_items.map((li, idx) => (
              <LineItemEditor
                key={li.id}
                li={li}
                rushRate={q.rush_rate}
                extras={q.extras}
                addonsByScope={addonsByScope}
                allLineItems={q.line_items}
                savedImprints={savedImprints}
                onChange={(updated) => updateLineItem(idx, updated)}
                onRemove={() => removeLineItem(idx)}
                onDuplicate={() => duplicateLineItem(idx)}
                canRemove={q.line_items.length > 1}
              />
            ))}
          </div>

          <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Job Notes
              </label>
              <textarea
                rows={4}
                value={q.notes}
                onChange={(e) => setQ({ ...q, notes: e.target.value })}
                placeholder="Rush instructions, art notes, client communication…"
                className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-300 resize-none"
              />
            </div>

            <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-2.5">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Subtotal</span>
                <span className="font-semibold text-slate-700">
                  {fmtMoney(totals.sub)}
                </span>
              </div>

              <div className="flex justify-between items-center text-sm gap-2">
                <span className="text-slate-500 whitespace-nowrap">Discount</span>
                <div className="flex items-center gap-1">
                  {q.discount_type === "flat" && <span className="text-slate-500 text-xs">$</span>}
                  <input
                    type="number"
                    min="0"
                    max={q.discount_type === "flat" ? undefined : 100}
                    value={q.discount}
                    onChange={(e) => setQ({ ...q, discount: e.target.value })}
                    className="w-24 text-sm text-right border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-teal-300"
                  />
                  {q.discount_type !== "flat" && <span className="text-slate-500 text-xs">%</span>}
                  <button
                    onClick={() => setQ({ ...q, discount_type: q.discount_type === "flat" ? "percent" : "flat", discount: 0 })}
                    className="text-[10px] font-semibold text-teal-600 border border-teal-200 px-1.5 py-0.5 rounded hover:bg-teal-50 ml-1"
                  >
                    {q.discount_type === "flat" ? "%" : "$"}
                  </button>
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
                  <div className="flex items-center gap-2 text-xs text-teal-600 font-semibold bg-teal-50 border border-teal-100 rounded-lg px-3 py-1.5">
                    <span>✓ Tax Exempt Customer</span>
                    {c.tax_id && (
                      <span className="text-teal-400">· {c.tax_id}</span>
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
                    className="w-20 text-sm text-right border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-teal-300"
                  />
                  <span className="text-slate-500 text-xs">%</span>
                </div>
              </div>

              {/* Calculate tax from QuickBooks — fills the exact rate QB will
                  charge for the customer's ship-to (no send-time hold). Direct
                  shop quotes only; broker quotes use broker_tax_rate. The
                  ship-to is editable inline (saves back to the customer). */}
              {!isBrokerQuote(q) && q.customer_id && shipTo && (
                <div className="space-y-2 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                    Ship-To <span className="normal-case font-medium text-slate-400">— used for sales tax · saves to the customer</span>
                  </div>
                  <input
                    type="text"
                    value={shipTo.street}
                    onChange={(e) => setShipTo({ ...shipTo, street: e.target.value })}
                    placeholder="Street"
                    className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-300"
                  />
                  <div className="grid grid-cols-6 gap-2">
                    <input
                      type="text"
                      value={shipTo.city}
                      onChange={(e) => setShipTo({ ...shipTo, city: e.target.value })}
                      placeholder="City"
                      className="col-span-3 text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-300"
                    />
                    <input
                      type="text"
                      value={shipTo.state}
                      onChange={(e) => setShipTo({ ...shipTo, state: e.target.value.toUpperCase().slice(0, 2) })}
                      placeholder="ST"
                      maxLength={2}
                      className="col-span-1 text-sm uppercase border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-300"
                    />
                    <input
                      type="text"
                      value={shipTo.zip}
                      onChange={(e) => setShipTo({ ...shipTo, zip: e.target.value })}
                      placeholder="ZIP"
                      className="col-span-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-300"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleCalculateTax}
                    disabled={calcTax.loading}
                    className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-semibold text-[#2CA01C] border border-[#2CA01C]/40 hover:bg-green-50 dark:hover:bg-slate-800 rounded-lg transition disabled:opacity-50"
                  >
                    {calcTax.loading ? "Calculating…" : "Calculate tax from QuickBooks"}
                  </button>
                  {calcTax.result && (
                    <p className="text-[11px] text-emerald-600 text-right">
                      ✓ QuickBooks tax: {fmtMoney(calcTax.result.tax)} ({calcTax.result.rate}%) — filled above.
                    </p>
                  )}
                  {/* Explain a $0 result so it doesn't read as a glitch. Factual,
                      not tax advice. Only the no-nexus case (taxed, not exempt). */}
                  {calcTax.result && calcTax.result.tax === 0 && !calcTax.result.exempt && (
                    <p className="text-[11px] text-slate-500 leading-snug bg-slate-100 dark:bg-slate-800 rounded-lg px-2 py-1.5">
                      $0 — you're not registered to collect sales tax in {calcTax.result.state || "this state"} (no nexus),
                      so QuickBooks charges none. The buyer is responsible for any use tax owed in their own jurisdiction.
                      To collect here, add the state in QuickBooks → Taxes.
                    </p>
                  )}
                  {calcTax.error && (
                    <p className="text-[11px] text-amber-600">{calcTax.error}</p>
                  )}
                </div>
              )}

              {/* Setup fees — per-screen multipliers (one row per shop-
                  configured fee, each toggleable on this quote). Editable
                  screen count + reorder toggle live here so the user can
                  pair screens or correct edge cases right next to the
                  total. Only renders when the shop has enabled setup
                  fees in Account → Pricing. */}
              {setupFees.enabled && allFeeItems.length > 0 && (
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500 font-semibold">Setup</span>
                    <span className="font-semibold text-slate-700">{fmtMoney(setupFees.total)}</span>
                  </div>

                  {/* Per-fee breakdown — checkbox + label + math + line total. */}
                  <div className="space-y-1">
                    {allFeeItems.map((fee) => {
                      const skipped = skippedSet.has(fee.id);
                      const rate = q.is_reorder ? Number(fee.reorderRate) || 0 : Number(fee.rate) || 0;
                      const lineTotal = skipped ? 0 : autoScreenCount * rate;
                      return (
                        <label
                          key={fee.id}
                          className={`flex items-center gap-2 text-xs cursor-pointer select-none ${skipped ? "text-slate-300" : "text-slate-500"}`}
                          title={skipped ? "Click to include this fee" : "Click to skip this fee on this quote"}
                        >
                          <input
                            type="checkbox"
                            checked={!skipped}
                            onChange={(e) => {
                              const ids = new Set(q.setup_skipped_fee_ids || []);
                              if (e.target.checked) ids.delete(fee.id); else ids.add(fee.id);
                              setQ({ ...q, setup_skipped_fee_ids: Array.from(ids) });
                            }}
                            className="w-3.5 h-3.5 rounded border-slate-300 text-teal-600"
                          />
                          <span className={`flex-1 ${skipped ? "line-through" : ""}`}>
                            {fee.label} <span className="text-slate-500">({autoScreenCount} × {fmtMoney(rate)})</span>
                          </span>
                          <span className={`font-semibold tabular-nums ${skipped ? "" : "text-slate-700"}`}>
                            {fmtMoney(lineTotal)}
                          </span>
                        </label>
                      );
                    })}
                  </div>

                  {/* Screen count + reorder toggle — apply to all enabled fees. */}
                  <div className="border-t border-slate-100 dark:border-slate-700 pt-2 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={Number.isInteger(q.setup_screens_override) ? q.setup_screens_override : setupFees.screens}
                        onChange={(e) => {
                          const v = e.target.value;
                          setQ({ ...q, setup_screens_override: v === "" ? null : Math.max(0, parseInt(v, 10) || 0) });
                        }}
                        title="Number of screens to bill — defaults to auto-counted color count. Lower it to pair screens across designs."
                        className="w-14 text-right border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-teal-300"
                      />
                      <span>screens (applies to all fees)</span>
                      {Number.isInteger(q.setup_screens_override) && (
                        <button
                          type="button"
                          onClick={() => setQ({ ...q, setup_screens_override: null })}
                          className="text-[10px] text-teal-600 font-semibold hover:text-teal-800"
                          title="Reset to auto-counted screen count"
                        >
                          reset
                        </button>
                      )}
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={!!q.is_reorder}
                        onChange={(e) => setQ({ ...q, is_reorder: e.target.checked })}
                        className="w-3.5 h-3.5 rounded border-slate-300 text-teal-600"
                      />
                      Reorder — use reduced per-screen rates (screens already exist)
                    </label>
                  </div>
                </div>
              )}

              {/* Additional fees — one-off named charges (shipping, rush, …)
                  with a custom amount and a taxable toggle. Taxable charges
                  join the taxed base; non-taxable are added after tax. */}
              {(() => {
                const charges = Array.isArray(q.additional_charges) ? q.additional_charges : [];
                const updateCharge = (idx, patch) =>
                  setQ({ ...q, additional_charges: charges.map((c, i) => (i === idx ? { ...c, ...patch } : c)) });
                const addCharge = () =>
                  setQ({ ...q, additional_charges: [...charges, { id: `ac-${Date.now()}`, label: "", amount: "", taxable: false }] });
                const removeCharge = (idx) =>
                  setQ({ ...q, additional_charges: charges.filter((_, i) => i !== idx) });
                return (
                  <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500 font-semibold">Additional Fees</span>
                      <button
                        type="button"
                        onClick={addCharge}
                        className="text-xs text-teal-600 font-semibold hover:text-teal-800"
                      >
                        + Add fee
                      </button>
                    </div>
                    {charges.length === 0 && (
                      <p className="text-xs text-slate-500">Add shipping, rush, or other one-off charges.</p>
                    )}
                    {charges.map((c, idx) => (
                      <div key={c.id || idx} className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="e.g. Estimated shipping"
                          value={c.label ?? ""}
                          onChange={(e) => updateCharge(idx, { label: e.target.value })}
                          className="flex-1 min-w-0 text-xs border border-slate-200 dark:border-slate-700 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-300"
                        />
                        <div className="flex items-center gap-0.5">
                          <span className="text-slate-500 text-xs">$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={c.amount ?? ""}
                            onChange={(e) => updateCharge(idx, { amount: e.target.value })}
                            className="w-20 text-right text-xs border border-slate-200 dark:border-slate-700 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-teal-300"
                          />
                        </div>
                        <label
                          className="flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer select-none"
                          title="Apply sales tax to this charge"
                        >
                          <input
                            type="checkbox"
                            checked={!!c.taxable}
                            onChange={(e) => updateCharge(idx, { taxable: e.target.checked })}
                            className="w-3.5 h-3.5 rounded border-slate-300 text-teal-600"
                          />
                          Tax
                        </label>
                        <button
                          type="button"
                          onClick={() => removeCharge(idx)}
                          className="text-slate-300 hover:text-rose-500 text-lg leading-none px-1"
                          title="Remove fee"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {addl.total > 0 && (
                      <div className="flex items-center justify-between text-xs border-t border-slate-100 dark:border-slate-700 pt-1.5">
                        <span className="text-slate-500">Fees subtotal</span>
                        <span className="font-semibold text-slate-600 dark:text-slate-300">{fmtMoney(addl.total)}</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Tax</span>
                <span className="font-semibold text-slate-700">
                  {fmtMoney(taxWithSetup)}
                </span>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-700 pt-2.5 flex justify-between items-center">
                <span className="font-bold text-slate-800 dark:text-slate-200">Total</span>
                <span className="font-bold text-2xl text-slate-900 dark:text-slate-100">
                  {fmtMoney(totalWithSetup)}
                </span>
              </div>

              <div className="flex justify-between items-center gap-2 bg-teal-50 rounded-xl px-3 py-2 border border-teal-100">
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
                      className="accent-teal-600"
                    />
                    <span className="text-teal-700 font-semibold text-xs">Deposit</span>
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
                        className="w-10 text-xs text-center border border-teal-200 rounded px-1 py-0.5 bg-white dark:bg-slate-900 focus:outline-none"
                      />
                      <span className="text-teal-400 text-xs">%</span>
                    </>
                  )}
                </div>
                {Number(q.deposit_pct) > 0 && (
                  <span className="font-bold text-teal-800">
                    {fmtMoney(Math.round(totalWithSetup * (Number(q.deposit_pct) / 100) * 100) / 100)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-4 sm:px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-b-2xl flex-wrap">
          {saveError && (
            <div className="w-full text-sm text-red-600 font-semibold bg-red-50 border border-red-200 rounded-xl px-4 py-2">
              {saveError}
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 rounded-xl transition"
          >
            {saving ? "Saving…" : "Save Quote"}
          </button>
          <button
            onClick={onClose}
            className="px-5 border border-slate-200 dark:border-slate-700 text-slate-500 text-sm font-semibold py-2.5 rounded-xl hover:bg-slate-100 transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}