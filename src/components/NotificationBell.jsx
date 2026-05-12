// In-app notification bell. Reads from `notifications` table (RLS-scoped
// to the current shop owner). Polls every 30s for new entries.
//
// Currently the only writer is the qbSync edge function on QB
// reconciliation drift, but the table + this UI are general-purpose
// so future event types can reuse it.

import { useState, useEffect, useRef, useCallback } from "react";
import { Bell, AlertTriangle, Info } from "lucide-react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/supabaseClient";
import { createPageUrl } from "@/utils";

const POLL_INTERVAL_MS = 30_000;
const FETCH_LIMIT = 10;

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const popRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const list = await base44.entities.Notification.list("-created_at", FETCH_LIMIT);
      setNotifs(list);
      setUnreadCount(list.filter((n) => !n.read_at).length);
    } catch (err) {
      // RLS denies / table missing / network blip — keep silent UI, log only.
      console.error("[NotificationBell] load failed:", err?.message ?? err);
    }
  }, []);

  // Initial load + 30s poll.
  useEffect(() => {
    load();
    const t = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Close popover on outside click and Escape.
  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (popRef.current && !popRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markRead(notifId) {
    const now = new Date().toISOString();
    // Optimistic update — UI feels instant.
    setNotifs((prev) => prev.map((n) => n.id === notifId ? { ...n, read_at: now } : n));
    setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      await base44.entities.Notification.update(notifId, { read_at: now });
    } catch (err) {
      console.error("[NotificationBell] markRead failed:", err?.message ?? err);
      // Reload to resync if the update failed.
      load();
    }
  }

  async function markAllRead() {
    const unread = notifs.filter((n) => !n.read_at);
    if (unread.length === 0) return;
    const now = new Date().toISOString();
    setNotifs((prev) => prev.map((n) => n.read_at ? n : { ...n, read_at: now }));
    setUnreadCount(0);
    await Promise.all(
      unread.map((n) =>
        base44.entities.Notification.update(n.id, { read_at: now }).catch(() => {}),
      ),
    );
  }

  return (
    <div className="relative" ref={popRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex items-center px-3 py-2 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition text-slate-500"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 bottom-full mb-2 w-80 sm:w-96 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100">Notifications</div>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {notifs.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-400">No notifications</div>
            ) : (
              notifs.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onMarkRead={() => markRead(n.id)}
                  onClose={() => setOpen(false)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationItem({ notification, onMarkRead, onClose }) {
  const isUnread = !notification.read_at;
  const SeverityIcon =
    notification.severity === "alert"   ? AlertTriangle :
    notification.severity === "warning" ? AlertTriangle :
    Info;
  const iconColor =
    notification.severity === "alert"   ? "text-rose-500"  :
    notification.severity === "warning" ? "text-amber-500" :
    "text-slate-400";

  // Deep-link to the related entity's detail view when we know how.
  let href = null;
  if (notification.related_entity === "quote" && notification.related_id) {
    href = createPageUrl(`Quotes?id=${encodeURIComponent(notification.related_id)}`);
  } else if (notification.related_entity === "invoice" && notification.related_id) {
    href = createPageUrl(`Invoices?id=${encodeURIComponent(notification.related_id)}`);
  } else if (notification.related_entity === "order" && notification.related_id) {
    href = createPageUrl(`Orders?id=${encodeURIComponent(notification.related_id)}`);
  }

  const inner = (
    <div className={`px-4 py-3 border-b border-slate-50 dark:border-slate-800 last:border-b-0 ${isUnread ? "bg-indigo-50/40 dark:bg-indigo-900/10" : "bg-white dark:bg-slate-900"} hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer`}>
      <div className="flex gap-3">
        <SeverityIcon className={`w-4 h-4 ${iconColor} flex-shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{notification.title}</div>
            {isUnread && <span className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0 mt-1.5" aria-label="unread" />}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-3">{notification.body}</div>
          <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
            {new Date(notification.created_at).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );

  return href ? (
    <Link to={href} onClick={() => { onMarkRead(); onClose(); }}>
      {inner}
    </Link>
  ) : (
    <button onClick={onMarkRead} className="block w-full text-left">
      {inner}
    </button>
  );
}
