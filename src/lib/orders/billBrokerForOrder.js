import { buildQBInvoicePayload, BROKER_MARKUP } from "@/components/shared/pricing";

// Phase A — the shop bills the BROKER for the wholesale amount when a broker
// order completes. This invoice lives in the SHOP's QuickBooks, billed to the
// broker (a wholesale B2B customer), at wholesale, with no sales tax. The
// broker pays it (ACH ≈ $0 fee). The client→broker leg is separate and is not
// touched here.
//
// Fail-open by contract: this runs inside order completion, so any failure
// returns { ok:false, error } and NEVER throws — a QB hiccup must not block a
// job from completing. The invoice id + pay link land in the order's OWN
// broker columns (qb_broker_*), deliberately not quotes/invoices.qb_invoice_id,
// so reconcile/webhook never compare this wholesale invoice against the quote's
// client total (that would fire permanent false books-drift).
//
// Idempotent: skips if the order already carries a broker invoice id.
export async function billBrokerForOrder({ base44, order, session }) {
  try {
    if (!order?.broker_id && !order?.broker_email) {
      return { ok: false, skipped: "not_a_broker_order" };
    }
    if (order.qb_broker_invoice_id) {
      return { ok: false, skipped: "already_billed", qbInvoiceId: order.qb_broker_invoice_id };
    }
    if (!session?.access_token) return { ok: false, error: "Not signed in." };
    if (!Array.isArray(order.line_items) || order.line_items.length === 0) {
      return { ok: false, error: "Order has no line items to bill." };
    }

    const brokerEmail = String(order.broker_email || order.broker_id || "").toLowerCase().trim();
    if (!brokerEmail) return { ok: false, error: "Broker has no email to bill to." };

    // 1. Resolve (or create) the broker as a wholesale customer in the shop's
    //    books. is_broker_account tags it so it can be labeled/filtered later.
    let brokerCustomer = null;
    try {
      const existing = await base44.entities.Customer.filter({
        shop_owner: order.shop_owner,
        email: brokerEmail,
      });
      brokerCustomer = (existing || []).find((c) => c.is_broker_account) || (existing || [])[0] || null;
    } catch { /* fall through to create */ }

    if (!brokerCustomer) {
      brokerCustomer = await base44.entities.Customer.create({
        shop_owner: order.shop_owner,
        name: order.broker_company || order.broker_name || brokerEmail,
        company: order.broker_company || "",
        email: brokerEmail,
        phone: order.broker_phone || "",
        is_broker_account: true,
      });
    }

    // 2. Build WHOLESALE lines. buildQBInvoicePayload at BROKER_MARKUP reads the
    //    broker-side line stamps (_ppp/_lineTotal), so the amount is what the
    //    broker owes. Force zero tax (B2B) and zero discount (the quote's
    //    discount is the broker's CLIENT discount, not a wholesale one).
    const orderShape = { ...order, quote_id: order.order_id, customer_email: brokerEmail };
    const built = buildQBInvoicePayload(orderShape, BROKER_MARKUP);
    if (!built?.lines?.length) {
      // No broker-side line stamps — never fall back to client totals (that
      // would bill the broker the wrong amount). Bail cleanly.
      return { ok: false, error: "No wholesale line pricing on this order — nothing to bill." };
    }
    const invoicePayload = {
      ...built,
      taxPercent: 0,
      discountPercent: 0,
      discountAmount: 0,
    };

    // 3. Create the invoice in the shop's QB via the billBroker path.
    const { data, error } = await base44.functions.invoke("qbSync", {
      action: "createInvoice",
      accessToken: session.access_token,
      noEmail: true,
      billBroker: true,
      idempotencyKey: `billBroker:${order.id}`,
      quote: {
        id: order.id,
        quote_id: order.order_id,
        shop_owner: order.shop_owner,
        date: order.date || new Date().toISOString().slice(0, 10),
        job_title: order.job_title || "",
        notes: "",
        line_items: order.line_items,
        // present so downstream code that reads broker fields stays consistent;
        // the billBroker flag is what actually drives the path.
        broker_id: order.broker_id || null,
        broker_email: order.broker_email || null,
      },
      invoicePayload,
      customer: {
        id: brokerCustomer.id,
        name: brokerCustomer.name,
        company: brokerCustomer.company || "",
        email: brokerCustomer.email || brokerEmail,
        phone: brokerCustomer.phone || "",
        qb_customer_id: brokerCustomer.qb_customer_id || "",
        tax_exempt: true,
      },
    });

    if (error) {
      const ctxRes = (error.context && typeof error.context.text === "function")
        ? error.context : error.context?.response;
      if (ctxRes?.text) {
        const body = await ctxRes.text().catch(() => "");
        let parsed = null;
        try { parsed = JSON.parse(body); } catch { /* not json */ }
        return { ok: false, error: parsed?.error || body || error.message };
      }
      return { ok: false, error: error.message || "Failed to bill broker in QuickBooks." };
    }
    if (data?.error) return { ok: false, error: data.error };
    if (data?.inFlight) return { ok: false, error: data.message || "Another broker-bill sync is still running." };

    const qbInvoiceId = data?.qbInvoiceId || data?.qb_invoice_id || null;
    if (!qbInvoiceId) return { ok: false, error: "QuickBooks did not return a broker invoice id." };

    // 4. Stamp the order's OWN broker-invoice columns (never qb_invoice_id).
    const updated = await base44.entities.Order.update(order.id, {
      qb_broker_invoice_id: qbInvoiceId,
      qb_broker_doc_number: data?.qbDocNumber || order.order_id,
      qb_broker_payment_link: data?.paymentLink || data?.qb_payment_link || null,
      qb_broker_invoice_synced_at: new Date().toISOString(),
    });

    return {
      ok: true,
      qbInvoiceId,
      paymentLink: data?.paymentLink || data?.qb_payment_link || null,
      order: updated,
    };
  } catch (err) {
    // Never throw out of order completion.
    console.error("[billBrokerForOrder] failed (non-fatal):", err?.message || err);
    return { ok: false, error: err?.message || "Broker billing failed." };
  }
}
