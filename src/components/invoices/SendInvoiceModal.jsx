import { useState, useEffect } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { Mail, Loader2, CheckCircle2, X } from "lucide-react";
import { fmtMoney, buildQBInvoicePayload } from "../shared/pricing";
import { exportInvoiceToPDF } from "../shared/pdfExport";
import { invoiceThreadId, addRefTag, logOutboundMessage } from "@/lib/messageThreads";

const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

export default function SendInvoiceModal({ invoice, customer, onClose, onSuccess }) {
  const [shopName, setShopName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [paymentLink, setPaymentLink] = useState("");

  const [emailsInput, setEmailsInput] = useState(customer?.email || "");

  useEffect(() => {
    base44.auth.me().then(u => {
      if (u) {
        setShopName(u.shop_name || "");
        setLogoUrl(u.logo_url || "");
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const shop = shopName || "Your Shop";
    setSubject(`Invoice ${invoice.invoice_id} from ${shop}`);
    setBody(
      `Hi ${invoice.customer_name || "there"},\n\nYour invoice is ready.\n\nInvoice: ${invoice.invoice_id}\nTotal: ${fmtMoney(invoice.total)}\n${invoice.due ? `Due: ${invoice.due}` : ""}\n\nPlease let us know if you have any questions.\n\nThank you for your business!\n${shop}`
    );
  }, [shopName, invoice.invoice_id, invoice.customer_name, invoice.total]);

  const recipientEmails = emailsInput.split(",").map(e => e.trim()).filter(e => e.length > 0);

  async function handleSend() {
    setError("");
    setSending(true);
    try {
      // Fetch latest invoice data in case QB link was added after this modal opened
      let qbPayLink = invoice.qb_payment_link || "";
      if (!qbPayLink) {
        try {
          const fresh = await base44.entities.Invoice.get(invoice.id);
          if (fresh?.qb_payment_link) qbPayLink = fresh.qb_payment_link;
        } catch {}
      }

      // If still no QB link, create the invoice in QB now
      if (!qbPayLink) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.access_token) {
            const quoteShape = {
              ...invoice,
              quote_id: invoice.invoice_id,
              customer_email: recipientEmails[0] || customer?.email || "",
            };
            const invoicePayload = buildQBInvoicePayload(quoteShape);
            const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/qbSync`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "createInvoice",
                accessToken: session.access_token,
                quote: quoteShape,
                invoicePayload,
                customer: {
                  id: invoice.customer_id,
                  name: invoice.customer_name,
                  email: recipientEmails[0] || customer?.email || "",
                  company: customer?.company || "",
                  phone: customer?.phone || "",
                  address: customer?.address || "",
                  qb_customer_id: customer?.qb_customer_id || "",
                  tax_exempt: customer?.tax_exempt || false,
                  tax_id: customer?.tax_id || "",
                },
              }),
            });
            const data = await res.json();
            if (res.ok && !data.error) {
              qbPayLink = data.paymentLink || "";
              if (qbPayLink) {
                await base44.entities.Invoice.update(invoice.id, { qb_payment_link: qbPayLink });
              }
            } else {
              console.warn("[SendInvoice] QB create failed:", data.error || res.status);
            }
          }
        } catch (err) {
          console.warn("[SendInvoice] QB exception:", err?.message);
        }
      }

      // Generate PDF
      let pdfBase64 = null;
      try {
        pdfBase64 = await exportInvoiceToPDF(invoice, customer, shopName, logoUrl, "base64");
      } catch {}

      const finalBody = qbPayLink
        ? `${body}\n\nPay online: ${qbPayLink}`
        : body;
      setPaymentLink(qbPayLink);

      const taggedSubject = addRefTag(subject, invoice.invoice_id, invoice.shop_owner);

      const { data: res, error: invokeErr } = await supabase.functions.invoke("sendQuoteEmail", {
        body: {
          customerEmails: recipientEmails,
          customerName: invoice.customer_name || "Customer",
          quoteId: invoice.invoice_id,
          shopName: shopName || "Your Shop",
          subject: taggedSubject,
          body: finalBody,
          paymentLink: qbPayLink || "",
          approveLink: qbPayLink || "",
          buttonLabel: "View Invoice & Pay Online",
          pdfBase64: pdfBase64 || null,
          pdfFilename: `Invoice-${invoice.invoice_id || "draft"}.pdf`,
          shopOwnerEmail: invoice.shop_owner || "",
        },
      });

      if (invokeErr) throw new Error(invokeErr.message);
      if (res?.error) throw new Error(res.error);

      // Update invoice status
      await base44.entities.Invoice.update(invoice.id, {
        status: "Sent",
      });

      // Log to per-job message thread (best-effort).
      const threadId = invoiceThreadId(invoice);
      if (threadId) {
        await Promise.all(
          recipientEmails.map((to) =>
            logOutboundMessage({
              threadId,
              fromEmail: invoice.shop_owner || "",
              fromName: shopName || "Your Shop",
              toEmail: to,
              subject: taggedSubject,
              body: finalBody || `Invoice ${invoice.invoice_id} sent to ${to}.`,
            })
          )
        );
      }

      setSent(true);
      onSuccess?.();
    } catch (err) {
      setError(err.message || "Failed to send. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200">
          <Mail className="w-5 h-5 text-indigo-600" />
          <h2 className="text-base font-semibold text-slate-900">Send Invoice</h2>
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {sent ? (
          <div className="p-8 flex flex-col items-center gap-4 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500" />
            <div>
              <div className="font-semibold text-slate-900 text-base">Invoice sent successfully</div>
              <div className="text-sm text-slate-500 mt-1">Sent to {recipientEmails.join(", ")}</div>
              {paymentLink && <div className="text-sm text-emerald-600 mt-1">QB payment link included</div>}
            </div>
            <button onClick={onClose} className="mt-2 px-6 py-2 text-sm font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition">
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
                  onChange={e => setEmailsInput(e.target.value)}
                  disabled={sending}
                  placeholder="email@example.com"
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
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  disabled={sending}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-slate-50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Message</label>
                <textarea
                  rows={6}
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  disabled={sending}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-slate-50 resize-none font-mono"
                />
              </div>

              <div className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2">
                {invoice.qb_invoice_id || invoice.qb_payment_link
                  ? "This invoice is already in QuickBooks — the existing payment link will be included."
                  : "A QuickBooks invoice will be created and the payment link appended to your message."}
              </div>

              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2">{error}</div>
              )}
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
              <button onClick={onClose} disabled={sending} className="px-4 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 rounded-xl transition">
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending || recipientEmails.length === 0}
                className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition disabled:opacity-50"
              >
                {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : <><Mail className="w-4 h-4" /> Send Invoice</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
