import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { base44, supabase } from "@/api/supabaseClient";
import { uploadFile } from "@/lib/uploadFile";
import { User, LogOut, Upload, X, Package, Link2, CheckCircle2, AlertCircle, Mail, RefreshCw, DownloadCloud, ChevronDown, Wand2, CreditCard, Loader2 } from "lucide-react";
import { PLANS, getTierLabel, getTierColor } from "@/lib/billing";
import { SHOP_TIMEZONE_OPTIONS, loadShopTimezone } from "@/lib/shopTimezone";
import WizardConfigEditor from "../components/wizard/WizardConfigEditor";

function Section({ icon: IconComp, title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between py-2 group">
        <div className="flex items-center gap-2">
          {IconComp && <IconComp className="w-5 h-5 text-indigo-600" />}
          <h3 className="text-sm sm:text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
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
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [stateVal, setStateVal] = useState("");
  const [zip, setZip] = useState("");
  const [taxRate, setTaxRate] = useState("");
  // Empty string = "use browser default" (the first picker option). Stored
  // on the shops table so it applies to every user in this shop.
  const [timezone, setTimezone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [addons, setAddons] = useState(DEFAULT_ADDONS);
  const [shopRecord, setShopRecord] = useState(null);
  const [decorationTypes, setDecorationTypes] = useState(["screen_print"]);
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

  // ── Stripe Connect (customer payments → shop's own Stripe account) ──
  const [stripeAccountStatus, setStripeAccountStatus] = useState(null); // null | "pending" | "active" | "restricted" | "disabled"
  const [stripeAccountId, setStripeAccountId] = useState(null);
  const [stripeConnecting, setStripeConnecting] = useState(false);
  const [stripeMessage, setStripeMessage] = useState(null);
  const [openingStripeDashboard, setOpeningStripeDashboard] = useState(false);


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
        setPhone(currentUser.phone || "");
        setAddress(currentUser.address || "");
        setCity(currentUser.city || "");
        setStateVal(currentUser.state || "");
        setZip(currentUser.zip || "");
        setTaxRate(currentUser.default_tax_rate || "");
        // Load addons from Shop entity
        try {
          const shops = await base44.entities.Shop.filter({ owner_email: currentUser.email });
          setShopRecord(shops?.[0] || null);
          setTimezone(shops?.[0]?.timezone || "");
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

  // ── Stripe Connect status load + post-onboarding return ───────────
  // Fetches the current status (live + cached) so the UI can render
  // the right state. Re-fetched whenever the user returns from Stripe's
  // hosted onboarding (signaled by ?stripe_connect=return in the URL).
  async function fetchStripeStatus() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/billing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getStripeAccountStatus", accessToken: session.access_token }),
      });
      const data = await res.json();
      if (data?.connected) {
        setStripeAccountId(data.accountId || null);
        setStripeAccountStatus(data.status || "pending");
      } else {
        setStripeAccountId(null);
        setStripeAccountStatus(null);
      }
    } catch (err) {
      console.warn("[Account] stripe status fetch failed:", err);
    }
  }

  useEffect(() => { if (user) fetchStripeStatus(); }, [user]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const flag = params.get("stripe_connect");
    if (!flag) return;
    if (flag === "return") {
      setStripeMessage({ type: "success", text: "Stripe onboarding finished. Status will refresh once Stripe verifies your account." });
    } else if (flag === "refresh") {
      setStripeMessage({ type: "info", text: "Stripe asked you to retry the link. Click Continue Setup to resume." });
    }
    window.history.replaceState({}, "", window.location.pathname);
    // Re-fetch after a Stripe redirect even if we already had a value.
    fetchStripeStatus();
  }, [location.search]);

  async function handleConnectStripe() {
    setStripeConnecting(true);
    setStripeMessage(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/billing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connectStripe", accessToken: session?.access_token }),
      });
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error(data?.error || "Couldn't start Stripe onboarding.");
    } catch (err) {
      setStripeMessage({ type: "error", text: err.message });
    } finally {
      setStripeConnecting(false);
    }
  }

  async function handleOpenStripeDashboard() {
    setOpeningStripeDashboard(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/billing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "openStripeDashboard", accessToken: session?.access_token }),
      });
      const data = await res.json();
      if (data?.url) {
        window.open(data.url, "_blank");
        return;
      }
      throw new Error(data?.error || "Couldn't open the Stripe dashboard.");
    } catch (err) {
      setStripeMessage({ type: "error", text: err.message });
    } finally {
      setOpeningStripeDashboard(false);
    }
  }

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
        state_mismatch:      "Connection failed. Please try again.",
        token_exchange_failed: "Could not connect to QuickBooks. Please try again — if the issue persists, contact support.",
        storage_failed:      "Connected to QuickBooks but could not save. Please try again.",
        missing_params:      "QuickBooks did not return the expected data. Please try again.",
        server_error:        "Something went wrong. Please try again.",
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
        phone: phone.trim(),
        address: address.trim(),
        city: city.trim(),
        state: stateVal.trim().toUpperCase(),
        zip: zip.trim(),
        default_tax_rate: parseFloat(taxRate) || 0,
      });

      // Timezone lives on the shops table (so it applies to every user in
      // this shop, not just whoever saved last). Best-effort — failing this
      // shouldn't undo the profile save above.
      try {
        const shops = await base44.entities.Shop.filter({ owner_email: user.email });
        const payload = { timezone: timezone || null };
        if (shops?.[0]) {
          await base44.entities.Shop.update(shops[0].id, payload);
        } else {
          await base44.entities.Shop.create({
            owner_email: user.email,
            shop_name: shopName || user.email,
            ...payload,
          });
        }
        // Apply the new tz immediately to the running app so subsequent
        // todayStr() / nowLocal() calls reflect the change without a reload.
        loadShopTimezone(timezone || null);
      } catch (tzErr) {
        console.warn("Timezone save failed (non-blocking):", tzErr);
      }

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

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 px-4 sm:px-6 py-5 space-y-2">
        <Section icon={User} title="Shop Information">
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Phone</label>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 123-4567"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Default Tax Rate %</label>
                <input type="number" step="0.001" value={taxRate} onChange={e => setTaxRate(e.target.value)} placeholder="8.265"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                <p className="text-xs text-slate-400 mt-1">Enter the percentage (8.265 means 8.265%), not a decimal.</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Shop Timezone</label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  {SHOP_TIMEZONE_OPTIONS.map((opt) => (
                    <option key={opt.value || "__default__"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">Used by the calendar to know what "today" means for your shop. Lets employees logging in from another state still see the right "today."</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Address</label>
              <input type="text" value={address} onChange={e => setAddress(e.target.value)} placeholder="123 Main St"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-3 gap-2 sm:gap-3">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">City</label>
                <input type="text" value={city} onChange={e => setCity(e.target.value)} placeholder="Reno"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">State</label>
                <input type="text" value={stateVal} onChange={e => setStateVal(e.target.value)} placeholder="NV" maxLength={2}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">ZIP</label>
                <input type="text" value={zip} onChange={e => setZip(e.target.value)} placeholder="89502"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
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

        {(user?.role === "admin" || user?.role === "shop") && <Section icon={CreditCard} title="Billing & Plan" defaultOpen={location.search?.includes("billing")}>
          <BillingSection user={user} />
        </Section>}

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


        {user && (
          <Section icon={Wand2} title="Quote Wizard">
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

        {/* QuickBooks + Stripe Connect are financial-wiring surfaces —
            disconnecting QB or re-routing Stripe payouts would affect the
            whole shop. Same admin/shop gate as Billing & Plan above so a
            manager (who has full operational access but "no billing/admin"
            per CLAUDE.md) can't accidentally or maliciously break either. */}
        {(user?.role === "admin" || user?.role === "shop") && <Section icon={Link2} title="QuickBooks Integration">

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
        </Section>}

        {(user?.role === "admin" || user?.role === "shop") && <Section icon={CreditCard} title="Stripe Payments">
          {stripeMessage && (
            <div className={`flex items-center gap-2 text-sm font-semibold py-2.5 px-4 rounded-xl mb-4 ${
              stripeMessage.type === "success"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : stripeMessage.type === "info"
                  ? "bg-blue-50 text-blue-700 border border-blue-200"
                  : "bg-red-50 text-red-700 border border-red-200"
            }`}>
              {stripeMessage.type === "success"
                ? <CheckCircle2 className="w-4 h-4 shrink-0" />
                : <AlertCircle className="w-4 h-4 shrink-0" />}
              <span>{stripeMessage.text}</span>
              <button onClick={() => setStripeMessage(null)} className="ml-auto text-current opacity-50 hover:opacity-100">✕</button>
            </div>
          )}

          {stripeAccountStatus === "active" ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span className="font-semibold text-emerald-800">Stripe Connected · accepting payments</span>
              </div>
              <p className="text-sm text-slate-600">
                Customer payments via Stripe go directly to your Stripe account. Your shop name appears on the customer's statement. InkTracker doesn't take a cut.
              </p>
              {stripeAccountId && (
                <div className="text-xs text-slate-500">
                  Account: <span className="font-mono font-semibold">{stripeAccountId}</span>
                </div>
              )}
              <button
                onClick={handleOpenStripeDashboard}
                disabled={openingStripeDashboard}
                className="flex items-center gap-2 text-sm font-semibold text-emerald-700 border border-emerald-300 px-3 py-2 rounded-xl hover:bg-emerald-100 transition disabled:opacity-50"
              >
                {openingStripeDashboard ? "Opening…" : "Open Stripe Dashboard →"}
              </button>
            </div>
          ) : stripeAccountStatus === "restricted" ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-amber-600" />
                <span className="font-semibold text-amber-800">Action needed in Stripe</span>
              </div>
              <p className="text-sm text-slate-600">
                Stripe needs more information before they'll let you accept payments. Open the dashboard to finish up — usually a tax ID, bank details, or an ID verification.
              </p>
              <button
                onClick={handleOpenStripeDashboard}
                disabled={openingStripeDashboard}
                className="flex items-center gap-2 text-sm font-semibold text-amber-700 border border-amber-300 px-3 py-2 rounded-xl hover:bg-amber-100 transition disabled:opacity-50"
              >
                {openingStripeDashboard ? "Opening…" : "Finish Stripe Setup →"}
              </button>
            </div>
          ) : stripeAccountStatus === "pending" ? (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                <span className="font-semibold text-blue-800">Stripe is verifying your account</span>
              </div>
              <p className="text-sm text-slate-600">
                Usually takes a few minutes. You'll see "Stripe Connected" here once Stripe is done. If it takes longer, open the dashboard to check.
              </p>
              <button
                onClick={handleConnectStripe}
                disabled={stripeConnecting}
                className="flex items-center gap-2 text-sm font-semibold text-blue-700 border border-blue-300 px-3 py-2 rounded-xl hover:bg-blue-100 transition disabled:opacity-50"
              >
                {stripeConnecting ? "Opening Stripe…" : "Continue Setup →"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">
                Connect Stripe to accept customer payments on quotes. Funds go directly to your bank account — your shop's name appears on the customer's statement. InkTracker doesn't take a cut of customer payments.
              </p>
              <button
                onClick={handleConnectStripe}
                disabled={stripeConnecting}
                className="inline-flex items-center gap-2 bg-[#635BFF] hover:bg-[#5851DB] disabled:opacity-50 text-white font-semibold px-4 py-2.5 rounded-xl transition"
              >
                {stripeConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {stripeConnecting ? "Redirecting to Stripe…" : "Connect with Stripe"}
              </button>
              <p className="text-xs text-slate-400">
                You'll be redirected to Stripe to set up your account. Stripe handles the verification and payouts.
              </p>
            </div>
          )}
        </Section>}

        <Section icon={CreditCard} title="Pricing & Fees">
          <PricingConfigSection user={user} />
        </Section>

        <Section icon={Package} title="Supplier API Keys">
          <SupplierKeysSection user={user} />
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

function BillingSection({ user }) {
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(null);

  const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

  useEffect(() => {
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/billing`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "getSubscription", accessToken: session?.access_token }),
        });
        const data = await res.json();
        setSub(data);
      } catch {}
      setLoading(false);
    }
    load();
  }, []);

  async function handleCheckout(tier) {
    setCheckoutLoading(tier);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/billing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "checkout", accessToken: session?.access_token, tier }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else alert(data.error || "Failed to start checkout");
    } catch (err) {
      alert("Checkout failed: " + err.message);
    } finally {
      setCheckoutLoading(null);
    }
  }

  async function handlePortal() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/billing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "portal", accessToken: session?.access_token }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else alert(data.error || "Failed to open billing portal");
    } catch (err) {
      alert("Portal failed: " + err.message);
    }
  }

  if (loading) {
    return <div className="py-4 text-center"><Loader2 className="w-5 h-5 animate-spin text-slate-300 mx-auto" /></div>;
  }

  const tier = sub?.tier || "trial";
  const hasPaidPlan = tier !== "trial" && tier !== "expired";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-slate-50 rounded-xl p-4">
        <div>
          <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Current Plan</div>
          <div className="flex items-center gap-2">
            <span className={`text-sm font-bold px-2.5 py-0.5 rounded-full ${getTierColor(tier)}`}>
              {getTierLabel(tier)}
            </span>
            {sub?.status && (
              <span className={`text-xs ${sub.status === "active" || sub.status === "trialing" ? "text-emerald-600" : "text-red-500"}`}>
                {sub.status === "trialing" ? `${sub.trialDaysLeft} days left` : sub.status}
              </span>
            )}
          </div>
        </div>
        {hasPaidPlan && (
          <button onClick={handlePortal}
            className="text-xs font-semibold text-indigo-600 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition">
            Manage Billing
          </button>
        )}
      </div>

      <div className="max-w-md">
        {PLANS.map(plan => {
          const isCurrent = tier === plan.tier;
          return (
            <div key={plan.tier} className={`rounded-xl border-2 p-5 ${isCurrent ? "border-indigo-400 bg-indigo-50" : "border-slate-200"}`}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-bold text-slate-800">{plan.name}</div>
                  <div className="text-xs text-slate-400">Everything included</div>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-bold text-slate-900">${plan.price}</span>
                  <span className="text-xs text-slate-400">/mo</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5 mb-4">
                {plan.features.map(f => (
                  <div key={f} className="flex items-start gap-1.5 text-xs text-slate-600">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                    {f}
                  </div>
                ))}
              </div>
              {isCurrent ? (
                <div className="text-xs font-bold text-indigo-600 text-center py-2">Current Plan</div>
              ) : (
                <button onClick={() => handleCheckout(plan.tier)} disabled={!!checkoutLoading}
                  className="w-full text-xs font-bold py-2.5 rounded-lg transition disabled:opacity-50 text-white bg-indigo-600 hover:bg-indigo-700">
                  {checkoutLoading === plan.tier ? "Loading..." : "Subscribe"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GmailScannerSection({ user }) {
  const [connected, setConnected] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const [results, setResults] = useState(null);
  const [connecting, setConnecting] = useState(false);

  const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

  useEffect(() => {
    async function check() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/emailScanner`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "checkGmailConnection", accessToken: session?.access_token }),
        });
        const data = await res.json();
        setConnected(data.connected);
        setLastScan(data.lastScan);
      } catch {}
    }
    check();

    const params = new URLSearchParams(window.location.search);
    if (params.get("gmail_connected") === "1") {
      setConnected(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  async function connectGmail() {
    setConnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/emailScanner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getGmailAuthUrl", accessToken: session?.access_token }),
      });
      const data = await res.json();
      if (data.authUrl) window.location.href = data.authUrl;
    } catch (err) {
      alert("Failed: " + err.message);
    } finally {
      setConnecting(false);
    }
  }

  async function scanNow() {
    setScanning(true);
    setResults(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const post = (action) => fetch(`${SUPABASE_FUNC_URL}/functions/v1/emailScanner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, accessToken: session?.access_token }),
      }).then((r) => r.json()).catch((err) => ({ error: err?.message || "request failed" }));

      // Two distinct passes:
      //   scanEmails  → finds NEW inbound quote requests and creates draft quotes
      //   scanReplies → threads replies (subject contains [Ref:]) into the
      //                 matching quote/order/invoice's message thread
      // Run in parallel — one failing shouldn't block the other.
      const [emailsData, repliesData] = await Promise.all([
        post("scanEmails"),
        post("scanReplies"),
      ]);

      setResults({
        scanned: (emailsData?.scanned || 0) + (repliesData?.scanned || 0),
        quotesCreated: emailsData?.quotesCreated || 0,
        repliesAdded: repliesData?.repliesAdded || 0,
        results: emailsData?.results || [],
        errors: [emailsData?.error, repliesData?.error].filter(Boolean),
      });
      setLastScan(new Date().toISOString());
    } catch (err) {
      alert("Scan failed: " + err.message);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Scan your inbox for quote requests and automatically create draft quotes.
      </p>

      {connected ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-sm font-semibold text-emerald-700">Gmail Connected</span>
            </div>
            {lastScan && <span className="text-xs text-emerald-500">Last scan: {new Date(lastScan).toLocaleString()}</span>}
          </div>

          <button onClick={scanNow} disabled={scanning}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition disabled:opacity-50">
            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            {scanning ? "Scanning Inbox..." : "Scan Inbox (Quote Requests + Replies)"}
          </button>

          {results && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <div className="text-sm text-slate-700">
                Scanned <strong>{results.scanned}</strong> emails · Created <strong>{results.quotesCreated}</strong> draft quotes · Threaded <strong>{results.repliesAdded}</strong> customer {results.repliesAdded === 1 ? "reply" : "replies"}
              </div>
              {results.errors?.length > 0 && (
                <div className="mt-2 text-xs text-red-600">
                  {results.errors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}
              {results.results?.length > 0 && (
                <div className="mt-2 space-y-1">
                  {results.results.map((r, i) => (
                    <div key={i} className="text-xs text-slate-500">
                      {r.from}: {r.subject} → <span className="font-semibold text-indigo-600">{r.quoteId}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <button onClick={connectGmail} disabled={connecting}
          className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 text-sm font-semibold px-4 py-2.5 rounded-xl transition hover:border-indigo-300 disabled:opacity-50">
          <Mail className="w-4 h-4" />
          {connecting ? "Connecting..." : "Connect Gmail"}
        </button>
      )}
    </div>
  );
}

function maskValue(val) {
  if (!val) return "";
  if (val.length <= 4) return "****";
  return "****" + val.slice(-4);
}

function SupplierKeysSection({ user }) {
  const ssHasKey = !!(user?.ss_account_number && user?.ss_api_key);
  const acHasKey = !!user?.ac_subscription_key;
  const [ssAccount, setSsAccount] = useState(ssHasKey ? maskValue(user.ss_account_number) : "");
  const [ssKey, setSsKey] = useState(ssHasKey ? maskValue(user.ss_api_key) : "");
  const [acSubKey, setAcSubKey] = useState(acHasKey ? maskValue(user.ac_subscription_key) : "");
  const [acEmail, setAcEmail] = useState(user?.ac_email || "");
  const [acPassword, setAcPassword] = useState(user?.ac_password ? "********" : "");
  const [ssEditing, setSsEditing] = useState(!ssHasKey);
  const [acEditing, setAcEditing] = useState(!acHasKey);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Free-freight thresholds — drives the progress bar on Purchase Orders.
  // Per supplier so each can have its own minimum (AS Colour vs S&S vs others).
  const initialThresholds = user?.free_freight_thresholds || {};
  const [acThreshold, setAcThreshold] = useState(initialThresholds["AS Colour"] ?? "");
  const [ssThreshold, setSsThreshold] = useState(initialThresholds["S&S Activewear"] ?? "");

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const updates = {};
      // Only send fields that the user actually typed something into.
      // An empty input in edit mode is not a "clear me" signal — that's
      // a footgun (a shop walking away from the form without typing
      // would otherwise null their saved keys). To explicitly disconnect
      // a supplier, use the "Disconnect" button below the inputs.
      if (ssEditing) {
        if (ssAccount.trim()) updates.ss_account_number = ssAccount.trim();
        if (ssKey.trim()) updates.ss_api_key = ssKey.trim();
      }
      if (acEditing) {
        if (acSubKey.trim()) updates.ac_subscription_key = acSubKey.trim();
        if (acEmail.trim()) updates.ac_email = acEmail.trim();
        if (acPassword.trim() && acPassword !== "********") {
          updates.ac_password = acPassword.trim();
        }
      }
      // Always send thresholds — they're cheap and the user expects edits to stick.
      const thresholds = { ...initialThresholds };
      const acT = Number(acThreshold);
      const ssT = Number(ssThreshold);
      if (acThreshold === "" || acT === 0) delete thresholds["AS Colour"];
      else if (acT > 0) thresholds["AS Colour"] = acT;
      if (ssThreshold === "" || ssT === 0) delete thresholds["S&S Activewear"];
      else if (ssT > 0) thresholds["S&S Activewear"] = ssT;
      updates.free_freight_thresholds = thresholds;
      if (Object.keys(updates).length === 0) { setSaving(false); return; }
      await base44.auth.updateMe(updates);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      alert("Save failed: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  // Explicit disconnect — only way to actually null the credentials.
  // Save never wipes; users have to opt in here.
  async function handleDisconnect(supplier) {
    const labels = {
      ss: "S&S Activewear",
      ac: "AS Colour",
    };
    if (!confirm(`Disconnect ${labels[supplier]}? Your saved API credentials will be removed. You can re-enter them later.`)) {
      return;
    }
    setSaving(true);
    try {
      const updates = supplier === "ac"
        ? { ac_subscription_key: null, ac_email: null, ac_password: null }
        : { ss_account_number: null, ss_api_key: null };
      await base44.auth.updateMe(updates);
      if (supplier === "ac") { setAcSubKey(""); setAcEmail(""); setAcPassword(""); setAcEditing(true); }
      else { setSsAccount(""); setSsKey(""); setSsEditing(true); }
    } catch (err) {
      alert("Disconnect failed: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300";

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-500 leading-relaxed">
        Connect your own supplier accounts for wholesale pricing and ordering. Without your own keys, you can still browse catalogs and check inventory.
      </p>

      {/* S&S Activewear */}
      <div className={`border rounded-xl p-4 space-y-3 ${ssHasKey && !ssEditing ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-red-600">S&S Activewear</span>
            {ssHasKey && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">Connected</span>}
          </div>
          {ssHasKey && !ssEditing && (
            <div className="flex items-center gap-3">
              <button onClick={() => { setSsEditing(true); setSsAccount(""); setSsKey(""); }}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">Edit</button>
              <button onClick={() => handleDisconnect("ss")}
                className="text-xs font-semibold text-slate-400 hover:text-red-500">Disconnect</button>
            </div>
          )}
        </div>
        {ssEditing ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Account Number</label>
                <input type="text" value={ssAccount} onChange={e => setSsAccount(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">API Key</label>
                <input type="password" value={ssKey} onChange={e => setSsKey(e.target.value)} className={inputCls} />
              </div>
            </div>
            <p className="text-[10px] text-slate-400">Find these in your S&S Activewear account under API settings.</p>
          </>
        ) : ssHasKey ? (
          <div className="grid grid-cols-2 gap-3 text-xs text-slate-500">
            <div>Account: <span className="font-mono">{maskValue(user.ss_account_number)}</span></div>
            <div>API Key: <span className="font-mono">{maskValue(user.ss_api_key)}</span></div>
          </div>
        ) : (
          <p className="text-xs text-slate-400">No S&S credentials configured. Enter your account details to connect.</p>
        )}
      </div>

      {/* AS Colour */}
      <div className={`border rounded-xl p-4 space-y-3 ${acHasKey && !acEditing ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-700">AS Colour</span>
            {acHasKey && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">Connected</span>}
          </div>
          {acHasKey && !acEditing && (
            <div className="flex items-center gap-3">
              <button onClick={() => { setAcEditing(true); setAcSubKey(""); setAcEmail(""); setAcPassword(""); }}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">Edit</button>
              <button onClick={() => handleDisconnect("ac")}
                className="text-xs font-semibold text-slate-400 hover:text-red-500">Disconnect</button>
            </div>
          )}
        </div>
        {acEditing ? (
          <>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Subscription Key</label>
              <input type="text" value={acSubKey} onChange={e => setAcSubKey(e.target.value)} className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Email</label>
                <input type="email" value={acEmail} onChange={e => setAcEmail(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Password</label>
                <input type="password" value={acPassword} onChange={e => setAcPassword(e.target.value)} className={inputCls} />
              </div>
            </div>
            <p className="text-[10px] text-slate-400">Contact api@ascolour.com to get your API credentials.</p>
          </>
        ) : acHasKey ? (
          <div className="text-xs text-slate-500 space-y-1">
            <div>Subscription Key: <span className="font-mono">{maskValue(user.ac_subscription_key)}</span></div>
            <div>Email: {user.ac_email}</div>
          </div>
        ) : (
          <p className="text-xs text-slate-400">No AS Colour credentials configured. Enter your account details to connect.</p>
        )}
      </div>

      {/* Free-freight thresholds */}
      <div className="border border-slate-200 rounded-xl p-4 space-y-3">
        <div>
          <div className="text-sm font-bold text-slate-700">Free-freight thresholds</div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Order subtotal at which each supplier ships free. Drives the progress bar
            on Purchase Orders so you can pair jobs to hit it.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">AS Colour ($)</label>
            <input type="number" min="0" step="1" value={acThreshold}
              onChange={e => setAcThreshold(e.target.value)}
              placeholder="e.g. 200"
              className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">S&S Activewear ($)</label>
            <input type="number" min="0" step="1" value={ssThreshold}
              onChange={e => setSsThreshold(e.target.value)}
              placeholder="e.g. 200"
              className={inputCls} />
          </div>
        </div>
      </div>

      <button onClick={handleSave} disabled={saving}
        className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition disabled:opacity-50">
        {saving ? "Saving..." : saved ? "Saved" : "Save API Keys"}
      </button>
    </div>
  );
}

function PricingConfigSection({ user }) {
  const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pricingTab, setPricingTab] = useState("screen_print");

  const DEFAULT_TIERS = [25, 50, 100, 200];
  const DEFAULT_COLORS = 8;

  const DEFAULTS = {
    tiers: DEFAULT_TIERS,
    maxColors: DEFAULT_COLORS,
    firstPrint: {
      1: { 25: 6.3, 50: 5.67, 100: 5.22, 200: 4.9 },
      2: { 25: 6.93, 50: 6.24, 100: 5.77, 200: 5.48 },
      3: { 25: 7.55, 50: 6.8, 100: 6.29, 200: 5.97 },
      4: { 25: 8.16, 50: 7.34, 100: 6.79, 200: 6.45 },
      5: { 25: 8.73, 50: 7.86, 100: 7.27, 200: 6.9 },
      6: { 25: 9.25, 50: 8.33, 100: 7.7, 200: 7.32 },
      7: { 25: 9.75, 50: 8.78, 100: 8.12, 200: 7.72 },
      8: { 25: 10.23, 50: 9.21, 100: 8.52, 200: 8.1 },
    },
    addlPrint: {
      1: { 25: 3.15, 50: 2.68, 100: 2.41, 200: 2.29 },
      2: { 25: 3.45, 50: 2.93, 100: 2.64, 200: 2.51 },
      3: { 25: 3.75, 50: 3.19, 100: 2.87, 200: 2.73 },
      4: { 25: 4.05, 50: 3.44, 100: 3.1, 200: 2.94 },
      5: { 25: 4.25, 50: 3.61, 100: 3.25, 200: 3.09 },
      6: { 25: 4.45, 50: 3.78, 100: 3.4, 200: 3.23 },
      7: { 25: 4.65, 50: 3.95, 100: 3.55, 200: 3.37 },
      8: { 25: 4.85, 50: 4.12, 100: 3.7, 200: 3.51 },
    },
    garmentMarkup: [
      { above: 25, markup: 1.15 },
      { above: 15, markup: 1.22 },
      { above: 8, markup: 1.3 },
      { above: 0, markup: 1.4 },
    ],
    extras: { colorMatch: 1.0, difficultPrint: 0.5, waterbased: 1.0, tags: 1.5 },
    rushRate: 0.20,
    // Embroidery pricing: stitch count tiers × quantity tiers
    embroidery: {
      enabled: false,
      digitizingFee: 50,
      qtyTiers: [12, 24, 48, 72, 144],
      stitchTiers: ["Under 5K", "5K-10K", "10K-15K", "15K+"],
      pricing: {
        "Under 5K": { 12: 8.50, 24: 7.50, 48: 6.50, 72: 5.75, 144: 5.25 },
        "5K-10K":   { 12: 10.50, 24: 9.00, 48: 8.00, 72: 7.00, 144: 6.50 },
        "10K-15K":  { 12: 12.50, 24: 11.00, 48: 9.75, 72: 8.75, 144: 8.00 },
        "15K+":     { 12: 15.00, 24: 13.50, 48: 12.00, 72: 10.75, 144: 9.75 },
      },
      extras: { puffEmbroidery: 2.0, metallicThread: 1.5, applique: 3.0 },
    },
  };

  useEffect(() => {
    async function load() {
      try {
        const shops = await base44.entities.Shop.filter({ owner_email: user.email });
        const pc = shops?.[0]?.pricing_config || {};
        setConfig({ ...DEFAULTS, ...pc });
      } catch {
        setConfig({ ...DEFAULTS });
      }
      setLoading(false);
    }
    if (user) load();
  }, [user]);

  async function handleSave() {
    setSaving(true);
    try {
      const shops = await base44.entities.Shop.filter({ owner_email: user.email });
      if (shops?.[0]) {
        await base44.entities.Shop.update(shops[0].id, { pricing_config: config });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      alert("Save failed: " + err.message);
    }
    setSaving(false);
  }

  function updatePrintTable(table, colors, tier, value) {
    setConfig(prev => ({
      ...prev,
      [table]: {
        ...prev[table],
        [colors]: { ...prev[table][colors], [tier]: parseFloat(value) || 0 },
      },
    }));
  }

  function updateMarkup(idx, field, value) {
    setConfig(prev => {
      const m = [...prev.garmentMarkup];
      m[idx] = { ...m[idx], [field]: parseFloat(value) || 0 };
      return { ...prev, garmentMarkup: m };
    });
  }

  function updateExtra(key, value) {
    setConfig(prev => ({
      ...prev,
      extras: { ...prev.extras, [key]: parseFloat(value) || 0 },
    }));
  }

  function addTier() {
    const tiers = config.tiers || DEFAULT_TIERS;
    const last = tiers[tiers.length - 1] || 100;
    const newTier = last * 2;
    const newTiers = [...tiers, newTier].sort((a, b) => a - b);
    // Add the new tier column to all print tables with 0 default
    const fp = { ...config.firstPrint };
    const ap = { ...config.addlPrint };
    for (const c of Object.keys(fp)) { fp[c] = { ...fp[c], [newTier]: 0 }; }
    for (const c of Object.keys(ap)) { ap[c] = { ...ap[c], [newTier]: 0 }; }
    setConfig(prev => ({ ...prev, tiers: newTiers, firstPrint: fp, addlPrint: ap }));
  }

  function removeTier(tier) {
    const tiers = (config.tiers || DEFAULT_TIERS).filter(t => t !== tier);
    if (tiers.length < 1) return;
    setConfig(prev => ({ ...prev, tiers }));
  }

  function updateTierValue(oldTier, newValue) {
    const val = parseInt(newValue) || 0;
    if (val <= 0) return;
    const tiers = (config.tiers || DEFAULT_TIERS).map(t => t === oldTier ? val : t).sort((a, b) => a - b);
    // Rename the key in print tables
    const rename = (table) => {
      const out = {};
      for (const c of Object.keys(table)) {
        out[c] = {};
        for (const t of Object.keys(table[c])) {
          const k = parseInt(t) === oldTier ? val : parseInt(t);
          out[c][k] = table[c][t];
        }
      }
      return out;
    };
    setConfig(prev => ({ ...prev, tiers, firstPrint: rename(prev.firstPrint), addlPrint: rename(prev.addlPrint) }));
  }

  function addColorRow() {
    const maxC = config.maxColors || DEFAULT_COLORS;
    const newC = maxC + 1;
    const tiers = config.tiers || DEFAULT_TIERS;
    const emptyRow = {};
    tiers.forEach(t => { emptyRow[t] = 0; });
    setConfig(prev => ({
      ...prev,
      maxColors: newC,
      firstPrint: { ...prev.firstPrint, [newC]: { ...emptyRow } },
      addlPrint: { ...prev.addlPrint, [newC]: { ...emptyRow } },
    }));
  }

  function removeColorRow() {
    const maxC = config.maxColors || DEFAULT_COLORS;
    if (maxC <= 1) return;
    const fp = { ...config.firstPrint }; delete fp[maxC];
    const ap = { ...config.addlPrint }; delete ap[maxC];
    setConfig(prev => ({ ...prev, maxColors: maxC - 1, firstPrint: fp, addlPrint: ap }));
  }

  // Embroidery helpers
  function addEmbTier() {
    const et = config.embroidery?.qtyTiers || [12, 24, 48, 72, 144];
    const last = et[et.length - 1] || 100;
    const newTier = last * 2;
    const newTiers = [...et, newTier].sort((a, b) => a - b);
    const pricing = { ...config.embroidery.pricing };
    for (const st of Object.keys(pricing)) { pricing[st] = { ...pricing[st], [newTier]: 0 }; }
    setConfig(prev => ({ ...prev, embroidery: { ...prev.embroidery, qtyTiers: newTiers, pricing } }));
  }

  function removeEmbTier(tier) {
    const et = (config.embroidery?.qtyTiers || []).filter(t => t !== tier);
    if (et.length < 1) return;
    setConfig(prev => ({ ...prev, embroidery: { ...prev.embroidery, qtyTiers: et } }));
  }

  function updateEmbTierValue(oldTier, newValue) {
    const val = parseInt(newValue) || 0;
    if (val <= 0) return;
    const et = (config.embroidery?.qtyTiers || []).map(t => t === oldTier ? val : t).sort((a, b) => a - b);
    const pricing = {};
    for (const st of Object.keys(config.embroidery.pricing)) {
      pricing[st] = {};
      for (const t of Object.keys(config.embroidery.pricing[st])) {
        const k = parseInt(t) === oldTier ? val : parseInt(t);
        pricing[st][k] = config.embroidery.pricing[st][t];
      }
    }
    setConfig(prev => ({ ...prev, embroidery: { ...prev.embroidery, qtyTiers: et, pricing } }));
  }

  function updateEmbroideryPrice(stitchTier, qtyTier, value) {
    setConfig(prev => ({
      ...prev,
      embroidery: {
        ...prev.embroidery,
        pricing: {
          ...prev.embroidery.pricing,
          [stitchTier]: { ...prev.embroidery.pricing[stitchTier], [qtyTier]: parseFloat(value) || 0 },
        },
      },
    }));
  }

  function updateEmbroideryExtra(key, value) {
    setConfig(prev => ({
      ...prev,
      embroidery: {
        ...prev.embroidery,
        extras: { ...prev.embroidery.extras, [key]: parseFloat(value) || 0 },
      },
    }));
  }

  if (loading || !config) return <div className="text-sm text-slate-400 py-4">Loading pricing config...</div>;

  const tiers = config.tiers || DEFAULT_TIERS;
  const maxColors = config.maxColors || DEFAULT_COLORS;
  const colorRows = Array.from({ length: maxColors }, (_, i) => i + 1);
  const emb = config.embroidery || DEFAULTS.embroidery;
  const inputCls = "w-full text-xs text-center border border-slate-200 rounded px-1 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-300";

  function renderPrintTable(tableKey, title) {
    return (
      <div>
        <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-2">{title}</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400">
                <th className="text-left py-1 pr-2">Colors</th>
                {tiers.map(t => (
                  <th key={t} className="text-center py-1">
                    <input type="number" value={t}
                      onChange={e => updateTierValue(t, e.target.value)}
                      className="w-14 text-xs text-center border border-transparent hover:border-slate-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-300 bg-transparent text-slate-400 font-semibold" />
                    <span className="text-slate-300">+</span>
                  </th>
                ))}
                <th className="py-1 px-1">
                  <button onClick={addTier} className="text-indigo-500 hover:text-indigo-700 text-xs font-bold" title="Add tier">+</button>
                </th>
              </tr>
            </thead>
            <tbody>
              {colorRows.map(c => (
                <tr key={c}>
                  <td className="py-1 pr-2 font-semibold text-slate-600 whitespace-nowrap">{c} color{c > 1 ? "s" : ""}</td>
                  {tiers.map(t => (
                    <td key={t} className="py-1 px-0.5">
                      <input type="number" step="0.01" value={config[tableKey][c]?.[t] ?? ""}
                        onChange={e => updatePrintTable(tableKey, c, t, e.target.value)}
                        className={inputCls} />
                    </td>
                  ))}
                  <td></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-500">Customize your pricing for quotes. These rates apply to all new quotes.</p>

      {/* Garment Markup — applies to all decoration types */}
      <div>
        <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-2">Garment Markup</h4>
        <p className="text-[10px] text-slate-400 mb-2">Percentage added to wholesale garment cost. Higher markup for cheaper garments.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {config.garmentMarkup.map((tier, i) => (
            <div key={i} className="border border-slate-200 rounded-lg p-2">
              <label className="text-[10px] text-slate-400 block mb-1">
                {tier.above > 0 ? `Above $${tier.above}` : "Default"}
              </label>
              <div className="relative">
                <input type="number" step="1" value={Math.round((tier.markup - 1) * 100)}
                  onChange={e => updateMarkup(i, "markup", (parseFloat(e.target.value) || 0) / 100 + 1)}
                  className={inputCls} />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Broker Commission */}
      <div>
        <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-2">Broker Commission</h4>
        <p className="text-[10px] text-slate-400 mb-2">Percentage of your garment markup that brokers keep as their commission. Higher = more profit for brokers.</p>
        <div className="flex items-center gap-3">
          <div className="relative w-28">
            <input type="number" step="1" min="0" max="100"
              value={Math.round((config.brokerMarkupShare ?? 0.2) * 100)}
              onChange={e => setConfig(prev => ({ ...prev, brokerMarkupShare: (parseFloat(e.target.value) || 0) / 100 }))}
              className={inputCls} />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">%</span>
          </div>
          <span className="text-xs text-slate-400">of garment markup goes to broker</span>
        </div>
      </div>

      {/* Decoration type tabs */}
      <div className="flex gap-1 border-b border-slate-200 pb-0">
        <button onClick={() => setPricingTab("screen_print")}
          className={`text-xs font-semibold px-4 py-2 rounded-t-lg transition ${pricingTab === "screen_print" ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
          Screen Print
        </button>
        <button onClick={() => { setPricingTab("embroidery"); if (!emb.enabled) setConfig(prev => ({ ...prev, embroidery: { ...prev.embroidery, enabled: true } })); }}
          className={`text-xs font-semibold px-4 py-2 rounded-t-lg transition ${pricingTab === "embroidery" ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
          Embroidery {emb.enabled && <span className="ml-1 text-emerald-400">*</span>}
        </button>
      </div>

      {pricingTab === "screen_print" && <>

      {/* Color Count */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest">Max Print Colors</h4>
          <div className="flex items-center gap-1">
            <button onClick={removeColorRow} disabled={maxColors <= 1}
              className="w-6 h-6 flex items-center justify-center text-xs font-bold border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30">-</button>
            <span className="text-sm font-bold text-slate-700 w-6 text-center">{maxColors}</span>
            <button onClick={addColorRow}
              className="w-6 h-6 flex items-center justify-center text-xs font-bold border border-slate-200 rounded hover:bg-slate-50">+</button>
          </div>
        </div>
      </div>

      {renderPrintTable("firstPrint", "First Print Location (per piece)")}
      {renderPrintTable("addlPrint", "Additional Print Locations (per piece)")}

      {/* Extras & Fees */}
      <div>
        <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-2">Extra Fees (per piece)</h4>
        <p className="text-[10px] text-slate-400 mb-2">Rename, reprice, or remove fees. Add new ones with the button below.</p>
        <div className="space-y-2">
          {Object.entries(config.extras || {}).map(([key, val]) => (
            <div key={key} className="flex items-center gap-2">
              <input type="text" value={config.extraLabels?.[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase()).trim()}
                onChange={e => setConfig(prev => ({ ...prev, extraLabels: { ...(prev.extraLabels || {}), [key]: e.target.value } }))}
                className="flex-1 text-xs border border-slate-200 rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-300" />
              <div className="relative w-24 shrink-0">
                <span className="absolute left-2 top-1.5 text-xs text-slate-400">$</span>
                <input type="number" step="0.01" value={val}
                  onChange={e => updateExtra(key, e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded pl-5 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-300" />
              </div>
              <button onClick={() => setConfig(prev => {
                const next = { ...prev, extras: { ...prev.extras } };
                delete next.extras[key];
                if (next.extraLabels) { next.extraLabels = { ...next.extraLabels }; delete next.extraLabels[key]; }
                return next;
              })} className="text-slate-300 hover:text-red-500 transition text-sm px-1" title="Remove">&times;</button>
            </div>
          ))}
        </div>
        <button onClick={() => {
          const id = `custom_${Date.now()}`;
          setConfig(prev => ({
            ...prev,
            extras: { ...(prev.extras || {}), [id]: 0 },
            extraLabels: { ...(prev.extraLabels || {}), [id]: "New Fee" },
          }));
        }} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 mt-2 transition">
          + Add fee
        </button>
      </div>

      {/* Other Rates */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] text-slate-400 block mb-1">Rush Fee (%)</label>
          <div className="relative">
            <input type="number" step="1" value={Math.round((config.rushRate || 0) * 100)}
              onChange={e => setConfig(prev => ({ ...prev, rushRate: (parseInt(e.target.value) || 0) / 100 }))}
              className="w-full text-xs border border-slate-200 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-300" />
            <span className="absolute right-2 top-1.5 text-xs text-slate-400">%</span>
          </div>
        </div>
      </div>

      </>}

      {/* Embroidery Tab */}
      {pricingTab === "embroidery" && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">Embroidery pricing by stitch count and quantity.</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={emb.enabled}
                onChange={e => setConfig(prev => ({ ...prev, embroidery: { ...prev.embroidery, enabled: e.target.checked } }))}
                className="w-4 h-4 rounded border-slate-300 text-indigo-600" />
              <span className="text-xs font-semibold text-slate-600">Enable Embroidery</span>
            </label>
          </div>

          {emb.enabled && <>
            {/* Digitizing Fee */}
            <div>
              <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-2">Digitizing / Setup Fee</h4>
              <div className="w-40">
                <div className="relative">
                  <span className="absolute left-2 top-1.5 text-xs text-slate-400">$</span>
                  <input type="number" step="1" value={emb.digitizingFee}
                    onChange={e => setConfig(prev => ({ ...prev, embroidery: { ...prev.embroidery, digitizingFee: parseFloat(e.target.value) || 0 } }))}
                    className="w-full text-xs border border-slate-200 rounded px-5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                </div>
                <p className="text-[10px] text-slate-400 mt-1">One-time fee per new design</p>
              </div>
            </div>

            {/* Embroidery Quantity Tiers */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest">Quantity Tiers</h4>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                {(emb.qtyTiers || []).map(t => (
                  <div key={t} className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
                    <input type="number" value={t} onChange={e => updateEmbTierValue(t, e.target.value)}
                      className="w-14 text-xs text-center border-none bg-transparent focus:outline-none font-semibold text-slate-700" />
                    <span className="text-[10px] text-slate-400">pcs</span>
                    {(emb.qtyTiers || []).length > 1 && (
                      <button onClick={() => removeEmbTier(t)} className="text-slate-300 hover:text-red-500 text-xs ml-1">x</button>
                    )}
                  </div>
                ))}
                <button onClick={addEmbTier} className="text-xs font-semibold text-indigo-600 border border-indigo-200 px-2.5 py-1 rounded-lg hover:bg-indigo-50">+ Add Tier</button>
              </div>
            </div>

            {/* Embroidery Pricing Table */}
            <div>
              <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-2">Per Piece Pricing</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400">
                      <th className="text-left py-1 pr-2">Stitch Count</th>
                      {(emb.qtyTiers || []).map(t => <th key={t} className="text-center py-1">{t}+</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {(emb.stitchTiers || []).map(st => (
                      <tr key={st}>
                        <td className="py-1 pr-2 font-semibold text-slate-600 whitespace-nowrap">{st}</td>
                        {(emb.qtyTiers || []).map(t => (
                          <td key={t} className="py-1 px-0.5">
                            <input type="number" step="0.01" value={emb.pricing?.[st]?.[t] ?? ""}
                              onChange={e => updateEmbroideryPrice(st, t, e.target.value)}
                              className={inputCls} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Embroidery Extras */}
            <div>
              <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-2">Embroidery Extras (per piece)</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { key: "puffEmbroidery", label: "Puff / 3D Embroidery" },
                  { key: "metallicThread", label: "Metallic Thread" },
                  { key: "applique", label: "Applique" },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="text-[10px] text-slate-400 block mb-1">{label}</label>
                    <div className="relative">
                      <span className="absolute left-2 top-1.5 text-xs text-slate-400">$</span>
                      <input type="number" step="0.01" value={emb.extras?.[key] ?? ""}
                        onChange={e => updateEmbroideryExtra(key, e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded px-5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition disabled:opacity-50">
          {saving ? "Saving..." : saved ? "Saved" : "Save Pricing"}
        </button>
        <button onClick={() => setConfig({ ...DEFAULTS })}
          className="text-xs text-slate-500 hover:text-slate-700 font-semibold">
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}