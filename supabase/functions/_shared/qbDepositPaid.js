// Deposit-invoice-paid processing, shared by qbWebhook (real-time) and
// qbReconcile (nightly webhook-miss backstop). One implementation so the
// two paths can never diverge on what "deposit collected" means.
//
// Caller has already (a) matched `quote` by qb_deposit_invoice_id +
// shop_owner and (b) verified the deposit invoice is fully paid in QB.

import { buildDepositPaidPatch } from "./qbDeposit.js";
import { convertQuoteToOrder } from "./qbConvertQuote.js";
import { logEvent } from "./qbAudit.js";
import {
  chooseQuotePaymentRecipient,
  buildQuotePaymentEmail,
  sendAndLogApprovalNotification,
} from "./approvalNotificationEmail.js";

/**
 * Flip deposit_paid (idempotent, race-safe), convert the quote, carry the
 * deposit facts onto the order, log, and email the shop.
 * @returns {Promise<{handled: boolean, flipped: boolean, orderId: string|null}>}
 */
export async function processDepositInvoicePaid(supabase, { quote, qbInvoiceId, shopOwner, qbInvoice, source = "webhook" }) {
  if (!quote) return { handled: false, flipped: false, orderId: null };
  if (quote.deposit_paid) return { handled: true, flipped: false, orderId: quote.converted_order_id || null };

  const collected = Math.max(0, Number(qbInvoice?.TotalAmt ?? 0) - Number(qbInvoice?.Balance ?? 0));
  const patch = buildDepositPaidPatch({ collected, nowIso: new Date().toISOString() });

  // Only the writer that flips false→true proceeds to convert/notify —
  // idempotent under concurrent webhook deliveries AND a webhook/reconcile
  // race on the same night.
  const { data: updated, error: updErr } = await supabase
    .from("quotes")
    .update(patch)
    .eq("id", quote.id)
    .eq("shop_owner", shopOwner)
    .eq("deposit_paid", false)
    .select("id")
    .maybeSingle();
  if (updErr) {
    console.error(`[qbDepositPaid] patch failed for quote ${quote.quote_id}: ${updErr.message}`);
    await logEvent(supabase, {
      shop_owner: shopOwner,
      action: source === "reconcile" ? "reconcile_deposit_paid" : "webhook_deposit_paid",
      status: "error",
      qb_invoice_id: qbInvoiceId,
      quote_id: quote.id,
      error_message: updErr.message,
    });
    return { handled: true, flipped: false, orderId: null };
  }
  if (!updated) return { handled: true, flipped: false, orderId: quote.converted_order_id || null };

  let orderId = quote.converted_order_id || null;
  if (!orderId) {
    try {
      orderId = await convertQuoteToOrder(supabase, { ...quote, ...patch });
    } catch (convErr) {
      console.error(`[qbDepositPaid] conversion failed for ${quote.quote_id}:`, convErr?.message || convErr);
    }
  }
  if (orderId) {
    await supabase
      .from("orders")
      .update({ deposit_paid: true, ...(patch.deposit_amount ? { deposit_amount: patch.deposit_amount } : {}) })
      .eq("order_id", orderId)
      .eq("shop_owner", shopOwner);
  }

  await logEvent(supabase, {
    shop_owner: shopOwner,
    action: source === "reconcile" ? "reconcile_deposit_paid" : "webhook_deposit_paid",
    status: "success",
    qb_invoice_id: qbInvoiceId,
    quote_id: quote.id,
    response_body: { quote_id_human: quote.quote_id, order_id: orderId, collected, source },
  });

  try {
    const recipient = chooseQuotePaymentRecipient(quote);
    let email = null;
    if (recipient) {
      const { data: shopRow } = await supabase
        .from("shops").select("shop_name").eq("owner_email", quote.shop_owner).maybeSingle();
      email = buildQuotePaymentEmail({
        quote, shop: shopRow, customer: null, recipient,
        orderId, amountPaid: collected || Number(quote.deposit_amount) || 0, kind: "deposit",
      });
    }
    await sendAndLogApprovalNotification(supabase, {
      shop_owner: quote.shop_owner,
      event_type: "deposit_payment",
      quote_id: quote.id,
      recipient_email: recipient?.to ?? "",
      recipient_role: recipient?.role,
      to: recipient?.to,
      subject: email?.subject,
      html: email?.html,
      reply_to: email?.reply_to,
    });
  } catch (notifyErr) {
    console.error("[qbDepositPaid] deposit notification failed:", notifyErr?.message || notifyErr);
  }
  return { handled: true, flipped: true, orderId };
}
