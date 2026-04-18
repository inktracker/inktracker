import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/supabaseClient";
import { Send, MessageSquare } from "lucide-react";

/**
 * Shared messaging component used by both broker portal and admin dashboard.
 * threadId = `${brokerEmail}:${shopEmail}`
 */
export default function BrokerMessaging({ currentUser, otherEmail, otherName, threadId }) {
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!threadId) return;
    base44.entities.Message.filter({ thread_id: threadId }, "created_date", 200)
      .then(msgs => { setMessages(msgs); setLoading(false); });

    const unsub = base44.entities.Message.subscribe(event => {
      if (event.data?.thread_id !== threadId) return;
      if (event.type === "create") setMessages(prev => [...prev, event.data]);
      if (event.type === "delete") setMessages(prev => prev.filter(m => m.id !== event.id));
    });
    return unsub;
  }, [threadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!body.trim()) return;
    setSending(true);
    await base44.entities.Message.create({
      thread_id: threadId,
      from_email: currentUser.email,
      from_name: currentUser.full_name || currentUser.email,
      to_email: otherEmail,
      body: body.trim(),
      read: false,
    });
    setBody("");
    setSending(false);
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  if (!threadId) return (
    <div className="py-16 text-center text-slate-400 text-sm">Select a broker to open a conversation.</div>
  );

  return (
    <div className="flex flex-col h-[520px] bg-white rounded-2xl border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-indigo-500" />
        <span className="font-semibold text-slate-800 text-sm">{otherName || otherEmail}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {loading && <div className="text-center text-slate-300 text-sm pt-8">Loading…</div>}
        {!loading && messages.length === 0 && (
          <div className="text-center text-slate-300 text-sm pt-8">No messages yet. Say hello!</div>
        )}
        {messages.map(m => {
          const isMine = m.from_email === currentUser.email;
          return (
            <div key={m.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${isMine ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-800"}`}>
                <div>{m.body}</div>
                <div className={`text-xs mt-1 ${isMine ? "text-indigo-200" : "text-slate-400"}`}>
                  {m.from_name || m.from_email} · {m.created_date ? new Date(m.created_date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-slate-100 flex gap-2 items-end">
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Type a message… (Enter to send)"
          rows={2}
          className="flex-1 resize-none text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <button
          onClick={handleSend}
          disabled={sending || !body.trim()}
          className="flex items-center justify-center w-10 h-10 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 text-white rounded-xl transition shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}