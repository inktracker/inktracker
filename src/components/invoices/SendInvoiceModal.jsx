import { useState, useEffect } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { Mail, Loader2, CheckCircle2, X, AlertCircle } from "lucide-react";
import { fmtMoney, buildQBInvoicePayload, getQty } from "../shared/pricing";
import { exportInvoiceToPDF } from "../shared/pdfExport";
import { isValidEmail } from "@/lib/email";
import { invoiceThreadId, addRefTag, logOutboundMessage } from "@/lib/messageThreads";
import { deriveQbSendState } from "@/lib/quotes/qbSendState";
import { resolveCheckoutTarget } from "@/lib/payment/resolveCheckoutTarget";
import ModalBackdrop from "../shared/ModalBackdrop";

export default function SendInvoiceModal({ invoice, customer, onClose, onSuccess }) {
  const [shopName, setShopName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [emailsInput, setEmailsInput] = useState(customer?.email || "");

  // QB state — refetched on mount so a parent that hasn't refreshed
  // after "Create in QB" still sees the latest values.
  const [qbInvoiceId, setQbInvoiceId]     = useState(invoice?.qb_invoice_id   || null);
  const [qbPaymentLink, setQbPaymentLink] = useState(invoice?.qb_payment_link || null);

  useEffect(() => {
    base44.auth.me().then((u) => {
      if (u) {
        setShopName(u.shop_name || "");
        setLogoUrl(u.logo_url || "");
      }
    }).catch(() => {});
  }, []);

  // Refresh QB fields from DB on mount. Parent (InvoiceDetailModal) doesn't
  // re-thread invoice props after "Create in QB" succeeds, so without this
  // the modal could show stale "QB not set up" guidance even after the
  // shop just created the invoice in QB.
  useEffect(() => {
    if (!invoice?.id) return;
    let active = true;
    (async () => {
      try {
        const fresh = await base44.entities.Invoice.get(invoice.id);
        if (!active || !fresh) return;
        if (fresh.qb_invoice_id   != null) setQbInvoiceId(fresh.qb_invoice_id);
        if (fresh.qb_payment_link != null) setQbPaymentLink(fresh.qb_payment_link);
      } catch (err) {
        console.warn("[SendInvoiceModal] invoice refresh failed:", err?.message);
      }
    })();
    return () => { active = false; };
  }, [invoice?.id]);

  useEffect(() => {
    const shop = shopName || "Your Shop";
    setSubject(`Invoice ${invoice.invoice_id} from ${shop}`);
    setBody(
      `Hi ${invoice.customer_name || "there"},\n\nYour invoice is ready.\n\nInvoice: ${invoice.invoice_id}\nTotal: ${fmtMoney(invoice.total)}\n${invoice.due ? `Due: ${invoice.due}` : ""}\n\nPlease let us know if you have any questions.\n\nThank you for your business!\n${shop}`
    );
  }, [shopName, invoice.invoice_id, invoice.customer_name, invoice.total, invoice.due]);

  const recipientEmails = emailsInput.split(",").map((e) => e.trim()).filter((e) => e.length > 0);

  // Only treat the stored link as "real" if it classifies as a QB payment URL.
  // A stale legacy `/portal/asei/…` value would otherwise look like a valid
  // payment link and route the customer to an Intuit login page.
  const checkoutTarget = resolveCheckoutTarget({ qb_payment_link: qbPaymentLink });
  const usablePaymentLink = checkoutTarget.provider === "qb" ? checkoutTarget.url : null;

  const qbState = deriveQbSendState({
    qbInvoiceId,
    qbPaymentLink: usablePaymentLink,
  });

  // Last-ditch attempt to mint a QB payment link when one is missing
  // but a QB invoice already exists. Happens when the customer's saved
  // email is invalid (a name, a phone number) — qbSync strips BillEmail
  // to avoid 400 ValidationFault, but QB's /send endpoint then can't
  // mint a share link without an email to send to.
  //
  // Fix: re-call createInvoice (which takes the UPDATE path since
  // qb_invoice_id is set) with the recipient email overriding
  // quote.customer_email. qbSync prefers quote.customer_email when
  // valid, so this gives the share-link mint a usable email.
  //
  // Best-effort: any failure here is logged and swallowed so the
  // send still goes out, just without a payment link.
  async function tryMintMissingLink(recipientEmail) {
    if (!invoice.qb_invoice_id) return { link: null };       // not even in QB yet — Send button is for after Create
    if (qbPaymentLink) return { link: qbPaymentLink };       // already have one
    if (!isValidEmail(recipientEmail)) return { link: null }; // need a real email to mint with
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return { link: null };
      const quoteShape = {
        ...invoice,
        quote_id: invoice.invoice_id,
        customer_email: recipientEmail, // override the bad one
      };
      let invoicePayload = buildQBInvoicePayload(quoteShape);
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
        invoicePayload = {
          lines,
          discountPercent: invoice.discount_type === "flat" ? 0 : (parseFloat(invoice.discount) || 0),
          discountAmount:  invoice.discount_type === "flat" ? (parseFloat(invoice.discount) || 0) : 0,
          discountType:    invoice.discount_type === "flat" ? "flat" : "percent",
          taxPercent:      parseFloat(invoice.tax_rate) || 0,
          depositAmount:   0,
        };
      }
      const { data } = await supabase.functions.invoke("qbSync", {
        body: {
          action: "createInvoice",
          accessToken: session.access_token,
          quote: quoteShape,
          invoicePayload,
          customer: {
            id: invoice.customer_id,
            name: invoice.customer_name,
            email: recipientEmail, // override — keeps QB customer in sync too
            company: customer?.company || "",
            phone: customer?.phone || "",
            address: customer?.address || "",
            qb_customer_id: customer?.qb_customer_id || "",
            tax_exempt: customer?.tax_exempt || false,
            tax_id: customer?.tax_id || "",
          },
        },
      });
      // TAX HOLD: QB computed a different sales tax than the invoice billed,
      // so qbSync didn't mint a link and the customer send must be blocked.
      if (data?.taxBlocked) {
        return { link: null, taxBlocked: true, detail: data.taxBlockDetail || {} };
      }
      const fresh = data?.paymentLink || data?.qb_payment_link || null;
      if (fresh) {
        setQbPaymentLink(fresh);
        return { link: fresh };
      }
      return { link: null };
    } catch (err) {
      console.warn("[SendInvoiceModal] payment link mint retry failed:", err?.message);
      return { link: null };
    }
  }

  async function handleSend() {
    setError("");
    setSending(true);
    try {
      // If we're missing a payment link but the recipient email is
      // valid, try one more mint with the entered email before sending.
      // Resolves the common case where the customer record has an
      // invalid email (caught by isValidEmail) but the operator typed
      // a real one into the To field.
      let effectiveLink = usablePaymentLink;
      if (!effectiveLink && invoice.qb_invoice_id) {
        const minted = await tryMintMissingLink(recipientEmails[0]);
        // Tax hold: QuickBooks calculated a different sales tax than this
        // invoice. Do NOT send — the customer would be charged a tax we
        // didn't bill. Surface the fix and stop here. See docs/qb-tax-sync.md.
        if (minted?.taxBlocked) {
          const d = minted.detail || {};
          setError(
            `On hold: QuickBooks calculated a different sales tax than this invoice ` +
            `(billed $${Number(d.quotedTax || 0).toFixed(2)}, QuickBooks computed $${Number(d.qbTax || 0).toFixed(2)}). ` +
            `Not sent. Confirm the customer's address & tax status in QuickBooks, fix this invoice's tax rate to match, ` +
            `then Send again. Full guide: docs/qb-tax-sync.md.`
          );
          setSending(false);
          return;
        }
        if (minted?.link) effectiveLink = minted.link;
      }

      // Generate PDF (best-effort; not blocking the send)
      let pdfBase64 = null;
      try {
        pdfBase64 = await exportInvoiceToPDF(invoice, customer, shopName, logoUrl, "base64");
      } catch {}

      const taggedSubject = addRefTag(subject, invoice.invoice_id, invoice.shop_owner);

      // paymentLink renders as a styled "Pay Invoice" button inside the
      // Resend template. Do NOT also append the URL to body — that ships
      // a redundant plain-text link in front of the styled button.
      const { data: res, error: invokeErr } = await supabase.functions.invoke("sendQuoteEmail", {
        body: {
          customerEmails: recipientEmails,
          customerName:   invoice.customer_name || "Customer",
          quoteId:        invoice.invoice_id,
          quoteTotal:     invoice.total ?? null,
          shopName:       shopName || "Your Shop",
          shopLogoUrl:    logoUrl || "",
          subject:        taggedSubject,
          body,
          paymentLink:    effectiveLink,
          approveLink:    effectiveLink,
          buttonLabel:    "Pay Invoice",
          pdfBase64:      pdfBase64 || null,
          pdfFilename:    `Invoice-${invoice.invoice_id || "draft"}.pdf`,
          shopOwnerEmail: invoice.shop_owner || "",
        },
      });

      if (invokeErr) throw new Error(invokeErr.message);
      if (res?.error) throw new Error(res.error);

      await base44.entities.Invoice.update(invoice.id, { status: "Sent" });

      const threadId = invoiceThreadId(invoice);
      if (threadId) {
        await Promise.all(
          recipientEmails.map((to) =>
            logOutboundMessage({
              threadId,
              fromEmail: invoice.shop_owner || "",
              fromName:  shopName || "Your Shop",
              toEmail:   to,
              subject:   taggedSubject,
              body:      body || `Invoice ${invoice.invoice_id} sent to ${to}.`,
              shopOwner: invoice.shop_owner || "",
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
    <ModalBackdrop onClose={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200">
          <Mail className="w-5 h-5 text-teal-600" />
          <h2 className="text-base font-semibold text-slate-900">Send Invoice</h2>
          <button onClick={onClose} aria-label="Close" className="ml-auto text-slate-500 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {sent ? (
          <div className="p-8 flex flex-col items-center gap-4 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500" />
            <div>
              <div className="font-semibold text-slate-900 text-base">Invoice sent successfully</div>
              <div className="text-sm text-slate-500 mt-1">Sent to {recipientEmails.join(", ")}</div>
              {usablePaymentLink && <div className="text-sm text-emerald-600 mt-1">QB payment link included</div>}
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
                  onChange={(e) => setEmailsInput(e.target.value)}
                  disabled={sending}
                  placeholder="email@example.com"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:bg-slate-50"
                />
                {recipientEmails.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {recipientEmails.map((email, i) => (
                      <span key={i} className="text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-100 px-2.5 py-1 rounded-full">
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
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={sending}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:bg-slate-50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Message</label>
                <textarea
                  rows={6}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={sending}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:bg-slate-50 resize-none font-mono"
                />
              </div>

              {/* QB readiness — reuses the same state machine as SendQuoteModal
                  (qbSendState). Branches on qb_invoice_id so the user never sees
                  conflicting "QB invoice missing" messaging after a successful
                  Create in QB. */}
              {qbState.status === "ready" && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <span className="text-xs text-emerald-700 leading-relaxed">
                    QB invoice #{qbInvoiceId} ready. Customer's "Pay Invoice" button will link to the QuickBooks portal.
                  </span>
                </div>
              )}

              {/* QB readiness is informational, not blocking. Shops that
                  don't use QB (or take payment via Stripe / check / wire)
                  can still send the invoice — the email just won't carry
                  a QB Pay button. Adding your own payment instructions in
                  the message body above is the alternative. */}
              {qbState.status === "needs_create" && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-800 leading-relaxed">
                    <div className="font-semibold mb-0.5">No QuickBooks payment link will be included.</div>
                    If you use QB, close this and click <span className="font-semibold">Create in QB</span> first to add a Pay button. Otherwise add your own payment instructions to the message above and send away.
                  </div>
                </div>
              )}

              {qbState.status === "send_failed" && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <div className="text-xs text-red-700 leading-relaxed">
                    <div className="font-semibold mb-0.5">QB invoice #{qbInvoiceId} exists, but no payment link.</div>
                    The email will go out without a QB Pay button. Close this and click <span className="font-semibold">Create in QB</span> again to retry the share-link mint, or send now and include your own payment instructions above.
                  </div>
                </div>
              )}

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
                className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition disabled:opacity-50"
              >
                {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : <><Mail className="w-4 h-4" /> Send Invoice</>}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalBackdrop>
  );
}
