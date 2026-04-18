import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/supabaseClient";
import { Bell, CheckCheck, FileText, UserPlus, MessageSquare, Paperclip, ChevronDown, ChevronUp, X, ThumbsUp, ThumbsDown } from "lucide-react";

const ACTION_META = {
  submitted_quote: {
    label: "submitted a quote",
    icon: FileText,
    color: "text-indigo-600",
    bg: "bg-indigo-50",
    page: "Quotes",
  },
  added_client: {
    label: "added a client",
    icon: UserPlus,
    color: "text-emerald-600",
    bg: "bg-emerald-50",
    page: "Customers",
  },
  sent_message: {
    label: "sent a message",
    icon: MessageSquare,
    color: "text-sky-600",
    bg: "bg-sky-50",
    page: "Dashboard",
  },
  uploaded_file: {
    label: "uploaded a file",
    icon: Paperclip,
    color: "text-violet-600",
    bg: "bg-violet-50",
    page: "Dashboard",
  },
  client_approved_quote: {
    label: "client approved a quote — ready to convert to order",
    icon: ThumbsUp,
    color: "text-teal-600",
    bg: "bg-teal-50",
    page: "Quotes",
  },
  client_rejected_quote: {
    label: "client rejected a quote",
    icon: ThumbsDown,
    color: "text-red-500",
    bg: "bg-red-50",
    page: "Quotes",
  },
};

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function BrokerNotificationFeed({ shopOwner, onUnreadCountChange }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  const load = useCallback(async () => {
    const data = await base44.entities.BrokerNotification.filter(
      { shop_owner: shopOwner },
      "-created_date",
      100
    );
    setNotifications(data);
    const unread = data.filter(n => !n.read).length;
    onUnreadCountChange?.(unread);
    setLoading(false);
  }, [shopOwner]);

  useEffect(() => {
    if (shopOwner) load();
  }, [shopOwner, load]);

  async function dismiss(id) {
    await base44.entities.BrokerNotification.update(id, { read: true });
    setNotifications(prev => {
      const updated = prev.map(n => n.id === id ? { ...n, read: true } : n);
      onUnreadCountChange?.(updated.filter(n => !n.read).length);
      return updated;
    });
  }

  async function remove(id) {
    await base44.entities.BrokerNotification.delete(id);
    setNotifications(prev => {
      const updated = prev.filter(n => n.id !== id);
      onUnreadCountChange?.(updated.filter(n => !n.read).length);
      return updated;
    });
  }

  function handleClick(n) {
    if (!n.read) dismiss(n.id);
  }

  async function markAllRead() {
    const unread = notifications.filter(n => !n.read);
    await Promise.all(unread.map(n => base44.entities.BrokerNotification.update(n.id, { read: true })));
    setNotifications(prev => {
      const updated = prev.map(n => ({ ...n, read: true }));
      onUnreadCountChange?.(0);
      return updated;
    });
  }

  if (loading) return <div className="text-sm text-slate-400 py-8 text-center">Loading notifications…</div>;

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-slate-50 border-b border-slate-200">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-2 hover:opacity-70 transition"
        >
          <Bell className="w-4 h-4 text-slate-500" />
          <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">Broker Activity</span>
          {unreadCount > 0 && (
            <span className="bg-indigo-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">{unreadCount} new</span>
          )}
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
        </button>
        {unreadCount > 0 && expanded && (
          <button
            onClick={markAllRead}
            className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Mark All as Read
          </button>
        )}
      </div>

      {/* Feed */}
      {expanded && (
      <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
        {notifications.length === 0 && (
          <div className="py-12 text-center">
            <Bell className="w-8 h-8 text-slate-200 mx-auto mb-2" />
            <p className="text-slate-400 text-sm">No broker activity yet.</p>
          </div>
        )}
        {notifications.map(n => {
          const meta = ACTION_META[n.action] || ACTION_META.sent_message;
          const Icon = meta.icon;

          return (
            <div
              key={n.id}
              className={`flex items-start gap-3 px-5 py-4 transition cursor-pointer ${!n.read ? "bg-indigo-50/50 hover:bg-indigo-100/60" : "bg-white hover:bg-slate-50"}`}
              onClick={() => handleClick(n)}
            >
              {/* Icon */}
              <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5 ${meta.bg}`}>
                <Icon className={`w-4 h-4 ${meta.color}`} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className={`text-sm leading-snug ${!n.read ? "font-semibold text-slate-800" : "font-normal text-slate-700"}`}>
                  <span className="font-bold text-slate-900">{n.broker_name}</span>
                  {n.broker_company && (
                    <span className="text-slate-500 font-normal"> ({n.broker_company})</span>
                  )}
                  {" "}{meta.label}
                  {n.item_label && n.action !== "uploaded_file" && (
                    <span className={`font-semibold ${meta.color}`}> — {n.item_label}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-xs text-slate-400">{timeAgo(n.created_date)}</span>
                </div>
              </div>

              {/* Right side */}
              <div className="shrink-0 flex items-center gap-1.5 mt-0.5">
                {!n.read && <div className="w-2 h-2 rounded-full bg-indigo-500" />}
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