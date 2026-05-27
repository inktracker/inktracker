// Broker-side notification feed — the mirror image of BrokerNotificationFeed
// on the shop side. Surfaces actions the SHOP has taken on this broker's
// quotes/orders so the broker doesn't have to scan their quote list to
// notice something changed.
//
// Reads from broker_notifications scoped to broker_id (the broker's email).
// RLS already allows broker_id-keyed reads, so this works without any
// schema or policy changes.
//
// Note: ACTION_META here is intentionally separate from
// BrokerNotificationFeed's map — the wording is broker-facing ("your
// shop did X to your quote") instead of shop-facing ("broker did X").

import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/supabaseClient";
import { Bell, CheckCheck, ChevronDown, ChevronUp, X, ThumbsUp, ThumbsDown, Package, Trash2 } from "lucide-react";
import { timeAgo, unreadCount, markRead, removeById } from "@/lib/broker/notifications";

const ACTION_META = {
  shop_approved_quote: {
    label: "approved your quote",
    icon: ThumbsUp,
    color: "text-emerald-600",
    bg: "bg-emerald-50",
  },
  shop_declined_quote: {
    label: "declined your quote",
    icon: ThumbsDown,
    color: "text-red-500",
    bg: "bg-red-50",
  },
  shop_completed_order: {
    label: "completed your order",
    icon: Package,
    color: "text-green-600",
    bg: "bg-green-50",
  },
  shop_deleted_order: {
    // Fires when the shop deletes a broker-originated order. The source
    // quote is rolled back to "Client Approved" so the broker can resubmit
    // if appropriate — the row label points at the quote_id so they can
    // open it from the notification.
    label: "deleted your order — quote is back in your queue",
    icon: Trash2,
    color: "text-rose-600",
    bg: "bg-rose-50",
  },
};

export default function ShopActionFeed({ brokerId, onUnreadCountChange }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  const load = useCallback(async () => {
    const data = await base44.entities.BrokerNotification.filter(
      { broker_id: brokerId },
      "-created_date",
      100,
    );
    // Only surface SHOP-side actions in the broker view — `data` will also
    // include broker→shop notifications the broker emitted (which RLS lets
    // them see because broker_id matches). We filter those out so the
    // feed reads as a one-way inbox of "what did my shop do?"
    const filtered = (data || []).filter(n => ACTION_META[n.action]);
    setNotifications(filtered);
    onUnreadCountChange?.(unreadCount(filtered));
    setLoading(false);
  }, [brokerId, onUnreadCountChange]);

  useEffect(() => {
    if (brokerId) load();
  }, [brokerId, load]);

  // Realtime: keep the feed in sync with new shop actions + dismissals.
  useEffect(() => {
    if (!brokerId) return;
    const unsub = base44.entities.BrokerNotification.subscribe((payload) => {
      const row = payload?.new || payload?.old;
      if (!row || row.broker_id !== brokerId) return;
      if (!ACTION_META[row.action] && !ACTION_META[payload.old?.action]) return;
      if (payload.eventType === "INSERT") {
        setNotifications(prev => (prev.some(n => n.id === row.id) ? prev : [row, ...prev]));
      } else if (payload.eventType === "UPDATE") {
        setNotifications(prev => prev.map(n => (n.id === row.id ? { ...n, ...row } : n)));
      } else if (payload.eventType === "DELETE") {
        setNotifications(prev => prev.filter(n => n.id !== payload.old?.id));
      }
    });
    return unsub;
  }, [brokerId]);

  // Recompute unread count whenever the local list changes so the parent
  // badge stays accurate without a separate query.
  useEffect(() => {
    onUnreadCountChange?.(unreadCount(notifications));
  }, [notifications, onUnreadCountChange]);

  async function dismiss(id) {
    await base44.entities.BrokerNotification.update(id, { read: true });
    setNotifications(prev => markRead(prev, id));
  }

  async function remove(id) {
    await base44.entities.BrokerNotification.delete(id);
    setNotifications(prev => removeById(prev, id));
  }

  function handleClick(n) {
    if (!n.read) dismiss(n.id);
  }

  async function markAllRead() {
    const unread = notifications.filter(n => !n.read);
    await Promise.all(unread.map(n => base44.entities.BrokerNotification.update(n.id, { read: true })));
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }

  if (loading) return <div className="text-sm text-slate-400 py-6 text-center">Loading notifications…</div>;

  // Hide entirely when empty — the Overview already shows quote rows; an
  // empty feed panel is just noise.
  if (notifications.length === 0) return null;

  const unread = notifications.filter(n => !n.read).length;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-slate-50 border-b border-slate-200">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-2 hover:opacity-70 transition"
        >
          <Bell className="w-4 h-4 text-slate-500" />
          <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">From Your Shop</span>
          {unread > 0 && (
            <span className="bg-teal-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">{unread} new</span>
          )}
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
        </button>
        {unread > 0 && expanded && (
          <button
            onClick={markAllRead}
            className="flex items-center gap-1.5 text-xs font-semibold text-teal-600 hover:text-teal-800 transition"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Mark All as Read
          </button>
        )}
      </div>

      {expanded && (
        <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
          {notifications.map(n => {
            const meta = ACTION_META[n.action];
            const Icon = meta.icon;
            return (
              <div
                key={n.id}
                className={`flex items-start gap-3 px-5 py-4 transition cursor-pointer ${!n.read ? "bg-teal-50/50 hover:bg-teal-100/60" : "bg-white hover:bg-slate-50"}`}
                onClick={() => handleClick(n)}
              >
                <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5 ${meta.bg}`}>
                  <Icon className={`w-4 h-4 ${meta.color}`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className={`text-sm leading-snug ${!n.read ? "font-semibold text-slate-800" : "font-normal text-slate-700"}`}>
                    <span className="text-slate-500">Your shop </span>
                    {meta.label}
                    {n.item_label && (
                      <span className={`font-semibold ${meta.color}`}> — {n.item_label}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-xs text-slate-400">{timeAgo(n.created_date)}</span>
                  </div>
                </div>

                <div className="shrink-0 flex items-center gap-1.5 mt-0.5">
                  {!n.read && <div className="w-2 h-2 rounded-full bg-teal-500" />}
                  <button
                    onClick={e => { e.stopPropagation(); remove(n.id); }}
                    title="Remove"
                    className="w-6 h-6 rounded-full flex items-center justify-center text-slate-300 hover:text-red-400 hover:bg-red-50 transition"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
