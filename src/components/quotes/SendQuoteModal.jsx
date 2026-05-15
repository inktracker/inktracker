import { useState, useEffect } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import ModalBackdrop from "../shared/ModalBackdrop";
import { Mail, Loader2, CheckCircle2, AlertCircle, X } from "lucide-react";
import { calcQuoteTotals, buildQBInvoicePayload, fmtMoney, BROKER_MARKUP } from "../shared/pricing";
import { exportQuoteToPDF } from "../shared/pdfExport";
import { quoteThreadId, addRefTag, logOutboundMessage } from "@/lib/messageThreads";
import { quotePaymentUrl } from "@/lib/publicUrls";
import { validateQuoteForSend } from "@/lib/quotes/validation";
import { deriveQbSendState } from "@/lib/quotes/qbSendState";
import { useBillingGate } from "@/lib/billing-gate";

function isBrokerQuote(q) {
  return Boolean(q?.broker_id || q?.broker_email || q?.brokerId);
}

function getQuoteTotalsForSend(q) {
  const live = calcQuoteTotals(q || {}, undefined);
  // Prefer saved totals from "calculate once" when available
  if (q && Number.isFinite(q.total) && q.total > 0) {
    live.total = q.total;
    if (Number.isFinite(q.subtotal)) live.sub = q.subtotal;
    if (q.tax != null) live.tax = q.tax;
  }
  return live;
}

export default function SendQuoteModal({ quote, customer, onClose, onSuccess }) {
  const [shopName, setShopName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const [emailsInput, setEmailsInput] = useState(quote.customer_email || customer?.email || "");
  const totals = getQuoteTotalsForSend(quote);

  const [shopTemplate, setShopTemplate] = useState(null);

  // ── Payment provider selection ──────────────────────────────────────
  // "stripe" (default) — customer pays via Stripe Checkout on /quotepayment.
  // "qb"               — customer pays via the QB-issued payment link. The
  //                      shop must explicitly click "Create QB Invoice"
  //                      before Send becomes enabled.
  // The choice is implicit at the data layer: resolveCheckoutTarget picks
  // QB iff quote.qb_payment_link is set. So on Stripe we clear that field;
  // on QB we populate it via the Create Invoice button below.
  const [paymentProvider, setPaymentProvider] = useState(
    quote.qb_payment_link && quote.qb_invoice_id ? "qb" : "stripe"
  );
  const [qbConnected, setQbConnected] = useState(false);
  const [qbInvoiceId, setQbInvoiceId] = useState(quote.qb_invoice_id ?? null);
  const [qbPaymentLink, setQbPaymentLink] = useState(quote.qb_payment_link ?? null);
  const [creatingQbInvoice, setCreatingQbInvoice] = useState(false);
  const [qbError, setQbError] = useState("");

  // Re-fetch the quote from DB on mount to pick up qb_invoice_id /
  // qb_payment_link that the qbSync edge function wrote on a previous
  // Create. The parent (Quotes page → QuoteDetailModal) caches quotes
  // on first load and doesn't auto-refresh, so a stale prop here used
  // to make the Create button reappear after a successful create —
  // a literal duplicate-invoice trap on the highest-stakes surface.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const fresh = await base44.entities.Quote.get(quote.id);
        if (!active || !fresh) return;
        if (fresh.qb_invoice_id   != null) setQbInvoiceId(fresh.qb_invoice_id);
        if (fresh.qb_payment_link != null) setQbPaymentLink(fresh.qb_payment_link);
      } catch (err) {
        // Non-fatal — modal will operate on the parent prop's snapshot.
        console.warn("[SendQuoteModal] quote refresh failed:", err?.message);
      }
    })();
    return () => { active = false; };
  }, [quote.id]);

  // Pure state derivation — tells us whether to show Create, the
  // success bar, or the warning bar, and whether QB state currently
  // blocks Send.
  const qbState = deriveQbSendState({ qbInvoiceId, qbPaymentLink });

  // ── Confirmation gate ───────────────────────────────────────────────
  // Click "Send" → show "Send to {email}? Yes/No" → on Yes, actually fire.
  // Prevents an accidental click from immediately emailing a customer.
  const [confirming, setConfirming] = useState(false);

  // Trial-expired / canceled subs are blocked from sending. Hook reads
  // user from AuthContext (the quote.shop_owner is the shop's email
  // but the user state in context is the currently-signed-in user, who
  // for a sending operation IS the shop owner).
  const { gate: billingGate, isReadOnly: billingReadOnly } = useBillingGate();

  useEffect(() => {
    let active = true;

    // Resolve shop name + saved email template
    if (quote.shop_owner) {
      base44.entities.Shop.filter({ owner_email: quote.shop_owner }, "", 1).then((shops) => {
        if (!active) return;
        if (shops.length > 0) {
          setShopName(shops[0].shop_name || "");
          setShopTemplate({
            subject: shops[0].quote_email_subject || "",
            body: shops[0].quote_email_body || "",
          });
        }
      }).catch(() => {});
    }

    // If email not on quote, try to look it up from the Customer entity
    if (!quote.customer_email && !customer?.email && quote.customer_id) {
      base44.entities.Customer.filter({ id: quote.customer_id }, "", 1).then((results) => {
        if (active && results.length > 0 && results[0].email) {
          setEmailsInput(results[0].email);
        }
      }).catch(() => {});
    }

    // Check QB connection so we know whether to even show the QB option.
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const res = await fetch(`${supabaseUrl}/functions/v1/qbSync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "checkConnection", accessToken: session.access_token }),
        });
        const data = await res.json();
        if (active) setQbConnected(!!data.connected);
      } catch {
        if (active) setQbConnected(false);
      }
    })();

    return () => { active = false; };
  }, [quote.shop_owner, quote.customer_id]);

  // Push the quote to QuickBooks now — gives us a real qbPaymentLink the
  // customer can pay with. Only fires when the user picks "QB" as the
  // payment provider and clicks the explicit "Create QB Invoice" button.
  // Send remains disabled until this succeeds.
  async function handleCreateQbInvoice() {
    setCreatingQbInvoice(true);
    setQbError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not signed in.");
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const customerPayload = customer ?? {
        name: quote.customer_name || "",
        email: quote.customer_email || "",
        phone: "",
        company: "",
      };
      const invoicePayload = buildQBInvoicePayload(
        quote,
        isBrokerQuote(quote) ? BROKER_MARKUP : undefined,
      );
      const res = await fetch(`${supabaseUrl}/functions/v1/qbSync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createInvoice",
          accessToken: session.access_token,
          quote,
          customer: customerPayload,
          invoicePayload,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "QuickBooks rejected the invoice.");
      setQbInvoiceId(data.qbInvoiceId);
      setQbPaymentLink(data.paymentLink || null);
    } catch (err) {
      setQbError(err.message || "Couldn't create the QB invoice. Try again.");
    } finally {
      setCreatingQbInvoice(false);
    }
  }

  const recipientEmails = emailsInput
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);

  useEffect(() => {
    const shop = shopName || "Your Shop";

    function fillPlaceholders(tmpl) {
      return tmpl
        .replace(/\{\{customer_name\}\}/g, quote.customer_name || "")
        .replace(/\{\{quote_id\}\}/g, quote.quote_id || "")
        .replace(/\{\{total\}\}/g, fmtMoney(totals.total))
        .replace(/\{\{shop_name\}\}/g, shop)
        .replace(/\{\{payment_link\}\}/g, quotePaymentUrl(quote.id, quote.public_token));
    }

    if (shopTemplate?.subject) {
      setSubject(fillPlaceholders(shopTemplate.subject));
    } else {
      setSubject(`Your Quote from ${shop} - Quote #${quote.quote_id}`);
    }

    if (shopTemplate?.body) {
      setBody(fillPlaceholders(shopTemplate.body));
    } else {
      setBody(
        `Hi ${quote.customer_name}, your quote is ready for review. Total: ${fmtMoney(totals.total)}. Click below to view, approve, or pay online.`
      );
    }
  }, [shopName, shopTemplate, quote.quote_id, quote.customer_name, totals.total]);

  async function handleSend() {
    setError("");
    setSending(true);

    try {
      // Always link customers through InkTracker's branded approve+pay page;
      // on that page the "Approve & Pay" button redirects to QB's hosted payment
      // link when available (QB invoice is source of truth), falling back to Stripe.
      // The public_token gates anonymous access — without it the quote is unreachable.
      let publicToken = quote.public_token;
      if (!publicToken) {
        // Older quotes may not have a token yet (created before the security fix).
        // Mint one now and persist it. If this fails we MUST abort — sending
        // without a token produces a payment link the customer can't open.
        const fresh = await base44.entities.Quote.update(quote.id, {
          public_token: (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`).replace(/-/g, ""),
        });
        publicToken = fresh?.public_token;
      }

      // Validate everything before the QB invoice / PDF / email work runs.
      // The send path used to fall through silently if the token mint failed,
      // shipping a broken payment link. Hard-abort here instead.
      const sendErrors = validateQuoteForSend(
        { ...quote, customer_email: recipientEmails[0] || quote.customer_email },
        publicToken,
      );
      if (sendErrors) {
        throw new Error(sendErrors.join(" "));
      }

      const paymentLink = quotePaymentUrl(quote.id, publicToken);
      // If the user picked Stripe, make sure no stale qb_payment_link
      // routes the customer to QB on /quotepayment. Authoritative for
      // re-sends after a prior QB push AND for the within-session case
      // where they clicked Create QB Invoice then switched to Stripe.
      if (paymentProvider === "stripe" && (quote.qb_payment_link || qbPaymentLink)) {
        try {
          await base44.entities.Quote.update(quote.id, { qb_payment_link: null });
        } catch (clearErr) {
          console.warn("[SendQuoteModal] could not clear stale qb_payment_link:", clearErr);
        }
      }
      // QB invoice creation (when "QB" is picked) happens BEFORE Send via
      // the explicit "Create QB Invoice" button — handleCreateQbInvoice
      // above. handleSend just emails; the qb_payment_link is already on
      // the quote row by this point.
      const quoteForPdf = { ...quote, public_token: publicToken };

      // Generate PDF attachment — use the shared client-mode generator so it
      // matches the layout used everywhere else in the app.
      let pdfBase64 = null;
      try {
        pdfBase64 = await exportQuoteToPDF(quoteForPdf, {
          mode: "client",
          shopName: shopName || "Your Shop",
          customerCompany: customer?.company || "",
          customerEmail: quote.customer_email || customer?.email || "",
          customerPhone: customer?.phone || "",
          output: "base64",
        });
      } catch (pdfErr) {
        console.warn("[SendQuoteModal] PDF generation failed:", pdfErr);
      }

      // Inject [Ref: <shopCode>-<quoteId>] into the subject so customer replies
      // can be routed back to this thread by emailScanner. The shop code makes
      // the tag globally unique across all shops on the platform.
      const taggedSubject = addRefTag(
        subject || `Your Quote from ${shopName || "Your Shop"} - Quote #${quote.quote_id}`,
        quote.quote_id,
        quote.shop_owner
      );

      const { data: res, error: invokeErr } = await supabase.functions.invoke("sendQuoteEmail", {
        body: {
          customerEmails: recipientEmails,
          customerName: quote.customer_name,
          quoteId: quote.quote_id,
          quoteTotal: totals.total,
          paymentLink,
          approveLink: paymentLink,
          shopName: shopName || "Your Shop",
          subject: taggedSubject,
          body,
          brokerName: quote.broker_name || "",
          brokerEmail: quote.broker_id || quote.broker_email || "",
          pdfBase64,
          pdfFilename: `Quote-${quote.quote_id || "draft"}.pdf`,
          shopOwnerEmail: quote.shop_owner || "",
        },
      });

      if (invokeErr) throw new Error(invokeErr.message);
      if (res?.error) throw new Error(res.error);

      await base44.entities.Quote.update(quote.id, {
        status: "Sent",
        sent_to: recipientEmails.join(", "),
        sent_date: new Date().toISOString(),
        subtotal: totals.sub,
        tax: totals.tax,
        total: totals.total,
        tax_rate: isBrokerQuote(quote) ? 0 : quote.tax_rate,
        customer_email: recipientEmails[0],
      });

      // Log the sent email into the per-job message thread.
      // Best-effort: don't fail the whole flow if this errors.
      const threadId = quoteThreadId(quote);
      if (threadId) {
        await Promise.all(
          recipientEmails.map((to) =>
            logOutboundMessage({
              threadId,
              fromEmail: quote.shop_owner || "",
              fromName: shopName || "Your Shop",
              toEmail: to,
              subject: taggedSubject,
              body: body || `Quote ${quote.quote_id} sent to ${to}.`,
            })
          )
        );
      }

      setSent(true);
      onSuccess?.();
    } catch (err) {
      setError(err.message || "Failed to send email. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200">
          <Mail className="w-5 h-5 text-indigo-600" />
          <h2 className="text-base font-semibold text-slate-900">Send Quote Email</h2>
          <button
            onClick={onClose}
            className="ml-auto text-slate-400 hover:text-slate-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {sent ? (
           <div className="p-8 flex flex-col items-center gap-4 text-center">
             <CheckCircle2 className="w-12 h-12 text-emerald-500" />
             <div>
               <div className="font-semibold text-slate-900 text-base">
                 Email sent successfully
               </div>
               <div className="text-sm text-slate-500 mt-1">Sent to {recipientEmails.join(", ")}</div>
             </div>
             <button
               onClick={onClose}
               className="mt-2 px-6 py-2 text-sm font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition"
             >
               Close
             </button>
           </div>
         ) : (
           <>
             <div className="p-6 space-y-4">
               <div>
                 <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                   To (separate multiple with commas)
                 </label>
                 <input
                   type="text"
                   value={emailsInput}
                   onChange={(e) => setEmailsInput(e.target.value)}
                   disabled={sending}
                   placeholder="email@example.com, another@example.com"
                   className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-slate-50"
                 />
                 {recipientEmails.length > 0 && (
                   <div className="mt-2 flex flex-wrap gap-1.5">
                     {recipientEmails.map((email, i) => (
                       <span key={i} className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full">
                         {email}
                       </span>
                     ))}
                   </div>
                 )}
               </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                  Subject
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={sending}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-slate-50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                  Message
                </label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={sending}
                  rows={3}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-slate-50 resize-none"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Full quote details plus review, approval, and payment actions will be included automatically.
                </p>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-sm text-slate-500">
                  <span>Subtotal</span>
                  <span>{fmtMoney(totals.sub)}</span>
                </div>

                {parseFloat(quote?.discount) > 0 && (() => {
                  const dv = parseFloat(quote.discount);
                  const isFlat = quote.discount_type === "flat" || (dv > 100 && quote.discount_type !== "percent");
                  return (
                    <div className="flex justify-between text-sm text-emerald-600">
                      <span>Discount {isFlat ? `(${fmtMoney(dv)})` : `(${quote.discount}%)`}</span>
                      <span>−{fmtMoney(totals.sub - totals.afterDisc)}</span>
                    </div>
                  );
                })()}

                <div className="flex justify-between text-sm text-slate-500">
                  <span>Tax ({isBrokerQuote(quote) ? 0 : quote?.tax_rate || 0}%)</span>
                  <span>{fmtMoney(totals.tax)}</span>
                </div>

                <div className="flex justify-between font-bold text-slate-900 border-t border-slate-200 pt-2">
                  <span>Total</span>
                  <span className="text-xl">{fmtMoney(totals.total)}</span>
                </div>
              </div>

              {/* ── Payment method picker ─────────────────────────────────── */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Payment method
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className={`flex items-start gap-2 p-3 border rounded-xl cursor-pointer transition ${paymentProvider === "stripe" ? "border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-200" : "border-slate-200 hover:border-slate-300"}`}>
                    <input
                      type="radio"
                      checked={paymentProvider === "stripe"}
                      onChange={() => setPaymentProvider("stripe")}
                      disabled={sending}
                      className="mt-0.5 accent-indigo-600"
                    />
                    <span className="text-sm">
                      <span className="block font-semibold text-slate-800">Stripe</span>
                      <span className="block text-xs text-slate-500 mt-0.5">Customer pays through Stripe Checkout.</span>
                    </span>
                  </label>
                  <label className={`flex items-start gap-2 p-3 border rounded-xl transition ${!qbConnected ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} ${paymentProvider === "qb" ? "border-[#2CA01C] bg-green-50/50 ring-1 ring-green-200" : "border-slate-200 hover:border-slate-300"}`}>
                    <input
                      type="radio"
                      checked={paymentProvider === "qb"}
                      onChange={() => setPaymentProvider("qb")}
                      disabled={sending || !qbConnected}
                      className="mt-0.5 accent-[#2CA01C]"
                    />
                    <span className="text-sm">
                      <span className="block font-semibold text-slate-800">QuickBooks</span>
                      <span className="block text-xs text-slate-500 mt-0.5">
                        {qbConnected ? "Customer pays via the QB invoice link." : "Connect QuickBooks in Account first."}
                      </span>
                    </span>
                  </label>
                </div>

                {/* QB Create / status gate. Branches on qbInvoiceId (NOT
                    qbPaymentLink): once an invoice exists in QB, the
                    Create button must NEVER reappear — re-clicking
                    Create cuts a duplicate QB invoice. Logic + tests
                    live in src/lib/quotes/qbSendState.js. */}
                {paymentProvider === "qb" && qbState.status === "ready" && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <span className="text-xs text-emerald-700 leading-relaxed">
                      QB invoice #{qbInvoiceId} ready. Customer's payment link is set.
                    </span>
                  </div>
                )}

                {paymentProvider === "qb" && qbState.status === "created_no_link" && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-800 leading-relaxed">
                      <div className="font-semibold mb-0.5">QB invoice #{qbInvoiceId} created.</div>
                      {qbState.warning}
                    </div>
                  </div>
                )}

                {paymentProvider === "qb" && qbState.status === "needs_create" && (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={handleCreateQbInvoice}
                      disabled={creatingQbInvoice || sending}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#2CA01C] hover:bg-[#238516] rounded-xl transition disabled:opacity-50"
                    >
                      {creatingQbInvoice ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      {creatingQbInvoice ? "Creating QB invoice…" : "Create QB Invoice"}
                    </button>
                    <p className="text-xs text-slate-500">Required before sending. The QB invoice's payment link is what the customer will use.</p>
                    {qbError && (
                      <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
                        {qbError}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <span className="text-sm text-red-700">{error}</span>
                </div>
              )}
            </div>

            <div className="flex gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
              <button
                onClick={onClose}
                disabled={sending}
                className="flex-1 px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl hover:bg-white transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (billingGate("send quotes to customers")) return;
                  setConfirming(true);
                }}
                disabled={
                  sending ||
                  recipientEmails.length === 0 ||
                  !subject.trim() ||
                  !body.trim() ||
                  (paymentProvider === "qb" && qbState.sendDisabledByQb)
                }
                className="flex-1 px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {sending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Sending...
                  </>
                ) : (
                  <>
                    <Mail className="w-4 h-4" /> Send
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Confirmation overlay — Send is a destructive-feeling action (it emails
          the customer) so a one-step "are you sure?" prevents accidental sends. */}
      {confirming && !sent && (
        <div
          className="absolute inset-0 bg-slate-900/40 flex items-center justify-center p-4"
          onClick={(e) => { e.stopPropagation(); if (!sending) setConfirming(false); }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-slate-900 mb-2">Send this quote?</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              About to email <span className="font-semibold">{recipientEmails.join(", ")}</span> with the {paymentProvider === "qb" ? "QuickBooks" : "Stripe"} payment link.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                disabled={sending}
                className="flex-1 px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await handleSend();
                  // handleSend sets `sent=true` on success; keep confirming up
                  // until then so a failure surfaces the error inline.
                  setConfirming(false);
                }}
                disabled={sending}
                className="flex-1 px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : "Yes, Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ModalBackdrop>
  );
}