import { useState, useEffect, useRef } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import ReactivateLink from "../shared/ReactivateLink";
import { fmtDate, fmtMoney, calcLinkedLinePrice, buildLinkedQtyMap, getLineExtras, getQty, SIZES, buildQBInvoicePayload, getDisplayName, getShopPricingConfig } from "../shared/pricing";
import { imprintCountText } from "@/lib/quotes/imprintLabels";
import { exportInvoiceToPDF, previewPdf } from "../shared/pdfExport";
import SendInvoiceModal from "./SendInvoiceModal";
import OrderDetailModal from "../orders/OrderDetailModal";
import ModalBackdrop from "../shared/ModalBackdrop";
import MessagesTab from "../shared/MessagesTab";
import CollapsibleSection from "../shared/CollapsibleSection";
import { invoiceThreadId } from "@/lib/messageThreads";
import { resolveInvoicePdfSource } from "@/lib/invoice/resolveInvoicePdfSource";
import { MessageSquare } from "lucide-react";
import { notify } from "@/lib/notify";
import { todayInShopTz } from "@/lib/shopTimezone";
import { qbModifiedState, buildAdoptPatches, stripSyncNotes } from "@/lib/invoices/qbModifiedSync";
import ChangeHistory from "../shared/ChangeHistory";

export default function InvoiceDetailModal({ invoice, customer, onClose, onMarkPaid, onDelete, onConvertToInvoice, onAddToProduction, onInvoiceUpdated, onSendSuccess, readOnly = false, readOnlyReason = "", reactivateHref }) {
  const [loading, setLoading] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [reordered, setReordered] = useState(false);
  const [viewingOrder, setViewingOrder] = useState(null);

  const [shopName, setShopName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [shopProfile, setShopProfile] = useState(null);
  const [showSendModal, setShowSendModal] = useState(false);
  const [qbCreating, setQbCreating] = useState(false);
  const [qbStatus, setQbStatus] = useState(null);
  // Idempotency key for the QB create (NEW-10). Held in a ref so re-fires of
  // the same attempt reuse it (collapsing duplicate QB writes), while a later
  // intentional retry — after the modal re-renders fresh — gets a new key.
  const qbAttemptKeyRef = useRef(null);
  // Tri-state: null = haven't checked yet, true = order exists,
  // false = orphan (order_id set on the invoice but no matching order
  // row — e.g. order was deleted, or invoice came from a different
  // source). The "View Order" button only renders when this is true.
  const [orderExists, setOrderExists] = useState(null);

  // "Modified in QuickBooks — sync?" state. The qbWebhook keeps the
  // qb_* mirror fresh in real time; when it disagrees with the as-sold
  // total the notice below the line items offers a one-click adopt.
  // syncedInvoice overlays the prop after a successful sync so the
  // notice clears immediately even if the parent doesn't re-render.
  const [syncedInvoice, setSyncedInvoice] = useState(null);
  const [syncingQb, setSyncingQb] = useState(false);
  const activeInvoice = syncedInvoice || invoice;
  const qbModified = qbModifiedState(activeInvoice);

  // Invoice-number rename (tester 2026-07-18: "Add a way to change the
  // invoice name/number (throw a flag if its been used)"). QB-linked
  // invoices are excluded: their DocNumber lives in QuickBooks and the
  // next pull would revert a local rename — rename it in QB instead
  // and the webhook/pull mirrors it here.
  const [editingNumber, setEditingNumber] = useState(false);
  const [numberDraft, setNumberDraft] = useState("");
  const [numberFlag, setNumberFlag] = useState("");
  const [savingNumber, setSavingNumber] = useState(false);

  function startEditNumber() {
    setNumberDraft(activeInvoice.invoice_id || "");
    setNumberFlag("");
    setEditingNumber(true);
  }

  async function handleSaveInvoiceNumber() {
    const next = (numberDraft || "").trim();
    if (!next) { setNumberFlag("Invoice number can't be empty."); return; }
    if (next.length > 40) { setNumberFlag("Keep it under 40 characters."); return; }
    if (next === activeInvoice.invoice_id) { setEditingNumber(false); return; }
    setSavingNumber(true);
    setNumberFlag("");
    try {
      // The in-use flag: another invoice with this number, or a quote —
      // quote ids become invoice DocNumbers on the QB path, so reusing
      // one would tangle the pull's DocNumber matching.
      const [dupInvoices, dupQuotes] = await Promise.all([
        base44.entities.Invoice.filter({ shop_owner: activeInvoice.shop_owner, invoice_id: next }),
        base44.entities.Quote.filter({ shop_owner: activeInvoice.shop_owner, quote_id: next }).catch(() => []),
      ]);
      const clash = (dupInvoices || []).find((r) => r.id !== activeInvoice.id);
      if (clash) {
        setNumberFlag(`⚑ ${next} is already used by another invoice.`);
        return;
      }
      if ((dupQuotes || []).length > 0) {
        setNumberFlag(`⚑ ${next} is already used by a quote.`);
        return;
      }
      const updated = await base44.entities.Invoice.update(activeInvoice.id, { invoice_id: next });
      // History: the change_log DB trigger records the rename (with this
      // user as actor) — no client-side logging needed since 20260911.
      // Same overlay trick as the QB sync above: show the new number
      // immediately even if the parent list hasn't re-rendered yet.
      setSyncedInvoice({ ...activeInvoice, ...updated });
      onInvoiceUpdated?.({ ...activeInvoice, ...updated });
      setEditingNumber(false);
    } catch (err) {
      // DB backstop: the (shop_owner, invoice_id) unique index refuses
      // a race we didn't catch above.
      setNumberFlag(err?.message || "Couldn't rename the invoice.");
    } finally {
      setSavingNumber(false);
    }
  }

  const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

  async function handleSyncFromQb() {
    const ok = window.confirm(
      `Match this invoice to QuickBooks (${fmtMoney(qbModified.qbTotal)})?\n\n` +
      `QuickBooks is the billing authority and your customer is already billed this ` +
      `amount — this updates the invoice, quote, and order totals to agree. Line items ` +
      `and production details aren't changed.`
    );
    if (!ok) return;
    setSyncingQb(true);
    try {
      const patches = buildAdoptPatches(activeInvoice);
      if (!patches) throw new Error("No QuickBooks totals on this invoice yet.");

      // Quote and order first; the INVOICE row last. The "modified in
      // QB" notice is keyed off the invoice row, so a partial failure
      // leaves the notice up and re-clicking Sync retries everything
      // (all three patches are idempotent).
      let linkedQuote = null;
      if (invoice.qb_invoice_id) {
        const quotes = await base44.entities.Quote.filter({ qb_invoice_id: invoice.qb_invoice_id });
        linkedQuote = quotes?.[0] || null;
        if (linkedQuote) await base44.entities.Quote.update(linkedQuote.id, patches.quote);
      }
      const orderId = invoice.order_id || linkedQuote?.converted_order_id;
      if (orderId) {
        const orders = await base44.entities.Order.filter({ order_id: orderId });
        if (orders?.[0]) await base44.entities.Order.update(orders[0].id, patches.order);
      }
      const updated = await base44.entities.Invoice.update(invoice.id, patches.invoice);

      // History: the change_log DB triggers record the adopted totals on
      // the invoice AND the linked quote/order rows (with this user as
      // actor) — no client-side logging needed since 20260911. The
      // quickbooks-sourced row for the ORIGINAL QB-side edit still comes
      // from qbWebhook; both belong in the timeline.

      setSyncedInvoice(updated);
      onInvoiceUpdated?.(updated);
    } catch (err) {
      console.error("[InvoiceDetailModal] QB sync failed:", err);
      window.alert(`Match to QuickBooks didn't complete: ${err?.message || "unknown error"}. Click Match again to retry.`);
    } finally {
      setSyncingQb(false);
    }
  }

  // One-time check on mount: does the referenced order still exist?
  // Cheaper than discovering the orphan only when the user clicks
  // View Order and getting an "Order not found" alert.
  useEffect(() => {
    if (!invoice?.order_id) { setOrderExists(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const matches = await base44.entities.Order.filter({ order_id: invoice.order_id });
        if (cancelled) return;
        setOrderExists(Array.isArray(matches) && matches.length > 0);
      } catch (_) {
        if (!cancelled) setOrderExists(false);
      }
    })();
    return () => { cancelled = true; };
  }, [invoice?.order_id]);

  async function handleCreateInQB() {
    // Ironclad no-duplicate guard: if this invoice already has a QB
    // record, refuse to create a second one. The footer renders the
    // "View in QB" link in that case, but this internal check is the
    // backstop — never trust the UI to be the only gate.
    if (invoice.qb_invoice_id) {
      setQbStatus({
        type: "info",
        // the banner renderer reads .text — a .message key rendered as an
        // empty blue bar
        text: `This invoice is already in QuickBooks (QB ID ${invoice.qb_invoice_id}). Use "View in QB" to open it.`,
      });
      return;
    }
    // Creating the QB invoice no longer emails the customer: qbSync mints the
    // pay link via ?include=invoiceLink and we pass noEmail so the /send
    // fallback (the only path that emails) is suppressed. The customer is
    // emailed only when the shop explicitly clicks Send. So no confirm here.
    setQbCreating(true);
    setQbStatus(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not signed in");

      // Re-fetch the row before pushing: the `invoice` prop is a snapshot
      // from the list fetch, which may predate another surface's QB push
      // (order completion auto-pushes on the same screen flow). Pushing the
      // stale snapshot is what minted the INV-2026-OW0M1 -r2 duplicate —
      // its empty qb_invoice_id sent qbSync down the CREATE path. qbSync
      // now re-reads the row server-side too; this keeps the modal honest.
      let inv = invoice;
      try {
        const freshRows = await base44.entities.Invoice.filter({
          shop_owner: invoice.shop_owner,
          id: invoice.id,
        });
        if (freshRows?.length) inv = freshRows[0];
      } catch { /* fall back to the prop */ }
      if (inv.qb_invoice_id) {
        setQbStatus({
          type: "info",
          text: `This invoice is already in QuickBooks (QB ID ${inv.qb_invoice_id}). Use "View in QB" to open it.`,
        });
        return;
      }
      // The customer prop can be null (list rendered without customers
      // loaded). Pushing a customer payload with an empty email + company
      // gives qbSync nothing to match on and mints a DUPLICATE QB customer —
      // resolve the real record first.
      let cust = customer;
      if (!cust?.email && inv.customer_id) {
        try {
          const rows = await base44.entities.Customer.filter({
            shop_owner: inv.shop_owner,
            id: inv.customer_id,
          });
          if (rows?.length) cust = rows[0];
        } catch { /* server-side merge is the backstop */ }
      }

      // Treat invoice like a quote so buildQBInvoicePayload works
      const quoteShape = {
        ...inv,
        quote_id: inv.invoice_id,
        customer_email: cust?.email || "",
        // notes become QB's CustomerMemo (customer-visible on the QB
        // invoice) — internal sync-audit lines must not ride along.
        notes: stripSyncNotes(inv.notes),
      };
      let invoicePayload = buildQBInvoicePayload(quoteShape);

      // If buildQBInvoicePayload produced no lines (e.g. invoice from QB pull or
      // order with no sizes object), build a simple single-line payload from the
      // invoice totals so the QB sync still works.
      if (!invoicePayload?.lines?.length) {
        const lineItems = inv.line_items || [];
        const lines = lineItems.length > 0
          ? lineItems.map(li => {
              const qty = getQty(li) || Number(li.qty) || 1;
              const amount = Number(li.total) || Number(li.amount) || (inv.subtotal || inv.total || 0);
              return {
                description: [li.brand, li.style, li.garmentColor, li.description].filter(Boolean).join(" ") || "Service",
                qty,
                unitPrice: Number((amount / qty).toFixed(4)),
                amount: Number(amount.toFixed(2)),
                itemName: "Screen Print",
              };
            }).filter(l => l.amount > 0)
          : [{
              description: "Invoice",
              qty: 1,
              unitPrice: Number((inv.subtotal || inv.total || 0).toFixed(2)),
              amount: Number((inv.subtotal || inv.total || 0).toFixed(2)),
              itemName: "Screen Print",
            }];

        const discVal = parseFloat(inv.discount) || 0;
        const isFlat = inv.discount_type === "flat";
        invoicePayload = {
          lines,
          discountPercent: isFlat ? 0 : discVal,
          discountAmount: isFlat ? discVal : 0,
          discountType: isFlat ? "flat" : "percent",
          taxPercent: parseFloat(inv.tax_rate) || 0,
          depositAmount: 0,
        };
      }

      const idempotencyKey = qbAttemptKeyRef.current || crypto.randomUUID();
      qbAttemptKeyRef.current = idempotencyKey;
      const { data, error: invErr } = await base44.functions.invoke("qbSync", {
        action: "createInvoice",
        accessToken: session.access_token,
        // Don't let QuickBooks email the customer — the shop sends via the
        // Send button. Suppresses qbSync's /send fallback.
        noEmail: true,
        // Collapse concurrent/double submits onto one QB write (NEW-10).
        idempotencyKey,
        quote: quoteShape,
        invoicePayload,
        customer: {
          id: inv.customer_id,
          name: inv.customer_name,
          email: cust?.email || "",
          company: cust?.company || "",
          phone: cust?.phone || "",
          address: cust?.address || "",
          qb_customer_id: cust?.qb_customer_id || "",
          tax_exempt: cust?.tax_exempt || false,
          tax_id: cust?.tax_id || "",
          ship_to_address: cust?.ship_to_address || null,
          exemption_expires_at: cust?.exemption_expires_at || null,
          exemption_states: cust?.exemption_states || null,
          exemption_type: cust?.exemption_type || null,
          exemption_certificate_number: cust?.exemption_certificate_number || null,
        },
      });
      if (invErr) {
        // FunctionsHttpError on non-2xx wraps the real error in
        // context.response.body. Without unwrapping the user sees
        // "Edge Function returned a non-2xx status code" which is
        // useless. Same pattern as PurchaseOrders.jsx for AS Colour
        // edge errors.
        const ctxRes = (invErr.context && typeof invErr.context.text === "function")
          ? invErr.context
          : invErr.context?.response;
        if (ctxRes?.text) {
          const body = await ctxRes.text().catch(() => "");
          let parsed = null;
          try { parsed = JSON.parse(body); } catch {}
          throw new Error(parsed?.error || body || invErr.message);
        }
        throw new Error(invErr.message || "Failed to create");
      }
      if (data?.error) throw new Error(data.error);
      if (data?.inFlight) {
        // Row lock: another surface's sync for this invoice is mid-flight.
        setQbStatus({
          type: "info",
          text: data.message || "Another sync for this invoice is still running — wait a moment, then refresh.",
        });
        return;
      }
      if (data?.taxBlocked) {
        // QB computed a different sales tax than the invoice — on hold, no
        // payment link minted. Don't present this as a clean success.
        const d = data.taxBlockDetail || {};
        setQbStatus({
          type: "error",
          text:
            `Invoice created in QuickBooks but ON HOLD — QuickBooks calculated a different sales tax ` +
            `(billed $${Number(d.quotedTax || 0).toFixed(2)}, QB computed $${Number(d.qbTax || 0).toFixed(2)}). ` +
            `No payment link was minted. Fix the customer's QB tax setup or this invoice's tax rate, then Refresh. See docs/qb-tax-sync.md.`,
        });
      } else {
        setQbStatus({
          type: "success",
          text: data.adoptionSource
            ? `Linked to the existing QuickBooks invoice (#${data.qbDocNumber || data.qbInvoiceId}) — no duplicate was created.${data.paymentLink ? " Payment link ready." : ""}`
            : `Invoice created in QuickBooks.${data.paymentLink ? " Payment link ready." : ""}`,
        });
      }
    } catch (err) {
      setQbStatus({ type: "error", text: err.message });
    } finally {
      setQbCreating(false);
    }
  }

  async function handleReorder() {
    setReordering(true);
    try {
      const newQuoteId = `Q-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
      await base44.entities.Quote.create({
        quote_id: newQuoteId,
        shop_owner: invoice.shop_owner,
        customer_id: invoice.customer_id || "",
        customer_name: invoice.customer_name || "",
        // Shop-tz, not UTC. After ~5pm Pacific, toISOString() returns
        // tomorrow's date — the reorder quote then sorted into
        // tomorrow's calendar slot. Same bug class fixed for quote
        // creation in QuoteEditorModal.
        date: todayInShopTz(),
        due_date: null,
        status: "Draft",
        // Reorder starts a fresh job — drop internal sync-audit lines.
        notes: stripSyncNotes(invoice.notes),
        rush_rate: invoice.rush_rate || 0,
        extras: invoice.extras || {},
        line_items: invoice.line_items || [],
        discount: invoice.discount || 0,
        discount_type: invoice.discount_type || "percent",
        tax_rate: invoice.tax_rate || 0,
        deposit_pct: 0,
        deposit_paid: false,
      });
      setReordered(true);
      setTimeout(() => setReordered(false), 3000);
    } catch (err) {
      notify.error("Reorder failed", err);
    } finally {
      setReordering(false);
    }
  }

  useEffect(() => {
    // Invoice now contains all order data directly
    setLoading(false);
    base44.auth.me().then(u => {
      if (u) {
        setShopName(u.shop_name || "");
        setLogoUrl(u.logo_url || "");
        setShopProfile(u);
      }
    }).catch(() => {});
  }, [invoice]);

  // Fetch the QB-generated invoice PDF and return a blob URL the caller can
  // open or download. Returns null on any failure so the caller can fall back.
  async function fetchQBInvoicePdfBlob(qbInvoiceId) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error: invErr } = await base44.functions.invoke("qbSync", {
        action: "getInvoicePDF",
        accessToken: session?.access_token,
        qbInvoiceId,
      });
      if (invErr || !data?.pdf) return null;
      const byteChars = atob(data.pdf);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
      const blob = new Blob([byteArray], { type: "application/pdf" });
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }

  // Calculate totals from invoice data
  const discVal = parseFloat(invoice?.discount) || 0;
  const sub = invoice?.subtotal || 0;
  const isFlat = invoice?.discount_type === "flat" || (discVal > 100 && invoice?.discount_type !== "percent");
  const afterDisc = isFlat ? Math.max(0, sub - discVal) : sub * (1 - discVal / 100);
  const totals = invoice ? { sub, afterDisc, tax: invoice.tax, total: invoice.total } : null;

  // z-[120] sits above the OrderDetailModal (z-[60]) so "Preview Invoice"
  // opened from a completed order layers on top, not behind it. Still below
  // SendInvoiceModal (z-[200]), which this modal can open.
  return (
    <ModalBackdrop onClose={onClose} z="z-[120]">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="px-4 sm:px-6 py-5 border-b border-slate-200 dark:border-slate-700 flex justify-between items-start">
          <div>
            {editingNumber ? (
              <div className="mb-1">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={numberDraft}
                    onChange={(e) => { setNumberDraft(e.target.value); setNumberFlag(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveInvoiceNumber(); if (e.key === "Escape") setEditingNumber(false); }}
                    autoFocus
                    className="text-xs font-semibold uppercase tracking-widest border border-slate-300 rounded px-2 py-1 w-44 focus:outline-none focus:ring-2 focus:ring-teal-300"
                  />
                  <button
                    onClick={handleSaveInvoiceNumber}
                    disabled={savingNumber}
                    className="text-xs font-semibold text-teal-600 hover:text-teal-700 disabled:opacity-50"
                  >
                    {savingNumber ? "Checking…" : "Save"}
                  </button>
                  <button onClick={() => setEditingNumber(false)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
                </div>
                {numberFlag && <div className="text-xs font-semibold text-red-600 mt-1">{numberFlag}</div>}
              </div>
            ) : (
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1 flex items-center gap-1.5">
                {activeInvoice.invoice_id} · {fmtDate(invoice.date)}
                {!readOnly && (
                  activeInvoice.qb_invoice_id ? (
                    <span
                      className="text-slate-300 cursor-not-allowed"
                      title={`Number is synced with QuickBooks (QB ID ${activeInvoice.qb_invoice_id}). Rename it in QuickBooks and it will mirror here.`}
                    >✎</span>
                  ) : (
                    <button
                      onClick={startEditNumber}
                      title="Change invoice number"
                      className="text-slate-400 hover:text-teal-600 transition"
                    >✎</button>
                  )
                )}
              </div>
            )}
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{getDisplayName(customer || invoice.customer_name)}</h2>
            {invoice.due && <div className="text-sm text-slate-500 mt-0.5">Due: {fmtDate(invoice.due)}</div>}
          </div>
          <div className="flex items-center gap-3">
            {invoice.status && <span className="text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 dark:border-slate-700 px-2.5 py-1 rounded-full">{invoice.status}</span>}
            {invoice.paid
              ? <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">Paid</span>
              : <span className="text-xs font-semibold text-red-500 bg-red-50 border border-red-100 px-2.5 py-1 rounded-full">Unpaid</span>}
            <button onClick={onClose} className="text-slate-500 hover:text-slate-600 text-lg leading-none">✕</button>
          </div>
        </div>

        {/* Dates */}
        <div className="px-4 sm:px-6 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-0.5">Issued</div>
            <div className="text-sm font-semibold text-slate-700">{fmtDate(invoice.date) || "—"}</div>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-0.5">Due</div>
            <div className="text-sm font-semibold text-slate-700">{fmtDate(invoice.due) || "—"}</div>
          </div>

          {invoice.paid && invoice.paid_date && (
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-0.5">Paid On</div>
              <div className="text-sm font-semibold text-emerald-600">{fmtDate(invoice.paid_date)}</div>
            </div>
          )}
        </div>

        <div className="p-4 sm:p-6 space-y-5">
          {/* Line items.
              Handles two shapes:
                - Native InkTracker line items: have _ppp/_lineTotal saved
                  via "calculate once", plus sizes + imprints. Computed
                  via calcLinkedLinePrice as a fallback for legacy rows.
                - QB-pulled line items (from qbSync handlePullInvoices):
                  have li.lineTotal + li.qty directly, no sizes/imprints,
                  garmentCost: 0. Render as a simple row.
              The garmentCost "Wholesale:" badge only shows when there
              is a real cost — QB-pulled invoices set it to 0, which
              was rendering as "Wholesale: $0.00" everywhere. */}
          {!loading && invoice.line_items && (() => {
            const linkedQtyMap = buildLinkedQtyMap(invoice.line_items || []);
            return (invoice.line_items || []).map(li => {
            const qty = getQty(li) || Number(li.qty) || 0;
            const override = Number(li?.clientPpp);
            const hasOverride = Number.isFinite(override) && override > 0 && qty > 0;
            const hasSaved = Number.isFinite(li._ppp) && li._ppp > 0 && Number.isFinite(li._lineTotal);
            // Direct lineTotal from QB-pulled shape — last fallback so
            // pulled invoices show their real amount instead of $0.
            const directLineTotal = Number(li.lineTotal);
            const hasDirectTotal = Number.isFinite(directLineTotal) && directLineTotal !== 0;
            const r = hasSaved
              ? { ppp: li._ppp, lineTotal: li._lineTotal, rushFee: li._rushFee || 0 }
              : hasOverride
                ? { ppp: override, lineTotal: override * qty, rushFee: 0 }
                : hasDirectTotal
                  ? { ppp: qty > 0 ? directLineTotal / qty : directLineTotal, lineTotal: directLineTotal, rushFee: 0 }
                  : calcLinkedLinePrice(li, invoice.rush_rate || 0, getLineExtras(li, invoice), undefined, linkedQtyMap);
            const activeSizes = SIZES.filter(sz => (parseInt((li.sizes||{})[sz]) || 0) > 0);
            const garmentCostNum = Number(li.garmentCost);
            const hasGarmentCost = Number.isFinite(garmentCostNum) && garmentCostNum > 0;
            return (
              <div key={li.id} className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                <div className="bg-slate-50 dark:bg-slate-800 px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="font-bold text-slate-800 dark:text-slate-200 text-sm">{li.style || "Item"}</span>
                    {li.garmentColor && <span className="ml-2 text-xs text-slate-500">· {li.garmentColor}</span>}
                    {hasGarmentCost && <span className="ml-2 text-xs text-slate-500">Wholesale: {fmtMoney(garmentCostNum)}</span>}
                  </div>
                  {r && r.lineTotal !== 0 && <span className="font-bold text-slate-700 text-sm whitespace-nowrap">{fmtMoney(r.lineTotal)}</span>}
                </div>

                {activeSizes.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                        <td className="px-4 py-2 text-xs text-slate-500 font-semibold">Size</td>
                        {activeSizes.map(sz => <td key={sz} className="px-3 py-2 text-center text-xs font-semibold text-slate-600">{sz}</td>)}
                        <td className="px-4 py-2 text-center text-xs font-semibold text-slate-600">Total</td>
                      </tr></thead>
                      <tbody>
                        <tr>
                          <td className="px-4 py-2 text-xs text-slate-500">Qty</td>
                          {activeSizes.map(sz => <td key={sz} className="px-3 py-2 text-center font-semibold text-slate-800 dark:text-slate-200">{(li.sizes||{})[sz] || 0}</td>)}
                          <td className="px-4 py-2 text-center font-bold text-slate-800 dark:text-slate-200">{qty}</td>
                        </tr>
                        {r && (
                          <tr>
                            <td className="px-4 py-2 text-xs text-slate-500">Price/ea</td>
                            {activeSizes.map(sz => (
                              <td key={sz} className="px-3 py-2 text-center text-xs text-slate-500">
                                {fmtMoney(r.ppp)}
                              </td>
                            ))}
                            <td className="px-4 py-2 text-center text-xs font-bold text-slate-700">{fmtMoney(r.lineTotal)}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* No-sizes/no-imprints fallback (e.g. QB-pulled rows):
                    show a single qty × price/ea row instead of an empty
                    body so the line item card still conveys the numbers. */}
                {activeSizes.length === 0 && (li.imprints || []).length === 0 && r && qty > 0 && (
                  <div className="px-4 py-3 flex items-center justify-between text-xs text-slate-500">
                    <span>{qty} × {fmtMoney(r.ppp)}</span>
                    <span className="font-bold text-slate-700">{fmtMoney(r.lineTotal)}</span>
                  </div>
                )}

                {(li.imprints || []).length > 0 && (
                  <div className="border-t border-slate-100 dark:border-slate-700 p-4 space-y-3">
                    {(li.imprints || []).map(imp => (
                      <div key={imp.id} className="space-y-1.5">
                        {imp.title && <div className="text-xs font-bold text-slate-800 dark:text-slate-200">{imp.title}</div>}
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2 border border-slate-100 dark:border-slate-700">
                          <span className="font-bold text-slate-800 dark:text-slate-200">{imp.location}</span>
                          <span className="text-slate-500">{imprintCountText(imp, getShopPricingConfig()?.embroidery?.stitchTiers)} · {imp.technique}</span>
                          {imp.pantones && <span className="text-teal-600 font-medium">{imp.pantones}</span>}
                          {imp.details && <span className="text-slate-500 italic">{imp.details}</span>}
                        </div>
                        {(imp.width || imp.height) && (
                          <div className="flex gap-2 text-xs text-slate-500">
                            {imp.width && <span>Width: {imp.width}</span>}
                            {imp.height && <span>Height: {imp.height}</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })})()}

          {/* Extras / Add-ons */}
          {invoice.extras && Object.values(invoice.extras).some(Boolean) && (
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Add-ons</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(invoice.extras).filter(([,v])=>v).map(([k])=>(
                  <span key={k} className="text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 px-2.5 py-1 rounded-full capitalize">{k.replace(/([A-Z])/g,' $1')}</span>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {invoice.notes && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
              <span className="font-semibold">Notes: </span>{invoice.notes}
            </div>
          )}

          {/* Modified in QuickBooks — offer a consented one-click adopt.
              Keyed off the fresh qb_* mirror (webhook keeps it current);
              clears itself once the totals agree. */}
          {qbModified.modified && (
            <div className="bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-slate-700 dark:text-slate-200">
                <span className="font-semibold">Modified in QuickBooks.</span>{" "}
                QuickBooks recorded {fmtMoney(qbModified.qbTotal)} for this invoice —{" "}
                {fmtMoney(Math.abs(qbModified.delta))} {qbModified.delta > 0 ? "more" : "less"} than
                InkTracker&rsquo;s {fmtMoney(qbModified.localTotal)}. Your customer is billed the QuickBooks amount.
              </div>
              <button
                onClick={handleSyncFromQb}
                disabled={syncingQb || readOnly}
                title={readOnly ? readOnlyReason : undefined}
                className="bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {syncingQb ? "Matching…" : "Match to QuickBooks"}
              </button>
            </div>
          )}

          {/* Who changed what, when, and from where. Renders nothing
              until this invoice actually has history. */}
          <ChangeHistory entityType="invoice" entityId={activeInvoice.id} />

          {/* Totals */}
          <div className="bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
            <div className="flex justify-between text-sm text-slate-500"><span>Subtotal</span><span>{fmtMoney(activeInvoice.subtotal)}</span></div>
            {invoice.discount > 0 && (
              <div className="flex justify-between text-sm text-emerald-600">
                <span>
                  Discount {isFlat ? `(${fmtMoney(discVal)})` : `(${invoice.discount}%)`}
                  {invoice.discount_description ? ` — ${invoice.discount_description}` : ""}
                </span>
                <span>−{fmtMoney(sub - afterDisc)}</span>
              </div>
            )}
            {activeInvoice.tax > 0 && (
              <div className="flex justify-between text-sm text-slate-500">
                <span>Tax {activeInvoice.tax_rate ? `(${activeInvoice.tax_rate}%)` : ""}</span>
                <span>{fmtMoney(activeInvoice.tax)}</span>
              </div>
            )}
            {invoice.rush_rate > 0 && (
              <div className="flex justify-between text-sm text-orange-600"><span>Rush Fee</span><span>included</span></div>
            )}
            <div className="flex justify-between font-bold text-slate-900 dark:text-slate-100 border-t border-slate-200 dark:border-slate-700 pt-2">
              <span className="text-base">Total</span>
              <span className="text-2xl">{fmtMoney(activeInvoice.total)}</span>
            </div>
          </div>
        </div>

        {/* Messages — threaded conversation with reply box. Collapsible;
            shares one localStorage key with the other detail modals so
            the user's preference applies everywhere. */}
        <CollapsibleSection
          title="Messages"
          icon={<MessageSquare className="w-4 h-4 text-slate-500" />}
          storageKey="messages-window-collapsed"
          className="px-4 sm:px-6 py-4 border-t border-slate-200 dark:border-slate-700"
        >
          <MessagesTab
            threadId={invoiceThreadId(invoice)}
            currentUserEmail={invoice.shop_owner}
            replyContext={{
              customerEmail: invoice.customer_email || customer?.email || "",
              shopName,
              shopLogoUrl: logoUrl,
              refId: invoice.invoice_id,
              defaultSubject: `Invoice ${invoice.invoice_id}`,
            }}
          />
        </CollapsibleSection>

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-b-2xl">
          {!invoice.paid && onMarkPaid && (
            <button onClick={() => { onMarkPaid(invoice.id); onClose(); }}
              disabled={readOnly}
              title={readOnly ? readOnlyReason : undefined}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed">
              Mark as Paid
            </button>
          )}
          {invoice.status === "Draft" && onConvertToInvoice && (
            <button onClick={() => { onConvertToInvoice(invoice); onClose(); }}
              disabled={readOnly}
              title={readOnly ? readOnlyReason : undefined}
              className="bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed">
              Convert to Invoice
            </button>
          )}
          {!invoice.paid && (
            <button onClick={() => setShowSendModal(true)}
              disabled={readOnly}
              title={readOnly ? readOnlyReason : undefined}
              className="text-xs font-semibold text-teal-600 hover:text-teal-700 px-3 py-1.5 rounded-lg hover:bg-teal-50 transition disabled:opacity-50 disabled:cursor-not-allowed">
              Send Invoice
            </button>
          )}
          {/* Add to Production — bridges a QB-originated invoice (no
              linked order) onto the schedule. Renders only when the
              invoice has no order_id; the page-level handler re-checks
              against fresh rows before creating anything. */}
          {!invoice.order_id && onAddToProduction && (
            <button onClick={() => onAddToProduction(invoice)}
              disabled={readOnly}
              title={readOnly ? readOnlyReason : undefined}
              className="text-xs font-semibold text-teal-600 hover:text-teal-700 px-3 py-1.5 rounded-lg hover:bg-teal-50 transition disabled:opacity-50 disabled:cursor-not-allowed">
              Add to Production
            </button>
          )}
          {orderExists && (
            <button onClick={async () => {
              try {
                const order = await base44.entities.Order.filter({ order_id: invoice.order_id });
                if (order?.[0]) setViewingOrder(order[0]);
                // No alert on the not-found path — orderExists already
                // gated the render, so this only fires if the order was
                // deleted between mount and click. Silent no-op is fine.
              } catch (_) { /* swallow — same rationale as above */ }
            }}
              className="text-xs font-semibold text-teal-600 hover:text-teal-700 px-3 py-1.5 rounded-lg hover:bg-teal-50 transition">
              View Order
            </button>
          )}
          {/* QB button — "View in QB" when the invoice already exists
              there, "Create in QB" when it doesn't. Two layers of
              dup protection: the button itself never offers create
              when qb_invoice_id is set, AND handleCreateInQB refuses
              the call as a backstop. */}
          {invoice.qb_invoice_id ? (
            <a
              href={`https://qbo.intuit.com/app/invoice?txnId=${encodeURIComponent(invoice.qb_invoice_id)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-[#2CA01C] hover:text-[#248A18] px-3 py-1.5 rounded-lg hover:bg-[#2CA01C]/5 transition"
            >
              View in QB
            </a>
          ) : (
            <button onClick={handleCreateInQB} disabled={qbCreating || readOnly}
              title={readOnly ? readOnlyReason : undefined}
              className="text-xs font-semibold text-[#2CA01C] hover:text-[#248A18] px-3 py-1.5 rounded-lg hover:bg-[#2CA01C]/5 transition disabled:opacity-50 disabled:cursor-not-allowed">
              {qbCreating ? "Creating…" : "Create in QB"}
            </button>
          )}
          {/* Preview PDF — the preview window has its own download
              button, so we don't render a separate "Download PDF" here. */}
          <button onClick={() => previewPdf((async () => {
            // QB-synced invoices: show what QB actually generated, not our local copy.
            const target = resolveInvoicePdfSource(invoice);
            if (target.source === "qb") {
              const blobUrl = await fetchQBInvoicePdfBlob(target.qbInvoiceId);
              if (blobUrl) return blobUrl;
              // QB fetch failed — fall through to local PDF.
            }
            return await exportInvoiceToPDF(invoice, customer, { shop: shopProfile || { shop_name: shopName }, logoUrl, output: "blob" });
          })())}
            className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition">
            Preview PDF
          </button>
          <button onClick={handleReorder} disabled={reordering || readOnly}
            title={readOnly ? readOnlyReason : undefined}
            className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition disabled:opacity-50 disabled:cursor-not-allowed">
            {reordered ? "✓ Reordered" : reordering ? "Creating…" : "Reorder"}
          </button>
          {onDelete && <button onClick={() => onDelete(invoice.id)}
            disabled={readOnly}
            title={readOnly ? readOnlyReason : undefined}
            className="text-xs font-semibold text-red-400 hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 transition disabled:opacity-50 disabled:cursor-not-allowed">
            Delete
          </button>}
          <ReactivateLink show={readOnly} href={reactivateHref} />
          <button onClick={onClose} className="ml-auto text-xs font-semibold text-slate-500 hover:text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition">Close</button>
        </div>
        {qbStatus && (
          <div className={`px-4 sm:px-6 py-2 text-sm border-t ${
            qbStatus.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-700" :
            qbStatus.type === "info" ? "bg-blue-50 border-blue-200 text-blue-700" :
            "bg-red-50 border-red-200 text-red-600"
          }`}>
            {qbStatus.text}
          </div>
        )}

        {showSendModal && (
          <SendInvoiceModal
            invoice={invoice}
            customer={customer}
            onClose={() => setShowSendModal(false)}
            onSuccess={() => {
              // Successful send is the terminal customer-facing action.
              // Close the send modal AND propagate to the parent so it
              // can close itself + any ancestor (e.g., the parent
              // OrderDetailModal opened from the Production page).
              // Without this propagation, operators were left stranded
              // on a stack of modals after the deliverable went out.
              setShowSendModal(false);
              onClose();
              onSendSuccess?.();
            }}
          />
        )}
        {viewingOrder && (
          <OrderDetailModal
            order={viewingOrder}
            customer={customer}
            onClose={() => setViewingOrder(null)}
          />
        )}
      </div>
    </ModalBackdrop>
  );
}