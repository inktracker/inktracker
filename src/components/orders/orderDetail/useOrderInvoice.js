import { useState, useEffect } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { createInvoiceInQB } from "@/lib/invoices/createInvoiceInQB";
import { notify } from "@/lib/notify";

// Related-invoice lookup + Create/Send invoice flow for the Order Detail
// modal, extracted verbatim from OrderDetailModal.jsx. Owns the invoice
// state (relatedInvoice, send flow, QB push note) and the four handlers.
// `callAction` is threaded in so the Create flow still flips the parent's
// `saving` flag exactly as before. Pure decomposition — no behavior change.
export function useOrderInvoice({ order, customer, onComplete, callAction }) {
  // Existing invoice for this order/quote, if any. Drives whether the
  // action bar shows "Create Invoice" vs "Preview Invoice" + the
  // optional "View in QB" link. Fetched once on mount.
  const [relatedInvoice, setRelatedInvoice] = useState(null);
  // Send-invoice flow (opened from the Completed action bar). `sendCustomer`
  // is fetched lazily when the operator clicks Send. `creatingInvoice` covers
  // the whole Create Invoice → push-to-QB sequence; `qbPushNote` surfaces a
  // best-effort QB outcome (e.g. tax hold) without blocking.
  const [sendingInvoice, setSendingInvoice] = useState(false);
  const [sendCustomer, setSendCustomer] = useState(null);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [qbPushNote, setQbPushNote] = useState("");

  // Look up any existing invoice for this order (or its source
  // quote) so the action bar can show "Preview Invoice" instead of
  // "Create Invoice" when an invoice already exists. Two match
  // paths:
  //   1. order_id match — invoice was created via this order's
  //      handleComplete on a prior visit
  //   2. invoice_id = order.quote_id — invoice was created via
  //      SendQuoteModal pushing the quote to QB (then synced back
  //      via handlePullInvoices, which uses the QB DocNumber —
  //      typically the quote_id — as the invoice_id)
  // Resolve the invoice tied to this order (two match paths above) and return
  // it. Used by the mount effect AND by handleCreateInvoice, which needs the
  // freshly-created row to drive the QB push + Send button. Returns null when
  // none exists; sets relatedInvoice state as a side effect.
  async function lookupRelatedInvoice() {
    if (!order?.shop_owner) { setRelatedInvoice(null); return null; }
    try {
      const byOrderId = await base44.entities.Invoice.filter({
        shop_owner: order.shop_owner,
        order_id: order.order_id,
      });
      if (byOrderId.length > 0) { setRelatedInvoice(byOrderId[0]); return byOrderId[0]; }
      if (order.quote_id) {
        const byQuoteId = await base44.entities.Invoice.filter({
          shop_owner: order.shop_owner,
          invoice_id: order.quote_id,
        });
        if (byQuoteId.length > 0) { setRelatedInvoice(byQuoteId[0]); return byQuoteId[0]; }
      }
      setRelatedInvoice(null);
      return null;
    } catch (err) {
      console.error("[OrderDetailModal] related-invoice lookup failed:", err);
      setRelatedInvoice(null);
      return null;
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const inv = await lookupRelatedInvoice();
      // If the effect was torn down mid-flight, undo the state write so we
      // don't render a stale invoice for a different order.
      if (cancelled && inv) setRelatedInvoice(null);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, order?.order_id, order?.quote_id, order?.shop_owner]);

  // Look up the customer record for an invoice (needed for the QB push +
  // Send email). Best-effort — returns null if it can't be resolved.
  async function fetchInvoiceCustomer(inv) {
    const cid = inv?.customer_id || order?.customer_id;
    // The `customer` prop is the order's customer (keyed by order.customer_id),
    // already carrying email/company/qb_customer_id — prefer it over a lookup.
    if (customer && (customer.id === cid || customer.email)) return customer;
    try {
      if (cid) {
        const rows = await base44.entities.Customer.filter({ shop_owner: order.shop_owner, id: cid });
        if (rows?.length) return rows[0];
      }
      const email = inv?.customer_email || order?.customer_email;
      if (email) {
        const byEmail = await base44.entities.Customer.filter({ shop_owner: order.shop_owner, email });
        if (byEmail?.length) return byEmail[0];
      }
    } catch (err) {
      console.warn("[OrderDetailModal] customer lookup failed:", err?.message);
    }
    // Minimal shape so SendInvoiceModal still prefills the To field.
    return { id: cid || "", name: inv?.customer_name || order?.customer_name || "", email: inv?.customer_email || order?.customer_email || "" };
  }

  // "Create Invoice" on a Completed order with no invoice yet:
  //   1. run the parent's completion (creates the InkTracker invoice row),
  //   2. resolve that fresh invoice,
  //   3. if QuickBooks is connected, push it to QB silently (no customer
  //      email — qbSync mints the pay link via ?include=invoiceLink),
  //   4. leave the modal open so the revealed "Send" button can email it.
  // The QB step is best-effort: a failure (or no QB connection) still leaves
  // a valid InkTracker invoice the shop can send or push manually later.
  async function handleCreateInvoice() {
    if (!onComplete) return;
    setCreatingInvoice(true);
    setQbPushNote("");
    try {
      await callAction(onComplete, order);
      const inv = await lookupRelatedInvoice();
      if (!inv) return;
      if (inv.qb_invoice_id) return; // already in QB (e.g. linked from a sent quote)

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      // Only attempt the push when QB is actually connected — otherwise the
      // edge function errors and we'd surface noise for shops that don't use QB.
      let connected = false;
      try {
        const { data, error } = await base44.functions.invoke("qbSync", {
          action: "checkConnection",
          accessToken: session.access_token,
        });
        connected = !error && !!data?.connected;
      } catch { /* treat as not connected */ }
      if (!connected) return;

      const cust = await fetchInvoiceCustomer(inv);
      const result = await createInvoiceInQB({ base44, invoice: inv, customer: cust, session });
      if (result?.taxBlocked) {
        const d = result.taxBlockDetail || {};
        setQbPushNote(
          `Invoice created. QuickBooks put it on hold — it calculated a different sales tax ` +
          `(billed $${Number(d.quotedTax || 0).toFixed(2)}, QB computed $${Number(d.qbTax || 0).toFixed(2)}). ` +
          `No pay link yet; fix the tax in QB then use Send. See docs/qb-tax-sync.md.`
        );
      } else if (!result?.ok) {
        setQbPushNote(`Invoice created in InkTracker, but the QuickBooks push didn't complete: ${result?.error || "unknown error"}. You can retry from the invoice's "Create in QB".`);
      }
      // Refresh so the action bar picks up qb_invoice_id / qb_payment_link.
      await lookupRelatedInvoice();
    } catch (err) {
      notify.error("Couldn't create the invoice", err);
    } finally {
      setCreatingInvoice(false);
    }
  }

  // Open the Send Invoice modal — fetch the customer first so the recipient
  // and any QB pay link are prefilled.
  async function handleOpenSend() {
    if (!relatedInvoice) return;
    const cust = await fetchInvoiceCustomer(relatedInvoice);
    setSendCustomer(cust);
    setSendingInvoice(true);
  }

  return {
    relatedInvoice,
    sendingInvoice, setSendingInvoice,
    sendCustomer,
    creatingInvoice,
    qbPushNote,
    lookupRelatedInvoice,
    handleCreateInvoice,
    handleOpenSend,
  };
}
