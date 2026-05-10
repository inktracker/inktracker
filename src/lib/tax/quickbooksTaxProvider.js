import { EMPTY_CALC } from "./taxProvider";

/**
 * QuickBooksTaxProvider — pushes the invoice to QBO and lets QBO's AST
 * (Automated Sales Tax) compute the actual tax. Local tax fields are written
 * back from the QBO response.
 *
 * Why we don't compute locally: QBO's tax engine knows the customer's tax
 * settings, jurisdictional nexus, and any tax overrides. Trying to mirror it
 * client-side leads to drift and accountant complaints. We push, then trust
 * what QBO returns.
 *
 * `calculate()` returns nulls until the invoice has been pushed (no values
 * are knowable before QBO responds). After push, the persisted `qb_tax` /
 * `qb_total` on the quote are returned.
 */

const SHIP_TO_KEYS = ["street", "city", "state", "zip", "country"];

function pickShipTo(customer) {
  const src = customer?.ship_to_address;
  if (!src || typeof src !== "object") return null;
  const out = {};
  for (const k of SHIP_TO_KEYS) {
    if (src[k] != null && src[k] !== "") out[k] = src[k];
  }
  return Object.keys(out).length ? out : null;
}

function lineSubtotal(line) {
  if (Number.isFinite(line?._lineTotal)) return Number(line._lineTotal);
  if (Number.isFinite(line?.subtotal))   return Number(line.subtotal);
  if (Number.isFinite(line?.amount))     return Number(line.amount);
  return 0;
}

function lineUnitPrice(line) {
  if (Number.isFinite(line?._ppp)) return Number(line._ppp);
  const qty = Number(line?.qty) || 0;
  const sub = lineSubtotal(line);
  return qty > 0 ? sub / qty : 0;
}

/**
 * Build the QBO Invoice JSON for `quote`. Per-line TaxCodeRef is set from
 * the line's `taxable` flag (default true). `BillAddr`/`ShipAddr` come from
 * `customer.ship_to_address`. `TxnTaxDetail: {}` opts the invoice into AST.
 *
 * The returned shape is what gets POSTed to the qbSync edge function. The
 * edge function relays it to QBO; AST runs server-side at QBO and the
 * response carries the final tax/total.
 */
export function buildQBOInvoiceJSON(quote, { customer = {} } = {}) {
  const items = Array.isArray(quote?.line_items) ? quote.line_items : [];
  const customerTaxable = customer.taxable !== false && customer.tax_exempt !== true;

  const Line = items.map((li, idx) => {
    const lineTaxable = customerTaxable && li?.taxable !== false;
    const qty = Number(li?.qty) || 0;
    const amount = lineSubtotal(li);
    return {
      Id: String(idx + 1),
      LineNum: idx + 1,
      Amount: Number(amount.toFixed(2)),
      DetailType: "SalesItemLineDetail",
      Description: li?.description || li?.name || "Line item",
      SalesItemLineDetail: {
        Qty: qty,
        UnitPrice: Number(lineUnitPrice(li).toFixed(4)),
        TaxCodeRef: { value: lineTaxable ? "TAX" : "NON" },
      },
    };
  });

  const shipTo = pickShipTo(customer);
  const payload = {
    Line,
    // Empty TxnTaxDetail signals to QBO that we want AST to calculate.
    TxnTaxDetail: {},
    CustomerMemo: { value: quote?.notes || "" },
  };
  if (shipTo) {
    payload.BillAddr = { Line1: shipTo.street, City: shipTo.city, CountrySubDivisionCode: shipTo.state, PostalCode: shipTo.zip, Country: shipTo.country };
    payload.ShipAddr = { Line1: shipTo.street, City: shipTo.city, CountrySubDivisionCode: shipTo.state, PostalCode: shipTo.zip, Country: shipTo.country };
  }
  return payload;
}

/**
 * Apply the QBO response back onto the local quote. Returns the updates
 * (the caller is responsible for persisting via base44/supabase).
 */
export function syncBackFromQBO(quote, qbResponse) {
  const tax   = qbResponse?.qb_tax   ?? qbResponse?.qbTax   ?? null;
  const total = qbResponse?.qb_total ?? qbResponse?.qbTotal ?? null;
  const externalId = qbResponse?.qbInvoiceId ?? qbResponse?.qb_invoice_id ?? null;
  return {
    ...quote,
    qb_invoice_id: externalId ?? quote?.qb_invoice_id,
    qb_tax:        tax        ?? quote?.qb_tax,
    qb_total:      total      ?? quote?.qb_total,
  };
}

/**
 * Factory. `httpClient` is injectable for tests — defaults to global fetch.
 * `qbSyncUrl` is the URL of the existing qbSync edge function.
 */
export function createQuickBooksTaxProvider({
  httpClient = (typeof fetch !== "undefined" ? fetch : null),
  qbSyncUrl,
  accessToken,
} = {}) {
  if (typeof httpClient !== "function") {
    throw new Error("QuickBooksTaxProvider requires an HTTP client (fetch)");
  }
  if (!qbSyncUrl) {
    throw new Error("QuickBooksTaxProvider requires qbSyncUrl");
  }

  return {
    mode: "quickbooks",

    calculate(quote /*, ctx */) {
      // Pre-push: nothing to report. Post-push: surface the persisted QBO values.
      if (Number.isFinite(quote?.qb_total)) {
        return {
          lineTax: [],
          totalTax: Number(quote.qb_tax) || 0,
          rate: null,
          jurisdiction: null,
        };
      }
      return { ...EMPTY_CALC };
    },

    async pushInvoice(quote, { customer = {}, invoicePayload } = {}) {
      const qboInvoice = buildQBOInvoiceJSON(quote, { customer });
      const body = {
        action: "createInvoice",
        accessToken,
        quote,
        customer,
        // We send BOTH:
        //  - `invoicePayload` for the existing qbSync edge fn contract (line
        //    pricing, deposit, etc.) — backwards compatible.
        //  - `qboInvoice` with per-line TaxCodeRef + ship_to + TxnTaxDetail{}
        //    so once the edge fn opts in, AST runs against the correct shape.
        invoicePayload,
        qboInvoice,
      };

      const res = await httpClient(qbSyncUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        const msg = data?.error || `QB sync failed (${res.status})`;
        const err = new Error(msg);
        err.status = res.status;
        throw err;
      }

      return {
        externalId: data.qbInvoiceId ?? null,
        taxFromProvider: data.qb_tax ?? null,
        totalFromProvider: data.qb_total ?? null,
        // Echo full response so the caller can sync-back via syncBackFromQBO.
        raw: data,
      };
    },
  };
}
