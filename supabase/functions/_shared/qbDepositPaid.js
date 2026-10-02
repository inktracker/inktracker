// Deposit-invoice-paid processing, shared by qbWebhook (real-time) and
// qbReconcile (nightly webhook-miss backstop). One implementation so the
// two paths can never diverge on what "deposit collected" means.
//
// Caller has already (a) matched `quote` by qb_deposit_invoice_id +
// shop_owner and (b) verified the deposit invoice is fully paid in QB.

import { buildDepositPaidPatch } from "./qbDeposit.js";
import { convertQuoteToOrder } from "./qbConvertQuote.js";
import { logEvent } from "./qbAudit.js";
import { insertShopNotification } from "./notifications.js";
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
  // Conversion failure must NOT be silent: the flip above already committed
  // (money collected, deposit_paid=true) and the backstop only scans
  // deposit_paid=false — so a swallowed throw here meant deposit collected,
  // NO ORDER, status logged "success", never repaired (audit 2026-10-02).
  // Don't revert the flip (the payment is real); log status:"error" below and
  // tell the shop to convert manually.
  let convertFailed = null;
  if (!orderId) {
    try {
      orderId = await convertQuoteToOrder(supabase, { ...quote, ...patch });
    } catch (convErr) {
      convertFailed = convErr?.message || String(convErr);
      console.error(`[qbDepositPaid] conversion failed for ${quote.quote_id}:`, convertFailed);
      // Best-effort bell — the EVENT LOG error below is the durable record.
      await insertShopNotification(supabase, {
        shopOwner,
        eventType: "deposit_paid_conversion_failed",
        severity: "error",
        title: `Deposit received for ${quote.quote_id}, but it couldn't convert to an order`,
        body: `The deposit was collected and recorded, but creating the order failed (${convertFailed}). Convert the quote to an order manually.`,
        relatedEntity: "Quote",
        relatedId: quote.id,
      }).catch(() => {});
    }
  }
  // Carry the deposit pointer to the order — and CHECK the write. The pointer
  // is load-bearing (settlement finds the deposit invoice through it at final
  // push, CRITICAL 1), this is the LAST writer (reconcile's deposit backstop
  // only scans deposit_paid=false quotes, so once the flag flips above a
  // failed carry is never repaired), and supabase-js doesn't throw. A
  // swallowed failure here logged status:"success" while the order lacked
  // qb_deposit_invoice_id — so the customer got billed the FULL amount at
  // final push with the deposit never credited (audit 2026-09-30). Log it as
  // an error so operators/reconcile alerts can see and fix it.
  let carryFailed = null;
  if (orderId) {
    const { error: carryErr } = await supabase
      .from("orders")
      .update({
        deposit_paid: true,
        ...(patch.deposit_amount ? { deposit_amount: patch.deposit_amount } : {}),
        // The pointer MUST ride to the order (→ invoice) or settlement
        // can never find the deposit invoice at final push (CRITICAL 1).
        ...(quote.qb_deposit_invoice_id ? { qb_deposit_invoice_id: quote.qb_deposit_invoice_id } : {}),
      })
      .eq("order_id", orderId)
      .eq("shop_owner", shopOwner);
    if (carryErr) {
      carryFailed = carryErr.message;
      console.error(`[qbDepositPaid] deposit-pointer carry to order ${orderId} FAILED: ${carryErr.message} — deposit settlement will not find the deposit invoice at final push`);
    }
  }

  const failure = convertFailed
    ? `quote→order conversion failed: ${convertFailed}`
    : carryFailed
      ? `order deposit-pointer carry failed: ${carryFailed}`
      : null;
  await logEvent(supabase, {
    shop_owner: shopOwner,
    action: source === "reconcile" ? "reconcile_deposit_paid" : "webhook_deposit_paid",
    status: failure ? "error" : "success",
    qb_invoice_id: qbInvoiceId,
    quote_id: quote.id,
    ...(failure ? { error_message: failure } : {}),
    response_body: { quote_id_human: quote.quote_id, order_id: orderId, collected, source, ...(carryFailed ? { carry_failed: true } : {}), ...(convertFailed ? { convert_failed: true } : {}) },
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
