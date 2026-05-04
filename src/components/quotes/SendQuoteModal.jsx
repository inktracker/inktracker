import { useState, useEffect } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { Mail, Loader2, CheckCircle2, AlertCircle, X } from "lucide-react";
import { calcQuoteTotals, buildQBInvoicePayload, fmtMoney, BROKER_MARKUP } from "../shared/pricing";
import { exportQuoteToPDF } from "../shared/pdfExport";
import { quoteThreadId, addRefTag, logOutboundMessage } from "@/lib/messageThreads";

function isBrokerQuote(q) {
  return Boolean(q?.broker_id || q?.broker_email || q?.brokerId);
}

function getQuoteTotalsForSend(q) {
  // For broker quotes sending to client, use STANDARD_MARKUP (client-facing price)
  // For regular shop quotes, use default markup
  return calcQuoteTotals(q || {}, undefined);
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
      });
    }

    // If email not on quote, try to look it up from the Customer entity
    if (!quote.customer_email && !customer?.email && quote.customer_id) {
      base44.entities.Customer.filter({ id: quote.customer_id }, "", 1).then((results) => {
        if (active && results.length > 0 && results[0].email) {
          setEmailsInput(results[0].email);
        }
      }).catch(() => {});
    }

    return () => { active = false; };
  }, [quote.shop_owner, quote.customer_id]);

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
        .replace(/\{\{payment_link\}\}/g, `${window.location.origin}/quotepayment?id=${quote.id}`);
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
      const paymentLink = `${window.location.origin}/quotepayment?id=${quote.id}`;
      let quoteForPdf = quote;

      // Create the QB invoice now — its paymentLink will be used when the
      // customer clicks Approve & Pay on /quotepayment.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
          const customerPayload = customer ?? {
            name: quote.customer_name || "",
            email: quote.customer_email || "",
            phone: "",
            company: "",
          };
          const invoicePayload = buildQBInvoicePayload(
            quote,
            isBrokerQuote(quote) ? BROKER_MARKUP : undefined
          );
          const qbRes = await fetch(`${supabaseUrl}/functions/v1/qbSync`, {
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
          const qbData = await qbRes.json();
          if (qbRes.ok && !qbData.error && qbData.qbTotal != null) {
            // Merge QB-computed totals so the PDF/email reflect the final invoice
            quoteForPdf = {
              ...quote,
              qb_total:      qbData.qbTotal,
              qb_tax_amount: qbData.qbTaxAmount,
              qb_subtotal:   qbData.qbSubtotal,
            };
          }
        }
      } catch {
        // QB failed — fall back to InkTracker link silently
      }

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

      // Inject [Ref: <quoteId>] into the subject so customer replies can be
      // routed back to this thread by emailScanner (PR2).
      const taggedSubject = addRefTag(
        subject || `Your Quote from ${shopName || "Your Shop"} - Quote #${quote.quote_id}`,
        quote.quote_id
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
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
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
                onClick={handleSend}
                disabled={sending || recipientEmails.length === 0 || !subject.trim() || !body.trim()}
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
    </div>
  );
}