import { useCallback, useEffect, useState } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { notify } from "@/lib/notify";
import { artApprovalState } from "@/lib/art/artApproval";
import ArtStatusBadge from "./ArtStatusBadge";

// The order's proof workflow: status, Send proof / Send revised proof (emails
// the customer), version history with the customer's responses, and an
// owner/manager "approve for the customer" override. All writes go through
// the artProof edge function; history is read under RLS.

const fmtWhen = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
};

const STATUS_TEXT = {
  sent: "Waiting on customer",
  approved: "Approved",
  approved_override: "Approved by the shop",
  changes_requested: "Changes requested",
  superseded: "Replaced by a newer version",
};

async function callArtProof(action, extra) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Your session expired. Refresh the page and sign in again.");
  const { data, error } = await base44.functions.invoke("artProof", { action, accessToken: session.access_token, ...extra });
  if (error) throw new Error(error.message || "Request failed");
  if (data?.error) throw new Error(data.error);
  return data;
}

export default function ArtProofPanel({ order, role, readOnly = false, onOrderUpdated }) {
  const [proofs, setProofs] = useState([]);
  const [busy, setBusy] = useState("");
  const [composing, setComposing] = useState(false);
  const [message, setMessage] = useState("");
  const [to, setTo] = useState("");
  const [overriding, setOverriding] = useState(false);
  const [note, setNote] = useState("");

  const state = artApprovalState(order);
  const canOverride = ["admin", "shop", "manager"].includes(role);
  const isBroker = role === "broker";
  const hasProof = Number(order?.art_proof_version) > 0;

  const loadProofs = useCallback(async () => {
    if (!order?.id) return;
    const { data } = await supabase.from("art_proofs")
      .select("id, version, status, sent_at, sent_by, sent_to, message, responded_at, approved_by_name, response_comment, response_location, override_by, override_note, source")
      .eq("order_id", order.id)
      .order("version", { ascending: false });
    setProofs(data || []);
  }, [order?.id]);

  useEffect(() => { loadProofs(); }, [loadProofs, order?.art_proof_version, order?.art_status]);

  const run = async (action, extra, done) => {
    setBusy(action);
    try {
      const res = await callArtProof(action, { orderId: order.id, ...extra });
      if (res?.order) onOrderUpdated?.(res.order);
      await loadProofs();
      done?.(res);
    } catch (e) {
      notify.error(action === "send" ? "Couldn't send the proof" : "Couldn't approve the art", e);
    } finally {
      setBusy("");
    }
  };

  if (isBroker) return null;

  return (
    <div className="mt-4 rounded-xl border border-teal-200 bg-white p-3 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <ArtStatusBadge order={order} />
          {state.approved && state.by && (
            <span className="text-xs text-slate-600">
              {state.by}{state.at ? ` · ${fmtWhen(state.at)}` : ""}
            </span>
          )}
        </div>
        {!readOnly && (
          <div className="flex items-center gap-3">
            <button type="button" disabled={!!busy}
              onClick={() => { setComposing((v) => !v); setOverriding(false); }}
              className="bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg px-3 py-1.5 disabled:opacity-50">
              {hasProof ? "Send revised proof" : "Send proof to customer"}
            </button>
            {canOverride && !state.approved && (
              <button type="button" disabled={!!busy}
                onClick={() => { setOverriding((v) => !v); setComposing(false); }}
                className="text-xs font-semibold text-teal-700 hover:text-teal-800 disabled:opacity-50">
                Approve for the customer
              </button>
            )}
          </div>
        )}
      </div>

      {state.changedSinceApproval && (
        <div className="text-xs text-red-700">
          The artwork changed after the customer approved it. Send them the updated proof.
        </div>
      )}

      {composing && (
        <div className="space-y-2 rounded-lg bg-slate-50 border border-slate-200 p-3">
          <div className="text-xs text-slate-600">
            Emails the customer a link to review the files and print details above, then approve or ask for changes.
            {hasProof ? " This becomes the next version; the older one is replaced." : ""}
          </div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="proof-to">Send to</label>
          <input id="proof-to" type="email" value={to} onChange={(e) => setTo(e.target.value)}
            placeholder={order?.customer_email || "customer@example.com"}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5" />
          <label className="block text-xs font-semibold text-slate-700" htmlFor="proof-msg">Message (optional)</label>
          <textarea id="proof-msg" rows={2} value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder="Anything they should check, like colors or placement."
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5" />
          <div className="flex gap-2">
            <button type="button" disabled={!!busy}
              onClick={() => run("send", { message, to: to.trim() || undefined }, (res) => {
                setComposing(false); setMessage(""); setTo("");
                if (res?.emailed === false) notify.error("Proof saved, but the email didn't send", "Copy the art approval link and send it yourself.");
                else notify.success(`Proof v${res.version} sent`, `Emailed to ${res.sentTo}.`);
              })}
              className="bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg px-3 py-1.5 disabled:opacity-50">
              {busy === "send" ? "Sending…" : "Send"}
            </button>
            <button type="button" onClick={() => setComposing(false)} className="text-xs font-semibold text-slate-600">Cancel</button>
          </div>
        </div>
      )}

      {overriding && (
        <div className="space-y-2 rounded-lg bg-slate-50 border border-slate-200 p-3">
          <label className="block text-xs font-semibold text-slate-700" htmlFor="override-note">How did the customer approve?</label>
          <input id="override-note" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Approved by phone with Jane, 10/2"
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5" />
          <div className="text-xs text-slate-500">Recorded on the order with your name. Production can start once this is saved.</div>
          <div className="flex gap-2">
            <button type="button" disabled={!!busy || !note.trim()}
              onClick={() => run("override", { note }, () => { setOverriding(false); setNote(""); notify.success("Art marked approved"); })}
              className="bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg px-3 py-1.5 disabled:opacity-50">
              {busy === "override" ? "Saving…" : "Mark approved"}
            </button>
            <button type="button" onClick={() => setOverriding(false)} className="text-xs font-semibold text-slate-600">Cancel</button>
          </div>
        </div>
      )}

      {proofs.length > 0 && (
        <details>
          <summary className="text-xs font-semibold text-slate-700 cursor-pointer">Proof history ({proofs.length})</summary>
          <ol className="mt-2 space-y-2">
            {proofs.map((p) => (
              <li key={p.id} className="text-xs border border-slate-100 rounded-lg px-3 py-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-semibold text-slate-800">Version {p.version}</span>
                  <span className="text-slate-600">{STATUS_TEXT[p.status] || p.status}</span>
                </div>
                <div className="text-slate-500 mt-0.5">
                  {p.source === "override" ? "Marked approved" : p.source === "quote" ? "Approved with the quote" : `Sent ${fmtWhen(p.sent_at)}${p.sent_by ? ` by ${p.sent_by}` : ""}${p.sent_to ? ` to ${p.sent_to}` : ""}`}
                </div>
                {p.responded_at && p.status !== "superseded" && (
                  <div className="text-slate-600 mt-0.5">
                    {p.status === "changes_requested" ? "Changes requested" : "Approved"}
                    {p.approved_by_name ? ` by ${p.approved_by_name}` : ""}{p.override_by ? ` by ${p.override_by}` : ""} · {fmtWhen(p.responded_at)}
                  </div>
                )}
                {p.response_comment && (
                  <div className="mt-1 text-slate-800">
                    “{p.response_comment}”{p.response_location ? <span className="text-slate-500"> ({p.response_location})</span> : null}
                  </div>
                )}
                {p.override_note && <div className="mt-1 text-slate-700">Note: {p.override_note}</div>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
