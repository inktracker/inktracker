import { useState, useEffect } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { User, Save, CheckCircle2, AlertCircle, Link2, Unlink, Upload, X } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { notify } from "@/lib/notify";
import { qbOAuthErrorMessage } from "@/lib/qb/oauthErrorMessage";
import BrokerCredentials from "./BrokerCredentials";

const QB_CLIENT_ID = import.meta.env.VITE_QB_CLIENT_ID;
// Routes through Vercel proxy — see src/pages/Account.jsx note.
const QB_REDIRECT_URI = `${import.meta.env.VITE_APP_URL?.trim() || "https://inktracker.app"}/api/qb-callback`;
const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

function buildQBAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: QB_CLIENT_ID,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: QB_REDIRECT_URI,
    state,
    // Force QB login + company picker — matches Account.jsx + OnboardingWizard.
    prompt: "login",
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
  // Logo state — separate from `form` because the upload commits
  // immediately (operator expects to see the new logo without hitting
  // a Save button). Consumers (BrokerQuoteEditor, BrokerInvoicesTab)
  // already read `broker?.logo_url` when stamping client-facing PDFs;
  // this UI is the missing input side of that contract.
  const [logoUrl, setLogoUrl] = useState(user.logo_url || "");
  const [uploadingLogo, setUploadingLogo] = useState(false);

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

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const { file_url } = await uploadFile(file);
      setLogoUrl(file_url);
      await base44.auth.updateMe({ logo_url: file_url });
      const updated = await base44.auth.me();
      onUpdate?.(updated);
    } catch (err) {
      notify.error("Logo upload failed", err);
    } finally {
      setUploadingLogo(false);
      e.target.value = ""; // allow re-uploading the same file
    }
  }

  async function handleRemoveLogo() {
    try {
      setLogoUrl("");
      await base44.auth.updateMe({ logo_url: "" });
      const updated = await base44.auth.me();
      onUpdate?.(updated);
    } catch (err) {
      notify.error("Couldn't remove logo", err);
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
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Logo"
              className="w-12 h-12 rounded-full object-cover border border-slate-200"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-teal-100 flex items-center justify-center">
              <User className="w-6 h-6 text-teal-600" />
            </div>
          )}
          <div>
            <div className="font-bold text-slate-900">{user.display_name || user.full_name || "Broker"}</div>
            <div className="text-xs text-slate-400">{user.email} · Broker account</div>
          </div>
        </div>

        {/* Logo upload */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
            Logo
          </label>
          <p className="text-xs text-slate-500 mb-2">
            Shows on the quotes and invoices your clients see — replaces
            the shop's logo on broker-submitted PDFs.
          </p>
          {logoUrl && (
            <div className="mb-3 relative w-24 h-24">
              <img
                src={logoUrl}
                alt="Logo"
                className="w-24 h-24 object-contain rounded-lg border border-slate-200"
              />
              <button
                onClick={handleRemoveLogo}
                className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 transition"
                title="Remove logo"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          <label className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl border-2 border-dashed border-slate-200 hover:border-teal-400 cursor-pointer transition bg-slate-50 hover:bg-teal-50">
            <Upload className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-semibold text-slate-600">
              {uploadingLogo ? "Uploading..." : logoUrl ? "Change Logo" : "Upload Logo"}
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={handleLogoUpload}
              disabled={uploadingLogo}
              className="hidden"
            />
          </label>
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
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
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
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none"
          />
        </div>

        {/* Save button */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
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
      // Shared helper with Account.jsx so the broker UI doesn't drift
      // from the shop UI on OAuth error copy.
      setQbMessage({ type: "error", text: qbOAuthErrorMessage(params.get("qb_error")) });
      window.history.replaceState({}, "", window.location.pathname);
    }

    // Check connection status
    async function checkQB() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const { data, error: invErr } = await base44.functions.invoke("qbSync", {
          action: "checkConnection",
          accessToken: session.access_token,
        });
        if (!invErr && data) {
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
      // qb_oauth_state lives on profile_secrets (service-role-only). The
      // profileSecrets edge function generates and stores the state UUID
      // and returns it for the OAuth URL.
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error: invErr } = await base44.functions.invoke("profileSecrets", {
        action: "startConnect",
        provider: "qb",
        accessToken: session?.access_token,
      });
      if (invErr) throw invErr;
      if (!data?.state) throw new Error("Failed to generate OAuth state");
      window.location.href = buildQBAuthUrl(data.state);
    } catch (err) {
      setQbMessage({ type: "error", text: "Could not start QuickBooks connection." });
      setQbConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm("Disconnect QuickBooks?")) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { error: invErr } = await base44.functions.invoke("profileSecrets", {
        action: "disconnectProvider",
        provider: "qb",
        accessToken: session?.access_token,
      });
      if (invErr) throw invErr;
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