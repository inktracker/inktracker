import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { base44, supabase } from "@/api/supabaseClient";
import { uploadFile } from "@/lib/uploadFile";
import { User, LogOut, Upload, X, Plus, Trash2, Package, Link2, CheckCircle2, AlertCircle, Mail, RefreshCw, DownloadCloud, ChevronDown, Wand2 } from "lucide-react";
import WizardConfigEditor from "../components/wizard/WizardConfigEditor";

function Section({ icon: IconComp, title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between py-2 group">
        <div className="flex items-center gap-2">
          {IconComp && <IconComp className="w-5 h-5 text-indigo-600" />}
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        </div>
        <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="pt-3">{children}</div>}
    </div>
  );
}

const QB_CLIENT_ID   = import.meta.env.VITE_QB_CLIENT_ID;
const QB_REDIRECT_URI = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/qbOAuthCallback`;
const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

function buildQBAuthUrl(state) {
  const params = new URLSearchParams({
    client_id:     QB_CLIENT_ID,
    response_type: "code",
    scope:         "com.intuit.quickbooks.accounting",
    redirect_uri:  QB_REDIRECT_URI,
    state,
  });
  return `https://appcenter.intuit.com/connect/oauth2?${params}`;
}

const DEFAULT_ADDONS = [
  { key: "tags", label: "Custom Tags", rate: 1.5 },
  { key: "difficultPrint", label: "Difficult Print", rate: 0.5 },
  { key: "colorMatch", label: "Pantone Match", rate: 1.0 },
  { key: "waterbased", label: "Water-Based Ink", rate: 1.0 },
];

export default function Account() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [shopName, setShopName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [addons, setAddons] = useState(DEFAULT_ADDONS);
  const [shopRecord, setShopRecord] = useState(null);
  const [savingAddons, setSavingAddons] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  // QuickBooks connection state
  const [qbConnected, setQbConnected] = useState(false);
  const [qbMigrating, setQbMigrating] = useState(false);
  const [qbMigrateResult, setQbMigrateResult] = useState(null);
  const [qbMigratingInv, setQbMigratingInv] = useState(false);
  const [qbMigrateInvResult, setQbMigrateInvResult] = useState(null);
  const [qbRealmId, setQbRealmId] = useState(null);
  const [qbExpiresAt, setQbExpiresAt] = useState(null);
  const [qbConnecting, setQbConnecting] = useState(false);
  const [qbMessage, setQbMessage] = useState(null); // { type: "success"|"error", text }
  const [qbDisconnecting, setQbDisconnecting] = useState(false);


  useEffect(() => {
    async function loadUser() {
      try {
        const currentUser = await base44.auth.me();
        if (!currentUser) {
          await base44.auth.redirectToLogin();
          return;
        }
        setUser(currentUser);
        setShopName(currentUser.shop_name || "");
        setLogoUrl(currentUser.logo_url || "");
        // Load addons from Shop entity
        try {
          const shops = await base44.entities.Shop.filter({ owner_email: currentUser.email });
          setShopRecord(shops?.[0] || null);
          if (shops?.[0]?.addons?.length) {
            setAddons(
              shops[0].addons
                .map(a => ({ ...a, rate: parseFloat(a.rate) || 0 }))
                .sort((a, b) => (a.label || "").localeCompare(b.label || "", undefined, { sensitivity: 'base' }))
            );
          } else {
            setAddons(DEFAULT_ADDONS);
          }
          if (shops?.[0]?.quote_email_subject) setEmailSubject(shops[0].quote_email_subject);
          if (shops?.[0]?.quote_email_body) setEmailBody(shops[0].quote_email_body);
        } catch {
          setAddons(DEFAULT_ADDONS);
        }

        // Check QB connection
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/qbSync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "checkConnection", accessToken: session?.access_token }),
          });
          if (res.ok) {
            const data = await res.json();
            setQbConnected(data.connected);
            setQbRealmId(data.realmId);
            setQbExpiresAt(data.expiresAt);
          }
        } catch {}
      } catch (error) {
        console.error("Failed to load user:", error);
        await base44.auth.redirectToLogin();
      } finally {
        setLoading(false);
      }
    }

    loadUser();
  }, [navigate]);

  // Handle OAuth redirect params
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("qb_connected") === "1") {
      setQbConnected(true);
      setQbMessage({ type: "success", text: "QuickBooks connected successfully!" });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("qb_error")) {
      const errCode = params.get("qb_error");
      const msgs = {
        state_mismatch:      "Connection failed: security state mismatch. Please try again.",
        token_exchange_failed: "Connection failed: could not exchange authorization code.",
        storage_failed:      "Connection failed: could not save tokens.",
        missing_params:      "Connection failed: missing parameters from QuickBooks.",
        server_error:        "Connection failed: server error.",
      };
      setQbMessage({ type: "error", text: msgs[errCode] || `Connection failed: ${errCode}` });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [location.search]);

  async function handleSave() {
    setSaving(true);
    try {
      const updatedUser = await base44.auth.updateMe({
        shop_name: shopName,
        logo_url: logoUrl,
      });

      setUser(updatedUser || user);
      setMessage("Saved successfully!");
      setTimeout(() => setMessage(""), 3000);
    } catch (error) {
      console.error("Failed saving account:", error);
      setMessage("Error saving changes");
    }
    setSaving(false);
  }

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const { file_url } = await uploadFile(file);

      setLogoUrl(file_url);

      const updatedUser = await base44.auth.updateMe({
        shop_name: shopName,
        logo_url: file_url,
      });

      setUser(updatedUser || user);
      setMessage("Logo uploaded successfully!");
      setTimeout(() => setMessage(""), 3000);
    } catch (error) {
      console.error("Logo upload failed:", error);
      setMessage("Error uploading logo");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function handleRemoveLogo() {
    try {
      setSaving(true);
      setLogoUrl("");

      const updatedUser = await base44.auth.updateMe({
        shop_name: shopName,
        logo_url: "",
      });

      setUser(updatedUser || user);
      setMessage("Logo removed");
      setTimeout(() => setMessage(""), 3000);
    } catch (error) {
      console.error("Failed removing logo:", error);
      setMessage("Error removing logo");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveTemplate() {
    setSavingTemplate(true);
    try {
      const shops = await base44.entities.Shop.filter({ owner_email: user.email });
      const payload = { quote_email_subject: emailSubject, quote_email_body: emailBody };
      if (shops?.length) {
        await base44.entities.Shop.update(shops[0].id, payload);
      } else {
        await base44.entities.Shop.create({
          owner_email: user.email,
          shop_name: shopName || user.email,
          ...payload,
        });
      }
      setMessage("Email template saved!");
      setTimeout(() => setMessage(""), 3000);
    } catch (error) {
      console.error("Failed saving template:", error);
      setMessage("Error saving template");
    }
    setSavingTemplate(false);
  }

  async function handleSaveAddons() {
    setSavingAddons(true);
    try {
      // Save to Shop entity so brokers can read it
      const shops = await base44.entities.Shop.filter({ owner_email: user.email });
      if (shops?.length) {
        await base44.entities.Shop.update(shops[0].id, { addons });
      } else {
        await base44.entities.Shop.create({
          owner_email: user.email,
          shop_name: shopName || user.shop_name || user.email,
          addons,
        });
      }
      setMessage("Add-ons saved!");
      setTimeout(() => setMessage(""), 3000);
    } catch (error) {
      console.error("Failed saving add-ons:", error);
      setMessage("Error saving add-ons");
    }
    setSavingAddons(false);
  }

  function updateAddon(idx, field, value) {
    setAddons((prev) => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a));
  }

  function addAddon() {
    setAddons((prev) => [...prev, { key: `addon_${Date.now()}`, label: "", rate: 1.0 }]);
  }

  function removeAddon(idx) {
    setAddons((prev) => prev.filter((_, i) => i !== idx));
  }



  async function handleConnectQB() {
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
      console.error("QB connect error:", err);
      setQbMessage({ type: "error", text: "Could not start QuickBooks connection. Please try again." });
      setQbConnecting(false);
    }
  }

  async function handleDisconnectQB() {
    if (!window.confirm("Disconnect QuickBooks? Existing synced invoices won't be affected.")) return;
    setQbDisconnecting(true);
    try {
      await supabase
        .from("profiles")
        .update({ qb_access_token: null, qb_refresh_token: null, qb_realm_id: null, qb_token_expires_at: null })
        .eq("id", user.id);
      setQbConnected(false);
      setQbRealmId(null);
      setQbExpiresAt(null);
      setQbMessage({ type: "success", text: "QuickBooks disconnected." });
    } catch (err) {
      console.error("QB disconnect error:", err);
      setQbMessage({ type: "error", text: "Failed to disconnect. Please try again." });
    }
    setQbDisconnecting(false);
  }

  async function handleMigrateCustomers() {
    setQbMigrating(true);
    setQbMigrateResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/qbSync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pullCustomers", accessToken: session?.access_token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Migration failed");
      setQbMigrateResult(data);
    } catch (err) {
      console.error("QB customer migration failed:", err);
      setQbMigrateResult({ error: err.message });
    } finally {
      setQbMigrating(false);
    }
  }

  async function handleMigrateInvoices() {
    setQbMigratingInv(true);
    setQbMigrateInvResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/qbSync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pullInvoices", accessToken: session?.access_token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Migration failed");
      setQbMigrateInvResult(data);
    } catch (err) {
      console.error("QB invoice migration failed:", err);
      setQbMigrateInvResult({ error: err.message });
    } finally {
      setQbMigratingInv(false);
    }
  }

  async function handleLogout() {
    await base44.auth.logout("/");
  }

  if (loading) {
    return <div className="text-center text-slate-400 py-10">Loading...</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">My Account</h2>
        <p className="text-slate-500 mt-1">Manage your shop, profile, and broker settings</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 p-6 space-y-2">
        <Section icon={User} title="Shop Information" defaultOpen={true}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Shop Name
              </label>
              <input
                type="text"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Logo
              </label>

              {logoUrl && (
                <div className="mb-3 relative w-24 h-24">
                  <img
                    src={logoUrl}
                    alt="Logo"
                    className="w-24 h-24 object-contain rounded-lg border border-slate-200 dark:border-slate-700"
                  />
                  <button
                    onClick={handleRemoveLogo}
                    className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 transition"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <label className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-indigo-400 cursor-pointer transition bg-slate-50 dark:bg-slate-800 hover:bg-indigo-50">
                <Upload className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-semibold text-slate-600">
                  {uploading ? "Uploading..." : logoUrl ? "Change Logo" : "Upload Logo"}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  disabled={uploading}
                  className="hidden"
                />
              </label>
            </div>

            {message && (
              <div
                className={`text-sm font-semibold py-2 px-3 rounded-lg ${
                  message.includes("Error")
                    ? "bg-red-50 text-red-600"
                    : "bg-emerald-50 text-emerald-600"
                }`}
              >
                {message}
              </div>
            )}

            <button
              onClick={handleSave}
              disabled={saving || uploading}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold px-4 py-2.5 rounded-xl transition"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </Section>

        <Section icon={User} title="Account">
          <div className="space-y-3">
            <div>
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">Email</div>
              <div className="text-sm text-slate-700 font-semibold">{user?.email}</div>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">Role</div>
              <div className="text-sm text-slate-700 font-semibold capitalize">{user?.role || "user"}</div>
            </div>
          </div>
        </Section>

        {user?.role === "admin" && (
          <Section icon={Package} title="Quote Add-ons">
            <p className="text-sm text-slate-500 mb-4">
              These add-on options appear on the broker quote form. Changes apply to all new quotes.
            </p>
            <div className="space-y-2">
              {addons.map((addon, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={addon.label}
                    onChange={(e) => updateAddon(idx, "label", e.target.value)}
                    placeholder="Label (e.g. Pantone Match)"
                    className="flex-1 px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  <div className="flex items-center gap-1">
                    <span className="text-slate-400 text-xs">+$</span>
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      value={addon.rate}
                      onChange={(e) => updateAddon(idx, "rate", parseFloat(e.target.value) || 0)}
                      className="w-20 px-2 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 text-right"
                    />
                    <span className="text-slate-400 text-xs">/pc</span>
                  </div>
                  <button
                    onClick={() => removeAddon(idx)}
                    className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-4">
              <button
                onClick={addAddon}
                className="flex items-center gap-1.5 text-sm text-indigo-600 border border-indigo-200 px-3 py-2 rounded-lg hover:bg-indigo-50 transition font-semibold"
              >
                <Plus className="w-4 h-4" /> Add Option
              </button>
              <button
                onClick={handleSaveAddons}
                disabled={savingAddons}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold px-4 py-2 rounded-xl text-sm transition"
              >
                {savingAddons ? "Saving..." : "Save Add-ons"}
              </button>
            </div>
          </Section>
        )}

        {user && (
          <Section icon={Wand2} title="Order Wizard">
            <p className="text-sm text-slate-400 mb-3">
              Curate the styles and print setups walk-in customers see on the Wizard page.
            </p>
            <WizardConfigEditor user={user} shop={shopRecord} onSaved={() => {}} />
          </Section>
        )}

        <Section icon={Mail} title="Quote Email Template">
          <p className="text-sm text-slate-400 mb-4">
            Customize the subject and message sent with every quote. Use <code className="bg-slate-100 px-1 rounded text-xs">{"{{customer_name}}"}</code>, <code className="bg-slate-100 px-1 rounded text-xs">{"{{quote_id}}"}</code>, <code className="bg-slate-100 px-1 rounded text-xs">{"{{total}}"}</code>, and <code className="bg-slate-100 px-1 rounded text-xs">{"{{payment_link}}"}</code> as placeholders.
          </p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Subject</label>
              <input type="text" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="Your Quote from {{shop_name}} - Quote #{{quote_id}}"
                className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Message Body</label>
              <textarea rows={5} value={emailBody} onChange={(e) => setEmailBody(e.target.value)}
                placeholder={"Hi {{customer_name}},\n\nYour quote is ready. Total: {{total}}.\n\nClick below to view, approve, or pay:\n{{payment_link}}"}
                className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none font-mono" />
            </div>
            <button onClick={handleSaveTemplate} disabled={savingTemplate}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold px-4 py-2 rounded-xl text-sm transition">
              {savingTemplate ? "Saving..." : "Save Template"}
            </button>
          </div>
        </Section>

        <Section icon={Link2} title="QuickBooks Integration">

          {qbMessage && (
            <div className={`flex items-center gap-2 text-sm font-semibold py-2.5 px-4 rounded-xl mb-4 ${
              qbMessage.type === "success"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}>
              {qbMessage.type === "success"
                ? <CheckCircle2 className="w-4 h-4 shrink-0" />
                : <AlertCircle className="w-4 h-4 shrink-0" />}
              {qbMessage.text}
              <button onClick={() => setQbMessage(null)} className="ml-auto text-current opacity-50 hover:opacity-100">✕</button>
            </div>
          )}

          {qbConnected ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span className="font-semibold text-emerald-800">Connected to QuickBooks</span>
              </div>
              {qbRealmId && (
                <div className="text-xs text-slate-500">
                  Company ID: <span className="font-mono font-semibold">{qbRealmId}</span>
                </div>
              )}
              {qbExpiresAt && (
                <div className="text-xs text-slate-500">
                  Token expires: {new Date(qbExpiresAt).toLocaleDateString()}
                  {" "}(auto-refreshed)
                </div>
              )}
              <p className="text-sm text-slate-600">
                Quotes can now be sent as QuickBooks invoices. Once your client pays via the QB payment link, InkTracker automatically converts the quote to an order.
              </p>
              <div className="border-t border-emerald-200 pt-3 mt-3">
                <div className="text-sm font-semibold text-slate-700 mb-2">Data Migration</div>
                <button
                  onClick={handleMigrateCustomers}
                  disabled={qbMigrating}
                  className="flex items-center gap-2 text-sm font-semibold text-emerald-700 border border-emerald-300 px-3 py-2 rounded-xl hover:bg-emerald-100 transition disabled:opacity-50"
                >
                  {qbMigrating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Importing Customers…
                    </>
                  ) : (
                    <>
                      <DownloadCloud className="w-4 h-4" />
                      Import Customers from QuickBooks
                    </>
                  )}
                </button>
                {qbMigrateResult && !qbMigrateResult.error && (
                  <div className="mt-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                    Imported <strong>{qbMigrateResult.created}</strong> new customer{qbMigrateResult.created !== 1 ? "s" : ""},
                    updated <strong>{qbMigrateResult.updated}</strong>,
                    skipped <strong>{qbMigrateResult.skipped}</strong> already synced.
                  </div>
                )}
                {qbMigrateResult?.error && (
                  <div className="mt-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    Migration failed: {qbMigrateResult.error}
                  </div>
                )}
                <button
                  onClick={handleMigrateInvoices}
                  disabled={qbMigratingInv}
                  className="flex items-center gap-2 text-sm font-semibold text-emerald-700 border border-emerald-300 px-3 py-2 rounded-xl hover:bg-emerald-100 transition disabled:opacity-50 mt-2"
                >
                  {qbMigratingInv ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Importing Invoices…
                    </>
                  ) : (
                    <>
                      <DownloadCloud className="w-4 h-4" />
                      Import Invoices from QuickBooks
                    </>
                  )}
                </button>
                {qbMigrateInvResult && !qbMigrateInvResult.error && (
                  <div className="mt-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                    Imported <strong>{qbMigrateInvResult.imported}</strong> invoice{qbMigrateInvResult.imported !== 1 ? "s" : ""},
                    skipped <strong>{qbMigrateInvResult.skipped}</strong> already imported.
                  </div>
                )}
                {qbMigrateInvResult?.error && (
                  <div className="mt-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    Invoice import failed: {qbMigrateInvResult.error}
                  </div>
                )}
              </div>
              <button
                onClick={handleDisconnectQB}
                disabled={qbDisconnecting}
                className="text-sm font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
              >
                {qbDisconnecting ? "Disconnecting…" : "Disconnect QuickBooks"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">
                Connect QuickBooks to automatically generate payment links when you send quotes. When a client pays, InkTracker converts the quote to an order automatically.
              </p>
              <button
                onClick={handleConnectQB}
                disabled={qbConnecting}
                className="flex items-center gap-2 bg-[#2CA01C] hover:bg-[#248A18] disabled:bg-slate-300 text-white font-semibold px-4 py-2.5 rounded-xl transition text-sm"
              >
                <img
                  src="https://developer.intuit.com/content/dam/developer/global/en_US/site-redesign/images/quickbooks-online-logo-white.svg"
                  alt=""
                  className="h-4"
                  onError={(e) => e.currentTarget.style.display = "none"}
                />
                {qbConnecting ? "Redirecting to QuickBooks…" : "Connect to QuickBooks"}
              </button>
              <p className="text-xs text-slate-400">
                You'll be redirected to Intuit to authorize InkTracker. QuickBooks Payments account required for payment links.
              </p>
            </div>
          )}
        </Section>

        <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-red-600 hover:text-red-700 font-semibold text-sm py-2"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}