import MessagesTab from "../../shared/MessagesTab";
import CollapsibleSection from "../../shared/CollapsibleSection";
import { MessageSquare } from "lucide-react";
import { orderThreadId, quoteThreadId } from "@/lib/messageThreads";

// Messages section for the Order Detail modal: the order thread (with
// reply box) plus a read-only view of the originating quote thread. Pure
// decomposition — moved verbatim from OrderDetailModal.jsx.
export default function OrderMessagesSection({ order, shopName }) {
  return (
    <CollapsibleSection
      title="Messages"
      icon={<MessageSquare className="w-4 h-4 text-slate-500" />}
      storageKey="messages-window-collapsed"
      className="px-4 sm:px-6 py-4 border-t border-slate-200 dark:border-slate-700"
    >
      <MessagesTab
        threadId={orderThreadId(order)}
        currentUserEmail={order.shop_owner}
        replyContext={{
          customerEmail: order.customer_email || "",
          shopName,
          refId: order.order_id,
          defaultSubject: `Order ${order.order_id}`,
        }}
      />
      {order.quote_id && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="text-xs font-semibold text-slate-500 mb-2">
            From originating quote {order.quote_id}
          </div>
          <MessagesTab
            threadId={quoteThreadId(order.quote_id)}
            currentUserEmail={order.shop_owner}
          />
        </div>
      )}
    </CollapsibleSection>
  );
}
