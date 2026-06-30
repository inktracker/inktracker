import { buildQBInvoicePayload, getQty } from "@/components/shared/pricing";

// Create an InkTracker invoice in QuickBooks WITHOUT emailing the customer.
//
// qbSync's `createInvoice` mints the customer pay link via
// `?include=invoiceLink` (no QB email) and only falls back to QBO's /send
// (which emails) in the rare case the link can't be fetched that way — so this
// is the "create silently, send later" path. The companion "Send" step
// (SendInvoiceModal) is what actually emails the customer, with this link
// attached as the "Pay Invoice" button.
//
// Shared by OrderDetailModal's "Create Invoice" flow (auto-push on completion)
// and any other surface that wants to push an existing InkTracker invoice to
// QB. Pure-ish: all I/O is the single qbSync invoke; the caller owns the
// session, the connection check, and persisting/refetching.
//
// Returns: { ok, qbInvoiceId, paymentLink, taxBlocked, taxBlockDetail, error }.
// `qbSync` itself writes qb_invoice_id / qb_payment_link back to the invoices
// row, so callers should refetch the invoice rather than trust these alone.
export async function createInvoiceInQB({ base44, invoice, customer, session }) {
  if (!invoice) return { ok: false, error: "No invoice provided." };
  if (!session?.access_token) return { ok: false, error: "Not signed in." };

  // Treat the invoice like a quote so buildQBInvoicePayload works (it keys off
  // quote_id + line_items). Mirrors InvoiceDetailModal.handleCreateInQB.
  const quoteShape = {
    ...invoice,
    quote_id: invoice.invoice_id,
    customer_email: customer?.email || invoice.customer_email || "",
  };

  let invoicePayload = buildQBInvoicePayload(quoteShape);

  // Fallback for invoices whose line items lack the sizes/imprints shape
  // buildQBInvoicePayload expects (QB-pulled rows, order-derived invoices):
  // build a simple line payload from the totals so the sync still works.
  if (!invoicePayload?.lines?.length) {
    const lineItems = invoice.line_items || [];
    const lines = lineItems.length > 0
      ? lineItems.map((li) => {
          const qty = getQty(li) || Number(li.qty) || 1;
          const amount = Number(li.total) || Number(li.amount) || (invoice.subtotal || invoice.total || 0);
          return {
            description: [li.brand, li.style, li.garmentColor, li.description].filter(Boolean).join(" ") || "Service",
            qty,
            unitPrice: Number((amount / qty).toFixed(4)),
            amount: Number(amount.toFixed(2)),
            itemName: "Screen Print",
          };
        }).filter((l) => l.amount > 0)
      : [{
          description: "Invoice",
          qty: 1,
          unitPrice: Number((invoice.subtotal || invoice.total || 0).toFixed(2)),
          amount: Number((invoice.subtotal || invoice.total || 0).toFixed(2)),
          itemName: "Screen Print",
        }];
    const discVal = parseFloat(invoice.discount) || 0;
    const isFlat = invoice.discount_type === "flat";
    invoicePayload = {
      lines,
      discountPercent: isFlat ? 0 : discVal,
      discountAmount: isFlat ? discVal : 0,
      discountType: isFlat ? "flat" : "percent",
      taxPercent: parseFloat(invoice.tax_rate) || 0,
      depositAmount: 0,
    };
  }

  try {
    const { data, error } = await base44.functions.invoke("qbSync", {
      action: "createInvoice",
      accessToken: session.access_token,
      // Never let QuickBooks email the customer — the shop sends the invoice
      // itself via the Send flow (Resend). qbSync mints the pay link via
      // ?include=invoiceLink and suppresses the /send fallback.
      noEmail: true,
      quote: quoteShape,
      invoicePayload,
      customer: {
        id: invoice.customer_id,
        name: invoice.customer_name,
        email: customer?.email || "",
        company: customer?.company || "",
        phone: customer?.phone || "",
        address: customer?.address || "",
        qb_customer_id: customer?.qb_customer_id || "",
        tax_exempt: customer?.tax_exempt || false,
        tax_id: customer?.tax_id || "",
        ship_to_address: customer?.ship_to_address || null,
        exemption_expires_at: customer?.exemption_expires_at || null,
        exemption_states: customer?.exemption_states || null,
        exemption_type: customer?.exemption_type || null,
        exemption_certificate_number: customer?.exemption_certificate_number || null,
      },
    });

    if (error) {
      // FunctionsHttpError wraps the real message in the response body.
      const ctxRes = (error.context && typeof error.context.text === "function")
        ? error.context
        : error.context?.response;
      if (ctxRes?.text) {
        const body = await ctxRes.text().catch(() => "");
        let parsed = null;
        try { parsed = JSON.parse(body); } catch { /* not json */ }
        return { ok: false, error: parsed?.error || body || error.message };
      }
      return { ok: false, error: error.message || "Failed to create in QuickBooks." };
    }
    if (data?.error) return { ok: false, error: data.error };
    if (data?.taxBlocked) {
      return { ok: false, taxBlocked: true, taxBlockDetail: data.taxBlockDetail || {} };
    }
    return {
      ok: true,
      qbInvoiceId: data?.qb_invoice_id || data?.qbInvoiceId || null,
      paymentLink: data?.paymentLink || data?.qb_payment_link || null,
    };
  } catch (err) {
    return { ok: false, error: err?.message || "Failed to create in QuickBooks." };
  }
}
