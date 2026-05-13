// Threaded message view for a single job (quote / order / invoice).
//
// thread_id convention: "{type}:{external_id}"
//   "quote:Q-2026-115"   "order:ORD-2026-077"   "invoice:INV-2026-014"
//
// The same `messages` table is used by BrokerMessaging — different thread_id
// prefix (`broker:`) keeps the namespaces separate.
//
// Pass `replyContext` to enable the inline reply box. Internal notes are
// supported by tagging the body with [INTERNAL] which MessagesTab renders
// differently and skips emailing.

import { useEffect, useState } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { Mail, MailOpen, Loader2, ArrowUpRight, ArrowDownLeft, Send, Lock, AlertCircle } from "lucide-react";
import {
  parseStoredBody,
  addRefTag,
  logOutboundMessage,
  INTERNAL_PREFIX,
  isInternalBody,
  stripInternalPrefix,
} from "@/lib/messageThreads";

const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

export default function MessagesTab({ threadId, currentUserEmail, replyContext }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!threadId) return;
    let alive = true;

    base44.entities.Message
      .filter({ thread_id: threadId }, "created_date", 200)
      .then((msgs) => {
        if (!alive) return;
        // Auto-mark inbound messages as read when the thread is viewed.
        // emailScanner inserts customer replies with read=false (correct
        // — they're unread until the shop owner sees them). Without this
        // step the "New" badge would stay forever because nothing else
        // marks them read.
        let unread = [];
        if (currentUserEmail) {
          unread = msgs.filter((m) =>
            !m.read &&
            (m.from_email || "").toLowerCase() !== currentUserEmail.toLowerCase(),
          );
          // Fire-and-forget — failure here just keeps the badge until next
          // open, doesn't break the thread view.
          unread.forEach((m) => {
            base44.entities.Message.update(m.id, { read: true }).catch(() => null);
          });
        }
        const merged = unread.length > 0
          ? msgs.map((m) => unread.some((u) => u.id === m.id) ? { ...m, read: true } : m)
          : msgs;
        setMessages(merged);
        setLoading(false);
      })
      .catch(() => { if (alive) setLoading(false); });

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
  }, [threadId, currentUserEmail]);

  function appendLocally(row) {
    setMessages((prev) => [...prev, row]);
  }

  return (
    <div className="space-y-3">
      <MessageList messages={messages} loading={loading} currentUserEmail={currentUserEmail} />
      {replyContext && (
        <ReplyBox
          replyContext={replyContext}
          threadId={threadId}
          currentUserEmail={currentUserEmail}
          onPosted={appendLocally}
        />
      )}
    </div>
  );
}

function MessageList({ messages, loading, currentUserEmail }) {
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
        <p className="text-xs text-slate-400 mt-1">Sent emails and customer replies will appear here.</p>
      </div>
    );
  }
  return (
    <>
      {messages.map((m) => {
        const internal = isInternalBody(m.body);
        const outbound = isOutbound(m, currentUserEmail);
        const cleaned = internal ? stripInternalPrefix(m.body) : m.body;
        const { subject, body } = parseStoredBody(cleaned);
        return (
          <article
            key={m.id}
            className={`rounded-xl border p-4 ${
              internal
                ? "bg-amber-50/60 border-amber-200"
                : outbound
                  ? "bg-indigo-50/50 border-indigo-100"
                  : "bg-white border-slate-200"
            }`}
          >
            <header className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                {internal
                  ? <Lock className="w-4 h-4 text-amber-600 shrink-0" />
                  : outbound
                    ? <ArrowUpRight className="w-4 h-4 text-indigo-500 shrink-0" />
                    : <ArrowDownLeft className="w-4 h-4 text-emerald-600 shrink-0" />
                }
                <span className="text-xs font-semibold text-slate-700 truncate">
                  {internal ? "Internal note" : outbound ? "Sent" : "Received"} · {m.from_name || m.from_email}
                </span>
                {!outbound && !internal && !m.read && (
                  <span className="text-[10px] font-bold uppercase bg-emerald-500 text-white px-1.5 py-0.5 rounded">New</span>
                )}
              </div>
              <time className="text-xs text-slate-400 shrink-0">{formatStamp(m.created_date)}</time>
            </header>
            {subject && (
              <div className="text-xs font-semibold text-slate-600 mb-1 truncate">{subject}</div>
            )}
            <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
              {body || <span className="text-slate-400 italic">No content recorded.</span>}
            </div>
            {!internal && m.to_email && outbound && (
              <div className="text-xs text-slate-400 mt-2 flex items-center gap-1">
                <MailOpen className="w-3 h-3" /> to {m.to_email}
              </div>
            )}
          </article>
        );
      })}
    </>
  );
}

function ReplyBox({ replyContext, threadId, currentUserEmail, onPosted }) {
  const { customerEmail, shopName, refId, defaultSubject } = replyContext;
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const canSend = body.trim().length > 0 && !sending;
  const hasRecipient = !!customerEmail;

  async function handleSend() {
    setError("");
    if (!body.trim()) return;
    if (!internal && !hasRecipient) {
      setError("No customer email on file. Add one to send a reply, or check Internal note.");
      return;
    }
    setSending(true);

    const subject = addRefTag(`Re: ${defaultSubject || refId || "Update"}`, refId, currentUserEmail);

    try {
      // INTERNAL NOTES: skip email, just log a Message row tagged INTERNAL.
      if (internal) {
        const row = await logOutboundMessage({
          threadId,
          fromEmail: currentUserEmail,
          fromName: shopName || currentUserEmail,
          toEmail: "",
          subject,
          body: `${INTERNAL_PREFIX}${body.trim()}`,
        });
        if (row) onPosted?.(row);
        setBody("");
        setInternal(false);
        return;
      }

      // PUBLIC REPLY: hit sendReply edge function, then log the Message row.
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/sendReply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          to: customerEmail,
          subject,
          body: body.trim(),
          shopName: shopName || "InkTracker",
          shopOwnerEmail: currentUserEmail,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error(data?.error || `Send failed (${res.status})`);
      }

      const row = await logOutboundMessage({
        threadId,
        fromEmail: currentUserEmail,
        fromName: shopName || currentUserEmail,
        toEmail: customerEmail,
        subject,
        body: body.trim(),
      });
      if (row) onPosted?.(row);
      setBody("");
    } catch (err) {
      setError(err.message || "Failed to send.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 mt-3">
      {error && (
        <div className="flex items-start gap-2 text-xs text-red-600 mb-2 bg-red-50 border border-red-100 rounded-lg p-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={internal ? "Internal note (visible to your shop only)…" : `Reply to ${customerEmail || "customer"}…`}
        rows={3}
        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
      />
      <div className="flex items-center justify-between mt-2 gap-2">
        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={internal}
            onChange={(e) => setInternal(e.target.checked)}
            className="w-3.5 h-3.5 accent-amber-500 cursor-pointer"
          />
          <Lock className="w-3 h-3 text-amber-600" />
          Internal note (don't email)
        </label>
        <button
          onClick={handleSend}
          disabled={!canSend}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition disabled:opacity-50 ${
            internal ? "bg-amber-500 hover:bg-amber-600 text-white" : "bg-indigo-600 hover:bg-indigo-700 text-white"
          }`}
        >
          {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          {sending ? "Sending…" : internal ? "Save note" : "Send reply"}
        </button>
      </div>
    </div>
  );
}

function isOutbound(m, currentUserEmail) {
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
