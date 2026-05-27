// Floating in-app onboarding assistant.
//
// - Bottom-right bubble; click to open a chat panel.
// - Talks to the `onboardingAssistant` Supabase edge function, which proxies
//   Claude and assembles the user's setup state server-side.
// - Read-only — the assistant cannot mutate user data.
// - Conversation history persists in localStorage so reloading the page
//   doesn't wipe it. We only store the user's own session — no cross-user mixing.
//
// To disable for a user, gate the render in Layout.jsx.

import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/supabaseClient";
import { displayFirstName } from "@/lib/displayName";
import { MessageCircle, X, Send, Loader2, Sparkles } from "lucide-react";

const STORAGE_KEY_PREFIX = "inktracker-onboarding-assistant:";
const MAX_HISTORY = 30; // keep client + server caps aligned

const SHOP_SUGGESTED_QUESTIONS = [
  "What should I set up first?",
  "How do I connect Stripe so customers can pay?",
  "How do I configure my pricing?",
  "How do I send my first quote?",
];

const BROKER_SUGGESTED_QUESTIONS = [
  "How does broker pricing work?",
  "How do I send a quote to a client?",
  "Where do I see my profit on a job?",
  "How do I charge sales tax to my client?",
];

export default function OnboardingAssistant({ user }) {
  const storageKey = user?.id ? `${STORAGE_KEY_PREFIX}${user.id}` : null;
  const isBroker = user?.role === "broker";
  const SUGGESTED_QUESTIONS = isBroker ? BROKER_SUGGESTED_QUESTIONS : SHOP_SUGGESTED_QUESTIONS;

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Load saved conversation for this user
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setMessages(parsed.slice(-MAX_HISTORY));
      }
    } catch {
      // ignore malformed storage
    }
  }, [storageKey]);

  // Persist on change
  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages.slice(-MAX_HISTORY)));
    } catch {
      // storage may be full / blocked — non-fatal
    }
  }, [messages, storageKey]);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open, sending]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) {
      // Delay so the panel animation/render settles first
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  async function send(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed || sending) return;
    setError(null);

    const nextHistory = [...messages, { role: "user", content: trimmed }].slice(-MAX_HISTORY);
    setMessages(nextHistory);
    setInput("");
    setSending(true);

    try {
      const { data, error: invokeErr } = await base44.functions.invoke("onboardingAssistant", {
        messages: nextHistory,
      });
      if (invokeErr) throw invokeErr;
      if (data?.error) throw new Error(data.error);
      const reply = data?.reply;
      if (!reply) throw new Error("No reply received");

      setMessages((prev) => [...prev, { role: "assistant", content: reply }].slice(-MAX_HISTORY));
    } catch (err) {
      const msg = err?.message || "Something went wrong. Try again in a moment.";
      setError(msg);
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    send(input);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  function clearConversation() {
    setMessages([]);
    setError(null);
    if (storageKey) {
      try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    }
  }

  return (
    <>
      {/* Floating launcher button */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open onboarding assistant"
          className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-teal-600 hover:bg-teal-700 text-white shadow-xl hover:shadow-2xl transition-all flex items-center justify-center group"
        >
          <MessageCircle className="w-6 h-6" />
          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-white" />
          <span className="absolute right-full mr-3 px-2.5 py-1 rounded-md bg-slate-900 text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            Need help?
          </span>
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-6 right-6 z-40 w-[calc(100vw-3rem)] sm:w-[380px] h-[min(560px,calc(100vh-3rem))] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 bg-teal-600 text-white">
            <Sparkles className="w-4 h-4" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">Setup Assistant</div>
              <div className="text-[11px] text-teal-200">Ask me anything about InkTracker</div>
            </div>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={clearConversation}
                className="text-[11px] px-2 py-1 rounded-md hover:bg-teal-500 transition text-teal-100"
                title="Clear conversation"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="p-1 rounded-md hover:bg-teal-500 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50">
            {messages.length === 0 && (
              <div className="space-y-3">
                <div className="text-sm text-slate-600 leading-relaxed">
                  {(() => {
                    const name = displayFirstName(user);
                    return `Hi${name ? `, ${name}` : ""} — I'm here to help you get InkTracker set up. Try one of these to start:`;
                  })()}
                </div>
                <div className="space-y-1.5">
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => send(q)}
                      className="w-full text-left text-sm px-3 py-2 rounded-xl bg-white border border-slate-200 hover:border-teal-300 hover:bg-teal-50 text-slate-700 transition"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, idx) => (
              <div
                key={idx}
                className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] px-3 py-2 rounded-2xl rounded-br-md bg-teal-600 text-white text-sm leading-relaxed whitespace-pre-wrap"
                      : "max-w-[85%] px-3 py-2 rounded-2xl rounded-bl-md bg-white border border-slate-200 text-slate-800 text-sm leading-relaxed whitespace-pre-wrap"
                  }
                >
                  {m.content}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex justify-start">
                <div className="px-3 py-2 rounded-2xl rounded-bl-md bg-white border border-slate-200 text-slate-500 text-sm flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Thinking…
                </div>
              </div>
            )}

            {error && (
              <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
          </div>

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            className="border-t border-slate-200 bg-white p-2 flex items-end gap-2"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about pricing, integrations, sending quotes…"
              rows={1}
              className="flex-1 resize-none text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-300 max-h-32"
              disabled={sending}
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send"
              className="shrink-0 w-9 h-9 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white flex items-center justify-center transition"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
