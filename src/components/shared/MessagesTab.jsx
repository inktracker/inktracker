// Threaded message view for a single job (quote / order / invoice).
// PR1: read-only — shows outbound history. Reply box ships in PR2.
//
// thread_id convention: "{type}:{external_id}"
//   "quote:Q-2026-115"   "order:ORD-2026-077"   "invoice:INV-2026-014"
//
// The same `messages` table is used by BrokerMessaging — different thread_id
// prefix (`broker:`) keeps the namespaces separate.

import { useEffect, useState } from "react";
import { base44 } from "@/api/supabaseClient";
import { Mail, MailOpen, Loader2, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { parseStoredBody } from "@/lib/messageThreads";

export default function MessagesTab({ threadId, currentUserEmail }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!threadId) return;
    let alive = true;

    base44.entities.Message
      .filter({ thread_id: threadId }, "created_date", 200)
      .then((msgs) => { if (alive) { setMessages(msgs); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });

    // Live-update if Supabase realtime is set up for messages.
    let unsub;
    try {
      unsub = base44.entities.Message.subscribe?.((event) => {
        if (event.data?.thread_id !== threadId) return;
        if (event.type === "create") {
          setMessages((prev) => prev.some((m) => m.id === event.data.id) ? prev : [...prev, event.data]);
        }
      });
    } catch { /* subscribe not available — ignore */ }

    return () => {
      alive = false;
      try { unsub?.(); } catch {}
    };
  }, [threadId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="py-10 text-center">
        <Mail className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm text-slate-500">No messages yet for this job.</p>
        <p className="text-xs text-slate-400 mt-1">Sent emails will appear here automatically.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {messages.map((m) => {
        const outbound = isOutbound(m, currentUserEmail);
        const { subject, body } = parseStoredBody(m.body);
        return (
          <article
            key={m.id}
            className={`rounded-xl border p-4 ${outbound ? "bg-indigo-50/50 border-indigo-100" : "bg-white border-slate-200"}`}
          >
            <header className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                {outbound
                  ? <ArrowUpRight className="w-4 h-4 text-indigo-500 shrink-0" />
                  : <ArrowDownLeft className="w-4 h-4 text-emerald-600 shrink-0" />
                }
                <span className="text-xs font-semibold text-slate-700 truncate">
                  {outbound ? "Sent" : "Received"} · {m.from_name || m.from_email}
                </span>
                {!outbound && !m.read && (
                  <span className="text-[10px] font-bold uppercase bg-emerald-500 text-white px-1.5 py-0.5 rounded">New</span>
                )}
              </div>
              <time className="text-xs text-slate-400 shrink-0">{formatStamp(m.created_date)}</time>
            </header>
            {subject && (
              <div className="text-xs font-semibold text-slate-600 mb-1 truncate">
                {subject}
              </div>
            )}
            <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
              {body || <span className="text-slate-400 italic">No content recorded.</span>}
            </div>
            {m.to_email && outbound && (
              <div className="text-xs text-slate-400 mt-2 flex items-center gap-1">
                <MailOpen className="w-3 h-3" /> to {m.to_email}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function isOutbound(m, currentUserEmail) {
  // Outbound = current shop user is the sender.
  if (!currentUserEmail) return false;
  return (m.from_email || "").toLowerCase() === currentUserEmail.toLowerCase();
}

function formatStamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " · " +
         d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
