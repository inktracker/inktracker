// Cross-job inbox of unread customer messages.
//
// Sources every Message row where:
//   - thread_id starts with quote: / order: / invoice: (skip broker chat)
//   - body is NOT internal-tagged
//   - read = false
//   - from_email != current user's email (so my own outbound doesn't show)
//
// Each card links to the parent quote/order/invoice via existing ?id= deep-links.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/supabaseClient";
import {
  Mail, RefreshCw, Loader2, FileText, Package, Receipt, Inbox as InboxIcon, ChevronRight,
} from "lucide-react";
import { parseStoredBody, isInternalBody, stripInternalPrefix } from "@/lib/messageThreads";

const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

const TYPE_META = {
  quote:   { label: "Quote",   route: "/Quotes",   icon: FileText, color: "text-indigo-600 bg-indigo-50" },
  order:   { label: "Order",   route: "/Orders",   icon: Package,  color: "text-emerald-600 bg-emerald-50" },
  invoice: { label: "Invoice", route: "/Invoices", icon: Receipt,  color: "text-amber-600 bg-amber-50" },
};

export default function Inbox() {
  const [me, setMe] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [scanResult, setScanResult] = useState(null);

  useEffect(() => {
    let alive = true;
    base44.auth.me().then((u) => { if (alive) setMe(u); });
    return () => { alive = false; };
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      // Pull unread messages — RLS scopes to ones the current user can read.
      const all = await base44.entities.Message.filter({ read: false }, "-created_date", 500);
      const filtered = all.filter((m) => {
        const tid = m.thread_id || "";
        if (!/^(quote|order|invoice):/i.test(tid)) return false;
        if (isInternalBody(m.body)) return false;
        if (me?.email && (m.from_email || "").toLowerCase() === me.email.toLowerCase()) return false;
        return true;
      });
      setMessages(filtered);
    } catch (err) {
      console.warn("[Inbox] refresh failed:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!me) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.email]);

  async function markRead(message) {
    try {
      await base44.entities.Message.update(message.id, { read: true });
      setMessages((prev) => prev.filter((m) => m.id !== message.id));
    } catch (err) {
      console.warn("[Inbox] markRead failed:", err);
    }
  }

  async function scanNow() {
    setScanError("");
    setScanResult(null);
    setScanning(true);
    try {
      const session = (await (await import("@/api/supabaseClient")).supabase.auth.getSession()).data.session;
      const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/emailScanner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scanReplies", accessToken: session?.access_token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error(data?.error || `Scan failed (${res.status})`);
      }
      setScanResult(data);
      await refresh();
    } catch (err) {
      setScanError(err.message || String(err));
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <header className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <InboxIcon className="w-6 h-6 text-indigo-600" />
            <h1 className="text-2xl font-bold text-slate-900">Inbox</h1>
            {messages.length > 0 && (
              <span className="bg-indigo-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                {messages.length}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500">
            Customer replies across all your quotes, orders, and invoices.
          </p>
        </div>
        <button
          onClick={scanNow}
          disabled={scanning}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-indigo-700 border border-indigo-200 bg-indigo-50 rounded-xl hover:bg-indigo-100 transition disabled:opacity-50"
        >
          {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {scanning ? "Scanning…" : "Check email now"}
        </button>
      </header>

      {scanError && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">
          {scanError}
        </div>
      )}
      {scanResult && (
        <div className="mb-4 text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3">
          Scan complete. {scanResult.repliesAdded ?? 0} new {scanResult.repliesAdded === 1 ? "reply" : "replies"}.
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : messages.length === 0 ? (
        <div className="text-center py-20 bg-white border border-slate-200 rounded-2xl">
          <Mail className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-base font-semibold text-slate-700">All caught up.</p>
          <p className="text-sm text-slate-500 mt-1">
            New customer replies will land here. Click <span className="font-medium">Check email now</span> to pull from Gmail.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((m) => <InboxCard key={m.id} message={m} onMarkRead={() => markRead(m)} />)}
        </div>
      )}
    </div>
  );
}

function InboxCard({ message, onMarkRead }) {
  const tid = message.thread_id || "";
  const [type, refId] = tid.split(":");
  const meta = TYPE_META[type] || TYPE_META.quote;
  const Icon = meta.icon;
  const cleaned = isInternalBody(message.body) ? stripInternalPrefix(message.body) : message.body;
  const { subject, body } = parseStoredBody(cleaned);
  const linkTo = `${meta.route}?id=${encodeURIComponent(refId || "")}`;

  return (
    <article className="bg-white border border-slate-200 rounded-2xl p-4 hover:shadow-md transition">
      <header className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg ${meta.color}`}>
            <Icon className="w-3 h-3" />
            {meta.label} {refId}
          </span>
          <span className="text-sm font-semibold text-slate-700 truncate">
            {message.from_name || message.from_email}
          </span>
        </div>
        <time className="text-xs text-slate-400 shrink-0">{formatStamp(message.created_date)}</time>
      </header>
      {subject && (
        <div className="text-sm font-semibold text-slate-700 mb-1 truncate">{subject}</div>
      )}
      <p className="text-sm text-slate-600 line-clamp-2 leading-relaxed">{body}</p>
      <footer className="flex items-center justify-end gap-2 mt-3">
        <button
          onClick={onMarkRead}
          className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg hover:bg-slate-100 transition"
        >
          Mark read
        </button>
        <Link
          to={linkTo}
          className="flex items-center gap-1 text-xs font-bold text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition"
        >
          Open {meta.label.toLowerCase()}
          <ChevronRight className="w-3 h-3" />
        </Link>
      </footer>
    </article>
  );
}

function formatStamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const days = Math.floor((now - d) / 86400000);
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
