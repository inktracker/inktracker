import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/supabaseClient";
import { uploadFile } from "@/lib/uploadFile";
import { Send, MessageSquare, Paperclip, X, FileText, Download } from "lucide-react";
import { notify } from "@/lib/notify";

/**
 * Shared messaging component used by both broker portal and admin dashboard.
 * threadId = `${brokerEmail}:${shopEmail}`
 *
 * `shopOwner` is the canonical shop_owner email for RLS — pass it in so the
 * Message row is visible to all team members of that shop, not just the
 * literal sender/recipient. Without it, the row is created without
 * shop_owner set and disappears from team views.
 *
 * Supports an optional file attachment per message (Supabase Storage URL
 * + original filename). Replaces the separate "Paperwork" and "Job Files"
 * tabs that used to live in the broker portal — file sharing now happens
 * inline with the conversation so neither side has to chase three places.
 */
export default function BrokerMessaging({ currentUser, otherEmail, otherName, threadId, shopOwner }) {
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingFile, setPendingFile] = useState(null); // { name, url } once uploaded
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  // Mark messages addressed to the current user as read. Best-effort:
  // individual update failures shouldn't break the conversation, so we
  // swallow errors. Called after load AND on each incoming realtime INSERT
  // so opening the thread = inbox-zero for that conversation.
  async function markIncomingRead(rows) {
    const unread = (rows || []).filter(
      m => m.to_email === currentUser?.email && !m.read
    );
    if (unread.length === 0) return;
    try {
      await Promise.all(
        unread.map(m => base44.entities.Message.update(m.id, { read: true }))
      );
      // Same-tab signal so badge counters (e.g. Dashboard's Brokers-tab
      // chip) can decrement immediately without depending on Supabase
      // realtime UPDATE events — the messages table's publication
      // doesn't reliably fire UPDATE events, so listeners can't see
      // the read=true flip and the badge would otherwise stay pegged.
      window.dispatchEvent(new CustomEvent("inktracker:messages-marked-read", {
        detail: { messageIds: unread.map(m => m.id) },
      }));
    } catch {
      // Best-effort; the read flag is informational, not load-bearing.
    }
  }

  useEffect(() => {
    if (!threadId) return;
    base44.entities.Message.filter({ thread_id: threadId }, "created_date", 200)
      .then(msgs => {
        setMessages(msgs);
        markIncomingRead(msgs);
      })
      .catch(err => notify.error("Couldn't load messages", err))
      .finally(() => setLoading(false));

    const unsub = base44.entities.Message.subscribe(payload => {
      // Supabase postgres_changes payload shape: { eventType, new, old }.
      // The previous code read event.data / event.type which never exist on
      // the actual payload — silently dropped every realtime event so
      // messages only appeared after a page refresh.
      const row = payload?.new || payload?.old;
      if (row?.thread_id !== threadId) return;
      if (payload.eventType === "INSERT") {
        // Dedupe in case the sender already optimistically inserted this row.
        setMessages(prev => (prev.some(m => m.id === row.id) ? prev : [...prev, row]));
        // If the new message is addressed to us, mark it read right away —
        // the thread is open, the user is looking at it.
        if (row.to_email === currentUser?.email && !row.read) {
          base44.entities.Message.update(row.id, { read: true }).catch(() => {});
        }
      } else if (payload.eventType === "DELETE") {
        setMessages(prev => prev.filter(m => m.id !== payload.old?.id));
      } else if (payload.eventType === "UPDATE") {
        setMessages(prev => prev.map(m => (m.id === row.id ? { ...m, ...row } : m)));
      }
    });
    return unsub;
     
  }, [threadId, currentUser?.email]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleFilePick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await uploadFile(file);
      setPendingFile({ name: file.name, url: file_url });
    } catch (err) {
      notify.error("Couldn't upload file", err);
    } finally {
      setUploading(false);
      // Reset the input so picking the same file twice still fires onChange.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function clearPendingFile() {
    setPendingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSend() {
    if (!body.trim() && !pendingFile) return;
    setSending(true);
    // shop_owner falls back to whichever of (from_email, to_email) is the
    // shop side of this conversation. For broker→shop messages, the
    // shopOwner prop carries the canonical value; absent that, prefer
    // otherEmail (assumed to be the counterpart shop in the broker portal).
    const resolvedShopOwner = shopOwner || otherEmail || currentUser.email;
    try {
      // Insert + take the created row back so we can paint it locally
      // instead of waiting for the realtime listener to fire. With the
      // subscribe handler also deduping by id, this gives instant
      // sender-side feedback without producing a duplicate when the
      // realtime event eventually arrives.
      const created = await base44.entities.Message.create({
        thread_id: threadId,
        from_email: currentUser.email,
        from_name: currentUser.full_name || currentUser.email,
        to_email: otherEmail,
        body: body.trim(),
        attachment_url: pendingFile?.url || null,
        attachment_name: pendingFile?.name || null,
        read: false,
        shop_owner: resolvedShopOwner,
      });
      if (created?.id) {
        setMessages(prev => (prev.some(m => m.id === created.id) ? prev : [...prev, created]));
      }
      setBody("");
      setPendingFile(null);
    } catch (err) {
      notify.error("Couldn't send message", err);
    } finally {
      setSending(false);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  if (!threadId) return (
    <div className="py-16 text-center text-slate-500 text-sm">Select a broker to open a conversation.</div>
  );

  return (
    <div className="flex flex-col h-[520px] bg-white rounded-2xl border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-teal-500" />
        <span className="font-semibold text-slate-800 text-sm">{otherName || otherEmail}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {loading && <div className="text-center text-slate-300 text-sm pt-8">Loading…</div>}
        {!loading && messages.length === 0 && (
          <div className="text-center text-slate-300 text-sm pt-8">No messages yet. Say hello — you can attach files too.</div>
        )}
        {messages.map(m => {
          const isMine = m.from_email === currentUser.email;
          return (
            <div key={m.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${isMine ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-800"}`}>
                {m.body && <div className="whitespace-pre-wrap">{m.body}</div>}
                {m.attachment_url && (
                  <a
                    href={m.attachment_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={m.attachment_name || true}
                    className={`mt-2 inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                      isMine
                        ? "bg-teal-500/50 hover:bg-teal-500/70 text-white border border-teal-300/40"
                        : "bg-white hover:bg-slate-50 text-slate-700 border border-slate-200"
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate max-w-[200px]">{m.attachment_name || "Attachment"}</span>
                    <Download className="w-3.5 h-3.5 shrink-0 opacity-70" />
                  </a>
                )}
                <div className={`text-xs mt-1 ${isMine ? "text-teal-200" : "text-slate-500"}`}>
                  {m.from_name || m.from_email} · {m.created_date ? new Date(m.created_date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Pending-attachment chip — visible while a file is staged but not
          yet sent. Click X to discard. */}
      {pendingFile && (
        <div className="mx-4 mb-2 inline-flex items-center gap-2 self-start rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs text-teal-700">
          <FileText className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate max-w-[280px]">{pendingFile.name}</span>
          <button
            type="button"
            onClick={clearPendingFile}
            className="text-teal-400 hover:text-teal-700"
            aria-label="Remove attachment"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t border-slate-100 flex gap-2 items-end">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFilePick}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || sending}
          className="flex items-center justify-center w-10 h-10 border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50 rounded-xl transition shrink-0"
          title="Attach a file"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={handleKey}
          placeholder={uploading ? "Uploading…" : "Type a message… (Enter to send)"}
          rows={2}
          disabled={uploading}
          className="flex-1 resize-none text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:opacity-60"
        />
        <button
          onClick={handleSend}
          disabled={sending || uploading || (!body.trim() && !pendingFile)}
          className="flex items-center justify-center w-10 h-10 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-200 text-white rounded-xl transition shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
