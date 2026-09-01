import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import { notify } from "@/lib/notify";
import { MessageSquare, Loader2, Send, AtSign } from "lucide-react";

// The team thread on a job. Read via RLS (owner + employees/managers of the
// shop); posts go through the orderComments edge function, which validates
// mentions against the roster and fans out addressed notifications
// (bell + push) to mentioned teammates and the owner.
//
// Mention UX: type @ to open the roster picker; picking inserts "@Name"
// into the text and records the email for the server. The server is the
// authority on which mentions are real — typos just post as plain text.

function timeAgo(ts) {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

// Short role tag shown beside a name in the @mention picker so you can tell
// a broker from staff before you pick. Owner/admin read as "Owner".
function mentionRoleLabel(role) {
  switch (role) {
    case "broker": return "Broker";
    case "manager": return "Manager";
    case "employee": return "Staff";
    case "shop":
    case "admin": return "Owner";
    default: return "";
  }
}

// Bold the @Name tokens for every roster member actually mentioned.
function renderBody(body, mentionNames) {
  if (!mentionNames.length) return body;
  const pattern = new RegExp(
    `@(${mentionNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "g",
  );
  const parts = String(body).split(pattern);
  return parts.map((part, i) =>
    i % 2 === 1
      ? <span key={i} className="font-semibold text-teal-700 dark:text-teal-400">@{part}</span>
      : <span key={i}>{part}</span>
  );
}

export default function OrderComments({ order, user }) {
  const [comments, setComments] = useState(null);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [roster, setRoster] = useState([]);
  const [picker, setPicker] = useState(null); // { query, atIndex } while typing an @mention
  const mentionedRef = useRef(new Map()); // name → email of inserted mentions
  const textareaRef = useRef(null);

  const shopOwner = order?.shop_owner || user?.shop_owner || user?.email;
  const orderId = order?.order_id;

  const load = useCallback(async () => {
    if (!shopOwner || !orderId) return;
    const { data, error } = await supabase
      .from("order_comments")
      .select("*")
      .eq("shop_owner", shopOwner)
      .eq("order_id", orderId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (!error) setComments(data || []);
    else setComments([]);
  }, [shopOwner, orderId]);

  useEffect(() => { load(); }, [load]);

  // Roster for the @ picker — fetched once per mount, silently optional.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data } = await supabase.functions.invoke("orderComments", { body: { action: "roster" } });
        if (active && Array.isArray(data?.roster)) setRoster(data.roster);
      } catch { /* picker just won't offer names */ }
    })();
    return () => { active = false; };
  }, []);

  function onTextChange(e) {
    const value = e.target.value;
    setText(value);
    // Detect an in-progress @mention: the last "@" with no space after it
    // before the caret.
    const caret = e.target.selectionStart;
    const upToCaret = value.slice(0, caret);
    const at = upToCaret.lastIndexOf("@");
    if (at >= 0 && (at === 0 || /\s/.test(upToCaret[at - 1]))) {
      const query = upToCaret.slice(at + 1);
      if (!query.includes("\n") && query.length <= 30) {
        setPicker({ query: query.toLowerCase(), atIndex: at });
        return;
      }
    }
    setPicker(null);
  }

  function pickMention(member) {
    const before = text.slice(0, picker.atIndex);
    const afterCaret = textareaRef.current?.selectionStart ?? text.length;
    const after = text.slice(afterCaret);
    const name = member.name || member.email;
    setText(`${before}@${name} ${after}`);
    mentionedRef.current.set(name, member.email);
    setPicker(null);
    textareaRef.current?.focus();
  }

  async function post() {
    const body = text.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      // Only names still present in the final text count as mentions.
      const mentions = [...mentionedRef.current.entries()]
        .filter(([name]) => body.includes(`@${name}`))
        .map(([, email]) => email);
      const { data, error } = await supabase.functions.invoke("orderComments", {
        body: { action: "post", orderId, body, mentions },
      });
      if (error) throw new Error(error.message || "Couldn't post comment");
      if (data?.error) throw new Error(data.error);
      setText("");
      mentionedRef.current = new Map();
      await load();
    } catch (err) {
      notify.error(err?.message || "Couldn't post comment");
    } finally {
      setPosting(false);
    }
  }

  const matches = picker
    ? roster.filter((m) =>
        m.email !== (user?.email || "").toLowerCase() &&
        (m.name.toLowerCase().includes(picker.query) || m.email.includes(picker.query))
      ).slice(0, 6)
    : [];
  const mentionNames = [...new Set((comments || []).flatMap((c) => {
    const emails = new Set(c.mentions || []);
    return roster.filter((m) => emails.has(m.email)).map((m) => m.name);
  }))];

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare className="w-4 h-4 text-teal-600" />
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Team Notes</h3>
        {comments?.length > 0 && (
          <span className="text-xs text-slate-400">{comments.length}</span>
        )}
      </div>

      {comments === null ? (
        <div className="py-4 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto text-slate-400" /></div>
      ) : comments.length === 0 ? (
        <p className="text-xs text-slate-400 mb-3">
          No notes yet. Type @ to mention a teammate — they'll get a notification.
        </p>
      ) : (
        <div className="space-y-3 mb-3 max-h-64 overflow-y-auto">
          {comments.map((c) => (
            <div key={c.id} className="text-sm">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                  {c.author_name || c.author_email}
                </span>
                <span className="text-[10px] text-slate-400">{timeAgo(c.created_at)}</span>
              </div>
              <div className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
                {renderBody(c.body, mentionNames)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="relative">
        {picker && matches.length > 0 && (
          <div className="absolute bottom-full left-0 mb-1 w-72 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-20 overflow-hidden">
            {matches.map((m) => (
              <button
                key={m.email}
                type="button"
                onClick={() => pickMention(m)}
                className="w-full flex flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-teal-50 dark:hover:bg-slate-700"
              >
                <span className="flex items-center gap-2 w-full">
                  <AtSign className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                  <span className="font-medium text-slate-800 dark:text-slate-200 text-sm truncate">{m.name}</span>
                  {mentionRoleLabel(m.role) && (
                    <span className={`ml-auto text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0 ${
                      m.role === "broker"
                        ? "bg-amber-50 text-amber-700 border border-amber-200"
                        : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300"
                    }`}>
                      {mentionRoleLabel(m.role)}
                    </span>
                  )}
                </span>
                <span className="text-[10px] text-slate-400 truncate pl-[22px] w-full">{m.email}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={onTextChange}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); }
              if (e.key === "Escape") setPicker(null);
            }}
            placeholder="Note for the team… @ to mention"
            rows={2}
            className="flex-1 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 bg-white dark:bg-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-teal-300"
          />
          <button
            type="button"
            onClick={post}
            disabled={posting || !text.trim()}
            className="self-end p-2.5 bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition disabled:opacity-40"
            aria-label="Post note"
          >
            {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
