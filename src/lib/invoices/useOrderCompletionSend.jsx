import { useState } from "react";
import { base44 } from "@/api/supabaseClient";
import SendInvoiceModal from "@/components/invoices/SendInvoiceModal";
import { resolveOrderInvoiceForSend } from "./resolveOrderInvoiceForSend";

// After an admin/manager FINISHES an order, offer to email the invoice to the
// customer — the send modal "comes up" so they can review the recipient/message
// and send (or dismiss). Reuses the same SendInvoiceModal as the order-detail
// "Send" button. Returns { promptSend, sendModal }: call promptSend(order)
// right after runOrderCompletion, and render {sendModal} in the page.
//
// Skips silently when it shouldn't prompt: a non-office role, a broker order
// (that billing is the separate Phase A/B, never a shop invoice to the broker's
// client), or an order with no invoice yet (nothing to send).
const OFFICE_ROLES = ["shop", "admin", "manager"];

export function useOrderCompletionSend(user) {
  const [pending, setPending] = useState(null); // { invoice, customer } | null
  const canSend = OFFICE_ROLES.includes(user?.role);

  async function promptSend(order) {
    if (!canSend || !order) return;
    if (order.broker_id) return; // broker billing is its own flow, not this
    try {
      const { invoice, customer } = await resolveOrderInvoiceForSend(base44, order);
      if (invoice) setPending({ invoice, customer });
    } catch {
      /* best-effort — never block or error the completion over a send prompt */
    }
  }

  const sendModal = pending ? (
    <SendInvoiceModal
      invoice={pending.invoice}
      customer={pending.customer}
      onClose={() => setPending(null)}
      onSuccess={() => setPending(null)}
    />
  ) : null;

  return { promptSend, sendModal };
}
