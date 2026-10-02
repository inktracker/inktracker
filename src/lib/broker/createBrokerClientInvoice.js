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

    // Re-read the tracking column straight from the DB right before creating.
    // The passed quote object can be stale (a "Send to Client" repeated after
    // the qbSync server-side idempotency window has closed) — without this a
    // second send would create a DUPLICATE client invoice in the broker's QB.
    // The in-memory guard above stays for the common fast path; this is the
    // authority. On a read failure we fall through — qbSync's idempotencyKey is
    // still a backstop, and we never want to block a send on a transient read.
    try {
      const fresh = await base44.entities.Quote.get(quote.id);
      if (fresh?.qb_broker_client_invoice_id) {
        return { ok: false, skipped: "already_invoiced", qbInvoiceId: fresh.qb_broker_client_invoice_id };
      }
    } catch { /* transient read error — fall through to the server-side idempotencyKey */ }

    // Guard against wholesale leaking into the CLIENT invoice. When a broker
    // quote has no real client stamps (a legacy/partial row where client_total
    // is 0/NULL), toCustomerFacingQuote falls back to the WHOLESALE line totals
    // — so building here would bill the end client the shop's wholesale price
    // (too low, and it exposes wholesale). Every quote saved through
    // BrokerQuoteEditor stamps both sides, so this only trips on a broken row;
    // refuse rather than send the wrong number to the client.
    if (!(Number(quote.client_total) > 0)) {
      return { ok: false, error: "This quote has no client pricing yet — re-save it before invoicing the client." };
    }

    // Per-line guard: client_total can be > 0 while an individual line is
    // missing its client stamp (a partial/legacy save). toCustomerFacingQuote
    // leaves such a line at its WHOLESALE _lineTotal, so the client invoice
    // would bill that line at the shop's cost (and the pay page would show the
    // wholesale per-piece). Every modern BrokerQuoteEditor save stamps all
    // lines; refuse the malformed row rather than leak wholesale to the client.
    const lineQty = (li) =>
      Object.values(li?.sizes || {}).reduce((s, v) => s + (parseInt(v, 10) || 0), 0);
    const partiallyStamped = (quote.line_items || []).some(
      (li) => lineQty(li) > 0 && !Number.isFinite(li?._client_lineTotal) && li?._client_ppp == null
    );
    if (partiallyStamped) {
      return { ok: false, error: "Some line items are missing client pricing — re-save the quote before invoicing the client." };
    }

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
      // The broker's own client tax is ALWAYS authoritative here: the shop
      // never taxes the broker, and the broker types the exact rate he charges
      // his client (broker_tax_rate → clientFacing.tax_rate → invoicePayload.
      // taxPercent). Push it in "self" mode so it lands correctly even on a
      // FREE / non-AST QuickBooks — the Truman case: QB's Automated Sales Tax
      // returns $0 there, so planSelfTax falls back to pushing the exact tax as
      // its own line and the invoice TOTAL still matches (reconcile passes). On
      // an AST broker QB with a matching rate it records PROPER tracked tax
      // instead. A 0% rate makes couldSelf false in qbSync → unchanged (no
      // tax). See project_inktracker_qb_tax_mode + _shared/qbTaxPlan.js.
      taxMode: "self",
      taxAmount: Number(clientFacing.tax) || 0,
      // End client as the customer — NO id / qb_customer_id, so qbSync dedups
      // fresh in the BROKER's realm and never caches a broker-realm QB id onto
      // a shared customers row.
      customer: {
        name: quote.customer_name || clientEmail,
        email: clientEmail,
        company: quote.customer_company || "",
        phone: quote.customer_phone || "",
        // Propagate the END CLIENT's tax exemption. Without it qbSync computed
        // isTaxExempt from a customer that never carried the flag → an exempt
        // broker client could be charged tax (and self-mode's "proper" path
        // would apply the broker's rate via a tax code). The quote stores it
        // (BrokerQuoteEditor saves tax_exempt); pass it through.
        tax_exempt: !!quote.tax_exempt,
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
      // The client total actually pushed to QB, so a later edit that changes
      // client_total is detectable (isBrokerClientInvoiceStale) and the pay
      // link can be gated — the broker analogue of qb_total/isQbStale.
      qb_broker_client_invoice_total: Number(data?.qbTotal ?? clientFacing.total) || null,
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
