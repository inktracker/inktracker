import { buildQBInvoicePayload } from "@/components/shared/pricing";
import { toCustomerFacingQuote } from "@/lib/quotes/customerFacingQuote";

// Phase B — the broker invoices their END CLIENT at the CLIENT price, in the
// BROKER's own QuickBooks. Called by the broker (their session), so qbSync
// resolves the BROKER's realm + tokens and stamps brokerClientInvoice mode
// server-side from the caller's role.
//
// Pricing is built from toCustomerFacingQuote, which swaps the client-side
// stamps (_client_ppp/_client_lineTotal, client_total, broker_tax_rate) into
// the fields buildQBInvoicePayload reads — so the invoice is the CLIENT price
// with the broker's own client tax, never the wholesale price.
//
// The invoice id + pay link land on the quote's OWN qb_broker_client_* columns
// (never qb_invoice_id, which is the SHOP's realm) so the shop's reconcile and
// webhook never touch this broker-realm invoice.
//
// Idempotent (skips if already invoiced) and FAIL-OPEN: any failure returns
// { ok:false, ... } and never throws — a broker who hasn't connected QB, or a
// transient QB error, must never block "Send to Client". The client just
// approves as before.
export async function createBrokerClientInvoice({ base44, quote, session }) {
  try {
    if (!quote?.broker_id && !quote?.broker_email) {
      return { ok: false, skipped: "not_a_broker_quote" };
    }
    if (quote.qb_broker_client_invoice_id) {
      return { ok: false, skipped: "already_invoiced", qbInvoiceId: quote.qb_broker_client_invoice_id };
    }
    if (!session?.access_token) return { ok: false, error: "Not signed in." };

    // CLIENT-priced payload + the broker's own client tax.
    const clientFacing = toCustomerFacingQuote(quote);
    const invoicePayload = buildQBInvoicePayload(clientFacing);
    if (!invoicePayload?.lines?.length) {
      return { ok: false, error: "No client line pricing on this quote — nothing to invoice." };
    }

    const clientEmail = String(quote.customer_email || "").trim();

    const { data, error } = await base44.functions.invoke("qbSync", {
      action: "createInvoice",
      accessToken: session.access_token,
      noEmail: true, // the broker's own QB doesn't email; the pay link rides the white-label page
      idempotencyKey: `brokerClientInvoice:${quote.id}`,
      quote: {
        // Client-facing shape (client totals/tax), but keep the real id +
        // tenant + human id for docNumber/idempotency/audit.
        ...clientFacing,
        id: quote.id,
        quote_id: quote.quote_id,
        shop_owner: quote.shop_owner,
        customer_email: clientEmail,
      },
      invoicePayload,
      // End client as the customer — NO id / qb_customer_id, so qbSync dedups
      // fresh in the BROKER's realm and never caches a broker-realm QB id onto
      // a shared customers row.
      customer: {
        name: quote.customer_name || clientEmail,
        email: clientEmail,
        company: quote.customer_company || "",
        phone: quote.customer_phone || "",
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
      return { ok: false, error: error.message || "Failed to create the client invoice in QuickBooks." };
    }
    if (data?.error) return { ok: false, error: data.error };
    if (data?.inFlight) return { ok: false, error: data.message || "Another sync for this quote is still running." };

    const qbInvoiceId = data?.qbInvoiceId || data?.qb_invoice_id || null;
    if (!qbInvoiceId) return { ok: false, error: "QuickBooks did not return an invoice id." };

    const updated = await base44.entities.Quote.update(quote.id, {
      qb_broker_client_invoice_id: qbInvoiceId,
      qb_broker_client_doc_number: data?.qbDocNumber || quote.quote_id,
      qb_broker_client_payment_link: data?.paymentLink || data?.qb_payment_link || null,
      qb_broker_client_invoice_synced_at: new Date().toISOString(),
    });

    return {
      ok: true,
      qbInvoiceId,
      paymentLink: data?.paymentLink || data?.qb_payment_link || null,
      quote: updated,
    };
  } catch (err) {
    console.error("[createBrokerClientInvoice] failed (non-fatal):", err?.message || err);
    return { ok: false, error: err?.message || "Broker client invoicing failed." };
  }
}
