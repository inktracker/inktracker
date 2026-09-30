// Resolve the invoice + customer to send for a given order — the same lookup
// useOrderInvoice does for the order-detail "Send" button, packaged so the
// completion flow can reuse it without the whole OrderDetailModal context.
//
// Invoice match order (mirrors useOrderInvoice.lookupRelatedInvoice):
//   1. Invoice.order_id === order.order_id (created via this order's completion)
//   2. Invoice.invoice_id === order.quote_id (created via the send-quote flow,
//      which stamps the human quote id as the invoice id)
// Customer: the invoice's customer_id (or the order's), else a lightweight
// {email,name} from the order so SendInvoiceModal still has a recipient.
export async function resolveOrderInvoiceForSend(base44, order) {
  if (!order?.shop_owner) return { invoice: null, customer: null };

  let invoice = null;
  try {
    const byOrderId = await base44.entities.Invoice.filter({
      shop_owner: order.shop_owner,
      order_id: order.order_id,
    });
    if (byOrderId?.length) {
      invoice = byOrderId[0];
    } else if (order.quote_id) {
      const byQuoteId = await base44.entities.Invoice.filter({
        shop_owner: order.shop_owner,
        invoice_id: order.quote_id,
      });
      if (byQuoteId?.length) invoice = byQuoteId[0];
    }
  } catch {
    return { invoice: null, customer: null };
  }
  if (!invoice) return { invoice: null, customer: null };

  let customer = null;
  const cid = invoice.customer_id || order.customer_id;
  try {
    if (cid) {
      const rows = await base44.entities.Customer.filter({ shop_owner: order.shop_owner, id: cid });
      customer = rows?.[0] || null;
    }
  } catch { /* fall through to the order-derived recipient */ }
  if (!customer && (order.customer_email || order.customer_name)) {
    customer = { email: order.customer_email || "", name: order.customer_name || "" };
  }

  return { invoice, customer };
}
