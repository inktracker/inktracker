import { useState, useEffect } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { User, Save, CheckCircle2, AlertCircle, Link2, Unlink } from "lucide-react";
import BrokerCredentials from "./BrokerCredentials";

const QB_CLIENT_ID = import.meta.env.VITE_QB_CLIENT_ID;
const QB_REDIRECT_URI = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/qbOAuthCallback`;
const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

function buildQBAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: QB_CLIENT_ID,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: QB_REDIRECT_URI,
    state,
  });
  return `https://appcenter.intuit.com/connect/oauth2?${params}`;
}

export default function BrokerProfile({ user, onUpdate }) {
  const [form, setForm] = useState({
    display_name: user.display_name || "",
    company_name: user.company_name || "",
    phone: user.phone || "",
    address: user.address || "",
    website: user.website || "",
    notes: user.notes || "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      await base44.auth.updateMe(form);
      // Re-fetch from DB to confirm the write
      const updated = await base44.auth.me();
      onUpdate?.(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (e) {
      setError("Save failed — please try again.");
    } finally {
      setSaving(false);
    }
  }

  const fields = [
    { label: "Display Name", key: "display_name", type: "text", placeholder: "Your name as shown in the app" },
    { label: "Company Name", key: "company_name", type: "text", placeholder: "Your company or agency name" },
    { label: "Phone", key: "phone", type: "tel", placeholder: "+1 (555) 000-0000" },
    { label: "Website", key: "website", type: "url", placeholder: "https://yourwebsite.com" },
    { label: "Address", key: "address", type: "text", placeholder: "Street, City, State, ZIP" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Profile</h1>
        <p className="text-slate-500 text-sm mt-0.5">Update your contact and business information.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
        {/* Read-only account info */}
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
          <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center">
            <User className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <div className="font-bold text-slate-900">{user.display_name || user.full_name || "Broker"}</div>
            <div className="text-xs text-slate-400">{user.email} · Broker account</div>
          </div>
        </div>

        {/* Editable fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {fields.map(f => (
            <div key={f.key}>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                {f.label}
              </label>
              <input
                type={f.type}
                value={form[f.key]}
                onChange={e => set(f.key, e.target.value)}
                placeholder={f.placeholder}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          ))}
        </div>

        {/* Notes — full width */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
            Notes / Bio
          </label>
          <textarea
            value={form.notes}
            onChange={e => set("notes", e.target.value)}
            placeholder="Anything else you'd like the shop to know about you…"
            rows={3}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
          />
        </div>

        {/* Save button */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving…" : "Save Changes"}
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-emerald-600 text-sm font-semibold">
              <CheckCircle2 className="w-4 h-4" /> Changes saved!
            </span>
          )}
          {error && (
            <span className="flex items-center gap-1.5 text-red-600 text-sm font-semibold">
              <AlertCircle className="w-4 h-4" /> {error}
            </span>
          )}
        </div>
      </div>

      <BrokerQBSection user={user} />

      <BrokerCredentials user={user} onUpdate={onUpdate} />
    </div>
  );
}

function BrokerQBSection({ user }) {
  const [qbConnected, setQbConnected] = useState(false);
  const [qbRealmId, setQbRealmId] = useState("");
  const [qbConnecting, setQbConnecting] = useState(false);
  const [qbMessage, setQbMessage] = useState(null);

  useEffect(() => {
    // Check URL params for callback result
    const params = new URLSearchParams(window.location.search);
    if (params.get("qb_connected") === "1") {
      setQbConnected(true);
      setQbMessage({ type: "success", text: "QuickBooks connected successfully!" });
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("qb_error")) {
      setQbMessage({ type: "error", text: `QuickBooks connection failed: ${params.get("qb_error")}` });
      window.history.replaceState({}, "", window.location.pathname);
    }

    // Check connection status
    async function checkQB() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/qbSync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "checkConnection", accessToken: session.access_token }),
        });
        if (res.ok) {
          const data = await res.json();
          setQbConnected(!!data.connected);
          setQbRealmId(data.realmId || "");
        }
      } catch {}
    }
    checkQB();
  }, []);

  async function handleConnect() {
    if (!user) return;
    setQbConnecting(true);
    try {
      const state = crypto.randomUUID();
      const { error } = await supabase
        .from("profiles")
        .update({ qb_oauth_state: state })
        .eq("id", user.id);
      if (error) throw error;
      window.location.href = buildQBAuthUrl(state);
    } catch (err) {
      setQbMessage({ type: "error", text: "Could not start QuickBooks connection." });
      setQbConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm("Disconnect QuickBooks?")) return;
    try {
      await supabase.from("profiles").update({
        qb_access_token: null,
        qb_refresh_token: null,
        qb_realm_id: null,
        qb_token_expires_at: null,
      }).eq("id", user.id);
      setQbConnected(false);
      setQbRealmId("");
      setQbMessage({ type: "success", text: "QuickBooks disconnected." });
    } catch {
      setQbMessage({ type: "error", text: "Failed to disconnect." });
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-widest">QuickBooks Integration</h3>
        <p className="text-xs text-slate-400 mt-1">Connect your QuickBooks to create invoices for your clients.</p>
      </div>

      {qbMessage && (
        <div className={`text-xs px-3 py-2 rounded-lg ${qbMessage.type === "success" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-600 border border-red-200"}`}>
          {qbMessage.text}
        </div>
      )}

      {qbConnected ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-sm font-semibold text-emerald-700">Connected</span>
            {qbRealmId && <span className="text-xs text-slate-400 ml-2">Company ID: {qbRealmId}</span>}
          </div>
          <button onClick={handleDisconnect} className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 font-semibold">
            <Unlink className="w-3.5 h-3.5" /> Disconnect
          </button>
        </div>
      ) : (
        <button
          onClick={handleConnect}
          disabled={qbConnecting}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
        >
          <Link2 className="w-4 h-4" />
          {qbConnecting ? "Connecting…" : "Connect to QuickBooks"}
        </button>
      )}
    </div>
  );
}