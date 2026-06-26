import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { base44, supabase } from "@/api/supabaseClient";
import { FormSkeleton, InlineLinesSkeleton } from "@/components/shared/Skeletons";
import { uploadFile } from "@/lib/uploadFile";
import { clampRushTierMaxDays, defaultNewRushTierMaxDays } from "@/lib/pricing/rushTierClamp";
import { DEFAULT_BRAND, BRAND_PRESETS, normalizeBrandColor } from "@/lib/branding";
import { User, LogOut, Upload, X, Package, Link2, CheckCircle2, AlertCircle, Mail, RefreshCw, DownloadCloud, ChevronDown, Wand2, CreditCard, Loader2, CheckSquare, Shield } from "lucide-react";
import { PLANS, getTierLabel, getTierColor } from "@/lib/billing";
import { decidePricingSave } from "@/lib/pricing/inputValidation";
import { loadShopPricingConfig, GARMENT_CATEGORIES } from "@/components/shared/pricing";
import { normalizePresses, serializePresses } from "@/lib/presses/normalizePresses";
import NumericInput from "@/components/shared/NumericInput";
import { SHOP_TIMEZONE_OPTIONS, loadShopTimezone } from "@/lib/shopTimezone";
import WizardConfigEditor from "../components/wizard/WizardConfigEditor";
import SecuritySection from "../components/account/SecuritySection";
import StepUpConfirmModal from "@/components/StepUpConfirmModal";
import { notify } from "@/lib/notify";
import { useAuth } from "@/lib/AuthContext";
import { qbOAuthErrorMessage } from "@/lib/qb/oauthErrorMessage";
import { getMissingAutoDerivedTasks } from "@/lib/productionTasks";
import { shopScope } from "@/lib/shopScope";

function Section({ icon: IconComp, title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between py-2 group">
        <div className="flex items-center gap-2">
          {IconComp && <IconComp className="w-5 h-5 text-teal-600" />}
          <h3 className="text-sm sm:text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        </div>
        <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="pt-3">{children}</div>}
    </div>
  );
}

const QB_CLIENT_ID   = import.meta.env.VITE_QB_CLIENT_ID;
// QB OAuth redirect routes through a Vercel proxy (api/qb-callback.js)
// because the Supabase Functions gateway rejects Intuit's redirect
// (no Authorization header). The proxy injects the anon JWT, then
// forwards to the qbOAuthCallback edge function.
const QB_REDIRECT_URI = `${import.meta.env.VITE_APP_URL?.trim() || "https://inktracker.app"}/api/qb-callback`;
const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

function buildQBAuthUrl(state) {
  const params = new URLSearchParams({
    client_id:     QB_CLIENT_ID,
    response_type: "code",
    scope:         "com.intuit.quickbooks.accounting",
    redirect_uri:  QB_REDIRECT_URI,
    state,
    // Force the QB login + company picker every connect. Without
    // this, Intuit silently auto-connects to whichever company is
    // active in the user's browser session — fine for single-
    // company shops, broken for accounting firms / multi-LLC owners
    // who NEED to pick. Matches the OnboardingWizard QB-connect
    // flow.
    prompt:        "login",
  });
  return `https://appcenter.intuit.com/connect/oauth2?${params}`;
}

const DEFAULT_ADDONS = [
  { key: "tags", label: "Custom Tags", rate: 1.5 },
  { key: "difficultPrint", label: "Difficult Print", rate: 0.5 },
  { key: "colorMatch", label: "Ink Color Match", rate: 1.0 },
  { key: "waterbased", label: "Water-Based Ink", rate: 1.0 },
];

export default function Account() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [shopName, setShopName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  // Stored on shops.brand_color, drives customer-facing surfaces
  // (wizard in Phase 1; email/QuotePayment/ArtApproval/PDFs in Phase 2).
  // Empty string = use the default (teal). normalizeBrandColor on save
  // turns invalid input into null so the DB CHECK never rejects.
  const [brandColor, setBrandColor] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [stateVal, setStateVal] = useState("");
  const [zip, setZip] = useState("");
  const [website, setWebsite] = useState("");
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
  const [qbSyncingAll, setQbSyncingAll] = useState(null); // null | "customers" | "invoices"
  const [qbSyncAllError, setQbSyncAllError] = useState(null);
  const [qbRealmId, setQbRealmId] = useState(null);
  const [qbExpiresAt, setQbExpiresAt] = useState(null);
  // ~100-day refresh-token expiry — the one whose lapse silently kills the
  // connection. Drives the "reconnect by X" hint + nudge.
  const [qbRefreshExpiresAt, setQbRefreshExpiresAt] = useState(null);
  const [qbConnecting, setQbConnecting] = useState(false);
  const [qbMessage, setQbMessage] = useState(null); // { type: "success"|"error", text }
  const [qbDisconnecting, setQbDisconnecting] = useState(false);
  // Step-up auth gate for QB disconnect. Open after the user passes the
  // window.confirm; the modal handles the MFA code check (and is a no-op
  // pass-through if MFA isn't enabled on the account).
  const [showQbDisconnectStepUp, setShowQbDisconnectStepUp] = useState(false);

  // Stripe Connect was removed for the initial launch — QuickBooks is the
  // canonical customer-payment integration. The backend code (billing
  // actions, createCheckoutSession, stripeWebhook, the reconciliation
  // script) is intentionally left in place dormant; re-enabling is a
  // UI-only change. See PR #201.


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
        setFirstName(currentUser.first_name || "");
        setLastName(currentUser.last_name || "");
        setLogoUrl(currentUser.logo_url || "");
        setPhone(currentUser.phone || "");
        setAddress(currentUser.address || "");
        setCity(currentUser.city || "");
        setStateVal(currentUser.state || "");
        setZip(currentUser.zip || "");
        setWebsite(currentUser.website || "");
        setTaxRate(currentUser.default_tax_rate || "");
        // Load addons from Shop entity
        try {
          const shops = await base44.entities.Shop.filter({ owner_email: shopScope(currentUser) });
          setShopRecord(shops?.[0] || null);
          setTimezone(shops?.[0]?.timezone || "");
          setBrandColor(shops?.[0]?.brand_color || "");
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
          // base44.functions.invoke wraps supabase.functions.invoke, which
          // auto-includes the Supabase Authorization header that the
          // Functions gateway requires. Raw fetch without that header gets
          // rejected with UNAUTHORIZED_NO_AUTH_HEADER.
          const { data, error: invErr } = await base44.functions.invoke("qbSync", {
            action: "checkConnection",
            accessToken: session?.access_token,
          });
          if (!invErr && data) {
            setQbConnected(data.connected);
            setQbRealmId(data.realmId);
            setQbExpiresAt(data.expiresAt);
            setQbRefreshExpiresAt(data.refreshTokenExpiresAt || null);
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
      // Centralized copy keeps the broker dashboard's OAuth error
      // panel in sync — both pages call the same helper.
      setQbMessage({ type: "error", text: qbOAuthErrorMessage(params.get("qb_error")) });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("qb_disconnected_remotely") === "1") {
      // Intuit redirected the user here via api/qb-disconnect after
      // they revoked InkTracker from the QuickBooks side. Fire the
      // local disconnect to clear our tokens too, so the connection
      // panel reflects the disconnected state immediately rather than
      // staying optimistic until the next failed refresh.
      setQbConnected(false);
      setQbMessage({
        type: "success",
        text: "QuickBooks was disconnected from your QuickBooks account. We've cleared the connection on our side too — reconnect anytime.",
      });
      window.history.replaceState({}, "", window.location.pathname);
      (async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session?.access_token) return;
          await base44.functions.invoke("qbSync", {
            action: "disconnect",
            accessToken: session.access_token,
          });
        } catch (err) {
          console.warn("[qb-disconnect-remote] local token clear failed:", err?.message);
        }
      })();
    }
  }, [location.search]);

  async function handleSave() {
    setSaving(true);
    try {
      // Compose full_name from first + last so the 30+ legacy display
      // sites (broker UI, admin panel, dashboard greetings) keep
      // working without a sweep. Trim+collapse whitespace defensively.
      const cleanFirst = firstName.trim();
      const cleanLast = lastName.trim();
      const composedFullName = [cleanFirst, cleanLast].filter(Boolean).join(" ");

      const updatedUser = await base44.auth.updateMe({
        shop_name: shopName,
        first_name: cleanFirst || null,
        last_name: cleanLast || null,
        full_name: composedFullName || null,
        logo_url: logoUrl,
        phone: phone.trim(),
        address: address.trim(),
        city: city.trim(),
        state: stateVal.trim().toUpperCase(),
        zip: zip.trim(),
        website: website.trim() || null,
        default_tax_rate: parseFloat(taxRate) || 0,
      });

      // Timezone lives on the shops table (so it applies to every user in
      // this shop, not just whoever saved last). Best-effort — failing this
      // shouldn't undo the profile save above.
      try {
        const shops = await base44.entities.Shop.filter({ owner_email: shopScope(user) });
        const payload = {
          // Keep the shops mirror of shop_name in sync with the profile.
          // It was previously only set at shop-create, so a later rename
          // left shops.shop_name stale (consumed by the quote email).
          shop_name: shopName,
          timezone: timezone || null,
          brand_color: normalizeBrandColor(brandColor),
        };
        if (shops?.[0]) {
          await base44.entities.Shop.update(shops[0].id, payload);
        } else {
          await base44.entities.Shop.create({
            owner_email: shopScope(user),
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
      const shops = await base44.entities.Shop.filter({ owner_email: shopScope(user) });
      const payload = { quote_email_subject: emailSubject, quote_email_body: emailBody };
      if (shops?.length) {
        await base44.entities.Shop.update(shops[0].id, payload);
      } else {
        await base44.entities.Shop.create({
          owner_email: shopScope(user),
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
      const shops = await base44.entities.Shop.filter({ owner_email: shopScope(user) });
      if (shops?.length) {
        await base44.entities.Shop.update(shops[0].id, { addons });
      } else {
        await base44.entities.Shop.create({
          owner_email: shopScope(user),
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
      // qb_oauth_state lives on profile_secrets now (service-role-only RLS).
      // Frontend can't write it directly — go through the profileSecrets
      // edge function which generates the UUID and stores it for us.
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
      console.error("QB connect error:", err);
      setQbMessage({ type: "error", text: "Could not start QuickBooks connection. Please try again." });
      setQbConnecting(false);
    }
  }

  // First gate — quick "are you sure" via native confirm. If the user
  // says yes, we open the step-up modal which either (a) demands a
  // fresh MFA code for users with MFA on, or (b) passes through
  // transparently for users without MFA. The actual disconnect work
  // lives in doDisconnectQB and runs only after both gates clear.
  function handleDisconnectQB() {
    if (!window.confirm("Disconnect QuickBooks? Existing synced invoices won't be affected.")) return;
    setShowQbDisconnectStepUp(true);
  }

  async function doDisconnectQB() {
    setShowQbDisconnectStepUp(false);
    setQbDisconnecting(true);
    try {
      // Route through qbSync `disconnect` action — clears tokens from
      // BOTH profile_secrets (new) and profiles (legacy fallback).
      // Direct client-side UPDATE on profiles alone left the secrets
      // table intact, so the next checkConnection still saw valid
      // tokens and reported connected — disconnect appeared to do
      // nothing on the next page load.
      //
      // Use base44.functions.invoke (not raw fetch) so the Supabase
      // Authorization header is included — gateway requires it even
      // when verify_jwt=false.
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error: invErr } = await base44.functions.invoke("qbSync", {
        action: "disconnect",
        accessToken: session?.access_token,
      });
      if (invErr) throw new Error(invErr.message || "Disconnect failed");
      if (data?.error) throw new Error(data.error);
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
      const { data, error: invErr } = await base44.functions.invoke("qbSync", {
        action: "pullCustomers",
        accessToken: session?.access_token,
      });
      if (invErr) throw new Error(invErr.message || "Migration failed");
      if (data?.error) throw new Error(data.error);
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
      const { data, error: invErr } = await base44.functions.invoke("qbSync", {
        action: "pullInvoices",
        accessToken: session?.access_token,
      });
      if (invErr) throw new Error(invErr.message || "Migration failed");
      if (data?.error) throw new Error(data.error);
      setQbMigrateInvResult(data);
    } catch (err) {
      console.error("QB invoice migration failed:", err);
      setQbMigrateInvResult({ error: err.message });
    } finally {
      setQbMigratingInv(false);
    }
  }

  // One-click sync: customers FIRST, then invoices — the correct order, so the
  // invoice pull can link each invoice to its just-imported customer. Doing
  // invoices first (or alone) leaves invoices with no customer link, which is
  // exactly the gap a shop hit when they ran only the invoice sync.
  async function handleSyncAll() {
    setQbSyncAllError(null);
    setQbMigrateResult(null);
    setQbMigrateInvResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      // 1. Customers
      setQbSyncingAll("customers");
      const { data: custData, error: custErr } = await base44.functions.invoke("qbSync", {
        action: "pullCustomers",
        accessToken: session?.access_token,
      });
      if (custErr) throw new Error(custErr.message || "Customer sync failed");
      if (custData?.error) throw new Error(custData.error);
      setQbMigrateResult(custData);
      // 2. Invoices (now they can link to the customers just imported)
      setQbSyncingAll("invoices");
      const { data: invData, error: invErr } = await base44.functions.invoke("qbSync", {
        action: "pullInvoices",
        accessToken: session?.access_token,
      });
      if (invErr) throw new Error(invErr.message || "Invoice sync failed");
      if (invData?.error) throw new Error(invData.error);
      setQbMigrateInvResult(invData);
    } catch (err) {
      console.error("QB full sync failed:", err);
      setQbSyncAllError(err.message);
    } finally {
      setQbSyncingAll(null);
    }
  }

  async function handleLogout() {
    await base44.auth.logout("/");
  }

  if (loading) {
    return <div className="max-w-5xl"><FormSkeleton fields={5} /></div>;
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">First Name</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Joe"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Last Name</label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Smith"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Shop Name
              </label>
              <input
                type="text"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Phone</label>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 123-4567"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Default Tax Rate %</label>
                <input type="number" step="0.001" value={taxRate} onChange={e => setTaxRate(e.target.value)} placeholder="8.265"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500" />
                <p className="text-xs text-slate-400 mt-1">Enter the percentage (8.265 means 8.265%), not a decimal.</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Shop Timezone</label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
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
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-3 gap-2 sm:gap-3">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">City</label>
                <input type="text" value={city} onChange={e => setCity(e.target.value)} placeholder="Reno"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">State</label>
                <input type="text" value={stateVal} onChange={e => setStateVal(e.target.value)} placeholder="NV" maxLength={2}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500 uppercase" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">ZIP</label>
                <input type="text" value={zip} onChange={e => setZip(e.target.value)} placeholder="89502"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Website</label>
              <input type="url" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://yourshop.com"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500" />
              <p className="text-xs text-slate-400 mt-1">Shown on art proofs in place of the platform footer.</p>
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

              <label className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-teal-400 cursor-pointer transition bg-slate-50 dark:bg-slate-800 hover:bg-teal-50">
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

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Brand Color
              </label>
              <p className="text-xs text-slate-500 mb-3">
                Drives the order wizard's primary button and step accents. Leave unset to use the InkTracker default.
              </p>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                {BRAND_PRESETS.map(p => {
                  const selected = (brandColor || "").toLowerCase() === p.hex;
                  return (
                    <button
                      key={p.hex}
                      type="button"
                      onClick={() => setBrandColor(p.hex)}
                      title={p.label}
                      aria-label={p.label}
                      aria-pressed={selected}
                      className={`w-9 h-9 rounded-full border-2 transition ${selected ? "border-slate-900 dark:border-white scale-110" : "border-slate-200 dark:border-slate-700"}`}
                      style={{ backgroundColor: p.hex }}
                    />
                  );
                })}
                {brandColor && (
                  <button
                    type="button"
                    onClick={() => setBrandColor("")}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-700 ml-1 underline"
                  >
                    Reset
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={brandColor || DEFAULT_BRAND}
                  onChange={e => setBrandColor(e.target.value)}
                  className="w-12 h-10 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer bg-transparent"
                  aria-label="Custom brand color"
                />
                <div
                  className="px-4 py-2 rounded-lg text-white text-sm font-semibold"
                  style={{ backgroundColor: brandColor || DEFAULT_BRAND }}
                >
                  Preview button
                </div>
                <span className="text-xs font-mono text-slate-500">
                  {brandColor ? brandColor.toLowerCase() : `${DEFAULT_BRAND} (default)`}
                </span>
              </div>
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
              className="bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white font-semibold px-4 py-2.5 rounded-xl transition"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>

            <div className="border-t border-slate-200 dark:border-slate-700 pt-5 mt-2">
              <div className="text-sm font-semibold text-slate-700 mb-2">Presses</div>
              <PressesSection user={user} />
            </div>
          </div>
        </Section>

        {(user?.role === "admin" || user?.role === "shop") && <Section icon={CreditCard} title="Billing & Plan" defaultOpen={location.search?.includes("billing")}>
          <BillingSection user={user} />
        </Section>}

        <Section icon={User} title="Account">
          <div className="space-y-5">
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

            <div className="border-t border-slate-200 dark:border-slate-700 pt-5">
              <div className="text-sm font-semibold text-slate-700 mb-2">Export Data</div>
              <ExportDataSection user={user} />
            </div>
          </div>
        </Section>

        {user && (
          <Section icon={Shield} title="Security" defaultOpen={location.search?.includes("security")}>
            <SecuritySection />
          </Section>
        )}

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
                className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Message Body</label>
              <textarea rows={5} value={emailBody} onChange={(e) => setEmailBody(e.target.value)}
                placeholder={"Hi {{customer_name}},\n\nYour quote is ready. Total: {{total}}.\n\nClick below to view, approve, or pay:\n{{payment_link}}"}
                className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300 resize-none font-mono" />
            </div>
            <button onClick={handleSaveTemplate} disabled={savingTemplate}
              className="bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white font-semibold px-4 py-2 rounded-xl text-sm transition">
              {savingTemplate ? "Saving..." : "Save Template"}
            </button>
          </div>
        </Section>

        {/* QuickBooks is a financial-wiring surface — disconnecting QB
            would affect the whole shop's invoicing and customer payments.
            Same admin/shop gate as Billing & Plan above so a manager
            (who has full operational access but "no billing/admin"
            per CLAUDE.md) can't accidentally or maliciously break it. */}
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
                  Access token: refreshes automatically every hour
                </div>
              )}
              {qbRefreshExpiresAt && (() => {
                const daysLeft = Math.floor((new Date(qbRefreshExpiresAt).getTime() - Date.now()) / 86400000);
                const soon = daysLeft <= 14;
                return (
                  <div className={`text-xs ${soon ? "text-amber-700 font-semibold" : "text-slate-500"}`}>
                    Reconnect by {new Date(qbRefreshExpiresAt).toLocaleDateString()}
                    {daysLeft >= 0 ? ` (${daysLeft} day${daysLeft === 1 ? "" : "s"} left)` : " (expired)"}
                  </div>
                );
              })()}
              {qbRefreshExpiresAt && Math.floor((new Date(qbRefreshExpiresAt).getTime() - Date.now()) / 86400000) <= 14 && (
                <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <span className="text-xs text-amber-800">
                    Your QuickBooks connection expires soon. Reconnect now to avoid an interruption to invoicing.
                  </span>
                  <button
                    onClick={handleConnectQB}
                    disabled={qbConnecting}
                    className="shrink-0 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg px-3 py-1.5 transition disabled:opacity-50"
                  >
                    {qbConnecting ? "…" : "Reconnect"}
                  </button>
                </div>
              )}
              <p className="text-sm text-slate-600">
                Quotes can now be sent as QuickBooks invoices. Once your client pays via the QB payment link, InkTracker automatically converts the quote to an order.
              </p>
              <a href="/qb-setup" target="_blank" rel="noopener" className="inline-block text-sm text-teal-600 hover:underline font-semibold">
                QB setup checklist — make sure your QBO side is ready →
              </a>
              <div className="border-t border-emerald-200 pt-3 mt-3">
                {/* Renamed from "Data Migration" + "Import" — these
                    actions dedupe on the QB id under the hood
                    (pullCustomers checks customers.qb_customer_id;
                    pullInvoices checks invoices.invoice_id) so they
                    can be re-run safely without creating duplicates.
                    "Sync" reflects that better than "Import", which
                    sounds like a one-shot copy. */}
                <div className="text-sm font-semibold text-slate-700 mb-2">Data Sync</div>

                {/* One-click: customers then invoices, in the correct order. */}
                <button
                  onClick={handleSyncAll}
                  disabled={qbSyncingAll !== null || qbMigrating || qbMigratingInv}
                  className="w-full flex items-center justify-center gap-2 text-sm font-bold text-white bg-emerald-600 px-3 py-2.5 rounded-xl hover:bg-emerald-700 transition disabled:opacity-50"
                >
                  {qbSyncingAll ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      {qbSyncingAll === "customers" ? "Syncing customers…" : "Syncing invoices…"}
                    </>
                  ) : (
                    <>
                      <DownloadCloud className="w-4 h-4" />
                      Sync everything from QuickBooks
                    </>
                  )}
                </button>
                <p className="text-xs text-slate-500 mt-1.5">
                  Imports your QuickBooks customers, then your invoices (in that order so invoices link to the right customer). Safe to re-run anytime — it updates existing records, never duplicates.
                </p>
                {qbSyncAllError && (
                  <div className="mt-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    Sync failed: {qbSyncAllError}
                  </div>
                )}

                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-4 mb-2">Or sync individually</div>
                <button
                  onClick={handleMigrateCustomers}
                  disabled={qbMigrating || qbSyncingAll !== null}
                  className="flex items-center gap-2 text-sm font-semibold text-emerald-700 border border-emerald-300 px-3 py-2 rounded-xl hover:bg-emerald-100 transition disabled:opacity-50"
                >
                  {qbMigrating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Syncing Customers…
                    </>
                  ) : (
                    <>
                      <DownloadCloud className="w-4 h-4" />
                      Sync Customers from QuickBooks
                    </>
                  )}
                </button>
                {qbMigrateResult && !qbMigrateResult.error && (
                  <>
                    <div className="mt-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                      Added <strong>{qbMigrateResult.imported}</strong> new customer{qbMigrateResult.imported !== 1 ? "s" : ""},
                      updated <strong>{qbMigrateResult.updated}</strong>,
                      skipped <strong>{qbMigrateResult.skipped}</strong> already in sync.
                    </div>
                    {qbMigrateResult.truncatedAtCap && (
                      <div className="mt-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        <strong>Warning:</strong> sync stopped at 10,000 customers. Your QuickBooks has more than that; not all were synced. Contact support to raise the cap.
                      </div>
                    )}
                  </>
                )}
                {qbMigrateResult?.error && (
                  <div className="mt-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    Migration failed: {qbMigrateResult.error}
                  </div>
                )}
                <button
                  onClick={handleMigrateInvoices}
                  disabled={qbMigratingInv || qbSyncingAll !== null}
                  className="flex items-center gap-2 text-sm font-semibold text-emerald-700 border border-emerald-300 px-3 py-2 rounded-xl hover:bg-emerald-100 transition disabled:opacity-50 mt-2"
                >
                  {qbMigratingInv ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Syncing Invoices…
                    </>
                  ) : (
                    <>
                      <DownloadCloud className="w-4 h-4" />
                      Sync Invoices from QuickBooks
                    </>
                  )}
                </button>
                {qbMigrateInvResult && !qbMigrateInvResult.error && (
                  <>
                    <div className="mt-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                      Added <strong>{qbMigrateInvResult.imported}</strong> invoice{qbMigrateInvResult.imported !== 1 ? "s" : ""},
                      updated <strong>{qbMigrateInvResult.updated}</strong>,
                      skipped <strong>{qbMigrateInvResult.skipped}</strong> already in sync.
                    </div>
                    {qbMigrateInvResult.truncatedAtCap && (
                      <div className="mt-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        <strong>Warning:</strong> sync stopped at 10,000 invoices. Your QuickBooks has more than that; not all were synced. Contact support to raise the cap.
                      </div>
                    )}
                  </>
                )}
                {qbMigrateInvResult?.error && (
                  <div className="mt-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    Invoice sync failed: {qbMigrateInvResult.error}
                  </div>
                )}
              </div>
              <QbItemMapEditor user={user} />
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

              {/* Inline trust signals. Surfaced HERE rather than buried on
                  the /security page because operators won't click through —
                  the moment of trust is right when they're about to hand
                  over QB write access. */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
                <div className="font-semibold text-slate-700 dark:text-slate-200 text-xs uppercase tracking-wider">Before you connect:</div>
                <ul className="space-y-1">
                  <li className="flex gap-2"><span className="text-emerald-600">✓</span><span>Your QuickBooks tokens live server-side only — never visible in your browser.</span></li>
                  <li className="flex gap-2"><span className="text-emerald-600">✓</span><span>Every action InkTracker takes on your books shows up in the Events tab of each quote.</span></li>
                  <li className="flex gap-2"><span className="text-emerald-600">✓</span><span>Idempotency keys prevent double-billing from network retries or double-clicks.</span></li>
                  <li className="flex gap-2"><span className="text-emerald-600">✓</span><span>Nightly reconciliation catches missed payment webhooks and re-syncs your books.</span></li>
                  <li className="flex gap-2"><span className="text-emerald-600">✓</span><span>One-click disconnect, anytime. Revoke from QuickBooks side too for defense in depth.</span></li>
                  <li className="flex gap-2"><span className="text-emerald-600">✓</span><span>Customer card and bank info stays inside QuickBooks Payments — we never see it.</span></li>
                </ul>
                <div className="pt-1 flex flex-wrap gap-x-4 gap-y-1">
                  <a href="/qb-setup" target="_blank" rel="noopener" className="text-teal-600 hover:underline font-semibold">QB setup checklist →</a>
                  <a href="/security" className="text-teal-600 hover:underline font-semibold">Full security details →</a>
                </div>
              </div>

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

        <Section icon={CreditCard} title="Pricing & Fees">
          <PricingConfigSection user={user} />
        </Section>

        <Section icon={CheckSquare} title="Production Tasks">
          <ProductionTasksSection user={user} />
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

      <StepUpConfirmModal
        open={showQbDisconnectStepUp}
        actionLabel="Disconnect QuickBooks"
        description="Disconnecting revokes our access to your QuickBooks account. Existing synced invoices stay in QB; future syncs stop until you reconnect."
        onConfirm={doDisconnectQB}
        onCancel={() => setShowQbDisconnectStepUp(false)}
      />
    </div>
  );
}

// Map InkTracker garment categories → the shop's real QuickBooks items, so
// invoices land on the shop's existing items instead of creating duplicates
// (e.g. InkTracker's "Hoodies & Sweatshirts" vs the shop's "Sweatshirts").
// Saves to pricing_config.qb_item_map; buildQBInvoicePayload applies it. Only
// affects FUTURE invoices — existing duplicate items must be merged in QB.
function QbItemMapEditor({ user }) {
  const [open, setOpen] = useState(false);
  const [qbItems, setQbItems] = useState(null); // null = not loaded yet
  const [map, setMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  async function openEditor() {
    setOpen(true);
    if (qbItems !== null) return; // already loaded once
    setLoading(true);
    setError(null);
    try {
      const shops = await base44.entities.Shop.filter({ owner_email: shopScope(user) });
      setMap(shops?.[0]?.pricing_config?.qb_item_map || {});
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error: invErr } = await base44.functions.invoke("qbSync", {
        action: "listQbItems",
        accessToken: session?.access_token,
      });
      if (invErr) throw new Error(invErr.message || "Couldn't load QuickBooks items");
      if (data?.error) throw new Error(data.error);
      setQbItems(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setError(err.message);
      setQbItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const shops = await base44.entities.Shop.filter({ owner_email: shopScope(user) });
      // Drop empty selections so an unset category falls back to default behavior.
      const cleanMap = Object.fromEntries(
        Object.entries(map).filter(([, v]) => v && String(v).trim()),
      );
      const pc = { ...(shops?.[0]?.pricing_config || {}), qb_item_map: cleanMap };
      if (shops?.[0]) await base44.entities.Shop.update(shops[0].id, { pricing_config: pc });
      loadShopPricingConfig(pc);
      setMap(cleanMap);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-t border-emerald-200 pt-3 mt-3">
      {!open ? (
        <button
          onClick={openEditor}
          className="flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-900 transition"
        >
          <Link2 className="w-4 h-4" />
          Map garment types to your QuickBooks items
        </button>
      ) : (
        <div>
          <div className="text-sm font-semibold text-slate-700 mb-1">Map garment types to QuickBooks items</div>
          <p className="text-xs text-slate-500 mb-3">
            Point each InkTracker garment type at the QuickBooks product/service you want it booked under, so sales don't get split across duplicate items. Leave a row on "Default" to keep current behavior. Affects future invoices only.
          </p>
          {loading && <div className="text-sm text-slate-500">Loading your QuickBooks items…</div>}
          {error && (
            <div className="mb-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}
          {!loading && qbItems !== null && (
            <>
              <div className="space-y-1.5">
                {GARMENT_CATEGORIES.map((cat) => (
                  <div key={cat} className="flex items-center gap-2">
                    <div className="w-40 text-sm text-slate-700 shrink-0">{cat}</div>
                    <span className="text-slate-300">→</span>
                    <select
                      value={map[cat] || ""}
                      onChange={(e) => setMap((m) => ({ ...m, [cat]: e.target.value }))}
                      className="flex-1 text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    >
                      <option value="">Default (InkTracker creates/uses "{cat}")</option>
                      {qbItems.map((it) => (
                        <option key={it.id} value={it.name}>{it.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={save}
                  disabled={saving}
                  className="text-sm font-bold text-white bg-emerald-600 px-4 py-2 rounded-xl hover:bg-emerald-700 transition disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save mapping"}
                </button>
                <button onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:text-slate-700">Close</button>
                {saved && <span className="text-sm text-emerald-700 font-semibold">Saved ✓</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function BillingSection({ user }) {
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(null);
  const { checkAppState } = useAuth();

  const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

  useEffect(() => {
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const { data } = await base44.functions.invoke("billing", {
          action: "getSubscription",
          accessToken: session?.access_token,
        });
        if (data) {
          setSub(data);
          // The backend self-heals a stuck-on-trial profile against live
          // Stripe state here. If it just promoted us to a paid plan but the
          // cached auth user still says "trial", refresh the user so the
          // global feature gate + "trial ended" banner clear without a manual
          // page reload.
          const healedToPaid = data.tier === "shop" || data.status === "active" || data.status === "trialing";
          const cachedSaysExpired = user?.subscription_tier !== "shop" && user?.subscription_status !== "active";
          if (healedToPaid && cachedSaysExpired) {
            checkAppState?.({ silent: true });
          }
        }
      } catch {}
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCheckout(billing) {
    // billing: "monthly" ($99/mo) | "annual" ($999/yr)
    setCheckoutLoading(billing);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error: invErr } = await base44.functions.invoke("billing", {
        action: "checkout",
        accessToken: session?.access_token,
        billing,
      });
      if (invErr) { notify.error("Couldn't start checkout", invErr); return; }
      if (data?.url) window.location.href = data.url;
      else notify.error("Couldn't start checkout", data?.error);
    } catch (err) {
      notify.error("Checkout failed", err);
    } finally {
      setCheckoutLoading(null);
    }
  }

  async function handlePortal() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error: invErr } = await base44.functions.invoke("billing", {
        action: "portal",
        accessToken: session?.access_token,
      });
      if (invErr) {
        // Supabase wraps non-2xx responses in FunctionsHttpError and
        // hides the real error message behind `.context.response`.
        // Without this unwrap, the operator sees "Edge Function
        // returned a non-2xx status code" with no signal about which
        // Stripe / config issue caused it.
        const ctxRes = invErr.context?.response ?? (typeof invErr.context?.text === "function" ? invErr.context : null);
        let detail = invErr.message;
        if (ctxRes?.text) {
          try {
            const body = await ctxRes.text();
            const parsed = JSON.parse(body);
            detail = parsed?.error || body || detail;
          } catch {}
        }
        notify.error("Couldn't open billing portal", detail);
        return;
      }
      if (data?.url) window.location.href = data.url;
      else notify.error("Couldn't open billing portal", data?.error);
    } catch (err) {
      notify.error("Couldn't open billing portal", err);
    }
  }

  if (loading) {
    return <div className="py-4"><InlineLinesSkeleton /></div>;
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
            className="text-xs font-semibold text-teal-600 border border-teal-200 px-3 py-1.5 rounded-lg hover:bg-teal-50 transition">
            Manage Billing
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
        {PLANS.map(plan => (
          <div key={plan.billing} className="rounded-xl border-2 border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-bold text-slate-800">{plan.name}</div>
                <div className="text-xs text-slate-400">Everything included</div>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold text-slate-900">${plan.price}</span>
                <span className="text-xs text-slate-400">{plan.period}</span>
              </div>
            </div>
            {plan.foundingNote && (
              <div className="text-[11px] font-semibold text-emerald-600 mb-3">{plan.foundingNote}</div>
            )}
            {plan.savingsNote && (
              <div className="text-[11px] font-semibold text-emerald-600 mb-3">{plan.savingsNote}</div>
            )}
            <div className="grid grid-cols-2 gap-1.5 mb-4">
              {plan.features.map(f => (
                <div key={f} className="flex items-start gap-1.5 text-xs text-slate-600">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                  {f}
                </div>
              ))}
            </div>
            <button onClick={() => handleCheckout(plan.billing)} disabled={!!checkoutLoading}
              className="w-full text-xs font-bold py-2.5 rounded-lg transition disabled:opacity-50 text-white bg-teal-600 hover:bg-teal-700">
              {checkoutLoading === plan.billing ? "Loading..." : `Subscribe ${plan.name.toLowerCase()}`}
            </button>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-400 mt-3 max-w-2xl">
        Have a beta promo code? Enter it on the Stripe checkout page after clicking Subscribe.
      </p>
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
        const { data } = await base44.functions.invoke("emailScanner", {
          action: "checkGmailConnection",
          accessToken: session?.access_token,
        });
        if (data) {
          setConnected(data.connected);
          setLastScan(data.lastScan);
        }
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
      const { data, error: invErr } = await base44.functions.invoke("emailScanner", {
        action: "getGmailAuthUrl",
        accessToken: session?.access_token,
      });
      if (invErr) throw new Error(invErr.message || "Failed");
      if (data?.authUrl) window.location.href = data.authUrl;
    } catch (err) {
      notify.error("Gmail connect failed", err);
    } finally {
      setConnecting(false);
    }
  }

  async function scanNow() {
    setScanning(true);
    setResults(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const post = async (action) => {
        const { data, error: invErr } = await base44.functions.invoke("emailScanner", {
          action,
          accessToken: session?.access_token,
        });
        if (invErr) return { error: invErr.message || "request failed" };
        return data || {};
      };

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
      notify.error("Email scan failed", err);
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
            className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition disabled:opacity-50">
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
                      {r.from}: {r.subject} → <span className="font-semibold text-teal-600">{r.quoteId}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <button onClick={connectGmail} disabled={connecting}
          className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 text-sm font-semibold px-4 py-2.5 rounded-xl transition hover:border-teal-300 disabled:opacity-50">
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

// Per-stage production checklist editor. Each shop has its own list
// of tasks for Art Approval / Order Goods / Pre-Press / Printing.
// Empty maps fall back to DEFAULT_TASKS via getStageTasks(); shops can
// reset a stage to defaults by clearing all rows.
function ProductionTasksSection({ user }) {
  const [tasks, setTasks] = useState({});
  const [defaults, setDefaults] = useState({});
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Dynamic import keeps Account.jsx's top-level import list short
      // and avoids pulling productionTasks helpers into Auth-only callers
      // of pricing.jsx.
      const mod = await import("@/lib/productionTasks");
      if (!alive) return;
      setStages(mod.PRODUCTION_STAGES);
      setDefaults(mod.DEFAULT_TASKS);

      try {
        const shopOwner = shopScope(user);
        if (!shopOwner) return;
        const { data: shop } = await supabase
          .from("shops")
          .select("production_tasks")
          .eq("owner_email", shopOwner)
          .maybeSingle();
        const stored = shop?.production_tasks && typeof shop.production_tasks === "object"
          ? shop.production_tasks
          : {};
        // Seed every stage from defaults; overlay anything the shop
        // already customized so editing feels stable.
        const seeded = {};
        for (const stage of mod.PRODUCTION_STAGES) {
          const fromShop = Array.isArray(stored[stage]) ? stored[stage] : null;
          seeded[stage] = fromShop && fromShop.length > 0
            ? [...fromShop]
            : [...(mod.DEFAULT_TASKS[stage] || [])];
        }
        if (alive) setTasks(seeded);
      } catch {
        // Best-effort — if the shop row isn't reachable, just show defaults.
        if (alive) {
          const seeded = {};
          for (const stage of mod.PRODUCTION_STAGES) seeded[stage] = [...(mod.DEFAULT_TASKS[stage] || [])];
          setTasks(seeded);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [user?.email]);

  function updateTask(stage, idx, value) {
    setTasks(prev => {
      const next = { ...prev, [stage]: [...(prev[stage] || [])] };
      next[stage][idx] = value;
      return next;
    });
  }

  function removeTask(stage, idx) {
    setTasks(prev => ({
      ...prev,
      [stage]: (prev[stage] || []).filter((_, i) => i !== idx),
    }));
  }

  function addTask(stage) {
    setTasks(prev => ({
      ...prev,
      [stage]: [...(prev[stage] || []), ""],
    }));
  }

  function resetStage(stage) {
    setTasks(prev => ({ ...prev, [stage]: [...(defaults[stage] || [])] }));
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      // Trim each task; drop empties so the saved JSON stays tidy.
      const cleaned = {};
      for (const stage of stages) {
        const list = (tasks[stage] || []).map(t => String(t).trim()).filter(Boolean);
        if (list.length > 0) cleaned[stage] = list;
      }
      const { error } = await supabase
        .from("shops")
        .update({ production_tasks: cleaned })
        .eq("owner_email", shopScope(user));
      if (error) throw error;
      // Push into the module-level cache so live ShopFloor / OrderDetail
      // views pick up the change without a full reload.
      const mod = await import("@/lib/productionTasks");
      mod.loadShopProductionTasks(cleaned);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      notify.error("Couldn't save production tasks", err);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <InlineLinesSkeleton />;

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-500 leading-relaxed">
        Customize the checklist shown on Shop Floor + Order Detail for each production stage. Tasks render in the order shown. The Order Goods tasks "Place blank order" and "Receive goods" auto-check from per-size goods tracking — keep those exact names to preserve auto-derive.
      </p>

      {stages.map(stage => {
        // Warn explicitly when the shop has renamed/removed either of
        // the two Order Goods tasks that auto-check from per-size goods
        // tracking — without the warning, auto-derive silently stops
        // firing and operators have to check those tasks manually.
        const missingAutoTasks = getMissingAutoDerivedTasks(stage, tasks[stage]);
        return (
        <div key={stage} className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-slate-700 dark:text-slate-200">{stage}</div>
            <button
              type="button"
              onClick={() => resetStage(stage)}
              className="text-[10px] font-semibold text-slate-400 hover:text-teal-600 transition"
              title={`Reset ${stage} tasks to InkTracker defaults`}
            >
              Reset to defaults
            </button>
          </div>
          {missingAutoTasks.length > 0 && (
            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 leading-relaxed">
              <strong>Heads up:</strong> {missingAutoTasks.join(" and ")} {missingAutoTasks.length === 1 ? "is" : "are"} missing — auto-check from per-size goods tracking will stop firing for {missingAutoTasks.length === 1 ? "it" : "them"}. Add the exact name{missingAutoTasks.length === 1 ? "" : "s"} back or operators will need to check manually.
            </div>
          )}
          {(tasks[stage] || []).length === 0 ? (
            <div className="text-xs text-slate-400 italic">No tasks — this stage will fall back to defaults.</div>
          ) : (
            <div className="space-y-1.5">
              {(tasks[stage] || []).map((task, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={task}
                    onChange={e => updateTask(stage, idx, e.target.value)}
                    placeholder="Task description"
                    className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300"
                  />
                  <button
                    type="button"
                    onClick={() => removeTask(stage, idx)}
                    title="Remove task"
                    className="text-slate-300 hover:text-red-500 transition w-7 h-7 flex items-center justify-center"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => addTask(stage)}
            className="text-xs font-semibold text-teal-600 hover:text-teal-700 mt-1 transition"
          >
            + Add task
          </button>
        </div>
        );
      })}

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {saving ? "Saving…" : saved ? "Saved" : "Save Production Tasks"}
        </button>
        <button
          onClick={() => {
            if (window.confirm("Reset every stage to InkTracker's default task lists? Your customizations will be wiped. You'll still need to click Save to persist the reset.")) {
              const fresh = {};
              for (const stage of stages) fresh[stage] = [...(defaults[stage] || [])];
              setTasks(fresh);
            }
          }}
          className="text-xs text-slate-500 hover:text-slate-700 font-semibold"
        >
          Reset to Defaults
        </button>
        {saved && <span className="text-xs text-emerald-600 font-semibold">Saved</span>}
      </div>
    </div>
  );
}

// Shop-configured press list. Drives the "Assigned Press" dropdown
// Per-entity CSV + a single full-backup JSON. Pulls via base44.entities
// scoped to shop_owner so RLS already constrains the read; no edge
// function or service-role key involved. Browser-side CSV builder —
// good enough for the row counts a shop generates over its lifetime.
function ExportDataSection({ user }) {
  const [busy, setBusy] = useState(null);

  const ENTITIES = [
    { key: "customers", label: "Customers", entity: base44.entities.Customer },
    { key: "quotes",    label: "Quotes",    entity: base44.entities.Quote },
    { key: "orders",    label: "Orders",    entity: base44.entities.Order },
    { key: "invoices",  label: "Invoices",  entity: base44.entities.Invoice },
    { key: "inventory", label: "Inventory", entity: base44.entities.InventoryItem },
  ];

  function dateStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Fields that are bookkeeping/internal — they're noise in a CSV a shop
  // owner opens in Excel. The full JSON backup still includes them.
  const HIDE_FIELDS = new Set([
    "shop_owner", "auth_id", "user_id", "created_by", "updated_by",
    "_pc", "pricing_config", "raw_payload", "stripe_session_id",
    "stripe_payment_intent_id", "qb_sync_token", "qb_doc_number",
    "line_items_json", "metadata", "search_vector",
  ]);

  // Friendly column names. Anything not listed falls back to a Title Case
  // version of the snake_case key.
  const LABEL_OVERRIDES = {
    id: "ID",
    qb_customer_id: "QB Customer ID",
    qb_invoice_id: "QB Invoice ID",
    quote_status: "Status",
    order_status: "Status",
    invoice_status: "Status",
    customer_email: "Customer Email",
    customer_name: "Customer",
    customer_phone: "Phone",
    customer_company: "Company",
    customer_address: "Address",
    is_tax_exempt: "Tax Exempt",
    tax_rate: "Tax Rate",
    tax_amount: "Tax",
    subtotal: "Subtotal",
    total: "Total",
    balance: "Balance",
    paid_amount: "Paid",
    deposit_amount: "Deposit",
    setup_fee: "Setup Fee",
    line_items: "Line Items",
    created_date: "Created",
    updated_date: "Updated",
    paid_date: "Paid On",
    due_date: "Due",
    completion_date: "Completed",
    shipping_address: "Ship To",
  };

  // Preferred column order — anything matching shows up first in this
  // sequence; everything else follows alphabetical.
  const ORDER_PRIORITY = [
    "id", "created_date", "customer_name", "customer_email", "customer_company",
    "quote_status", "order_status", "invoice_status", "status",
    "subtotal", "tax_amount", "total", "balance", "paid_amount", "due_date",
    "qb_customer_id", "qb_invoice_id",
  ];

  function humanizeLabel(key) {
    if (LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key];
    return key
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function looksLikeIsoDate(s) {
    return typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s);
  }

  function formatCell(key, value) {
    if (value == null || value === "") return "";
    if (looksLikeIsoDate(value)) {
      // Local-time, no seconds — readable in a spreadsheet column.
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleString([], {
          year: "numeric", month: "short", day: "numeric",
          hour: "2-digit", minute: "2-digit",
        });
      }
    }
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (Array.isArray(value)) {
      // Line items + similar — turn into a readable summary like
      // "Black Tee × 24; Heather Tee × 12" instead of dumping JSON.
      const parts = value.map((item) => {
        if (item == null) return "";
        if (typeof item !== "object") return String(item);
        const name = item.name || item.title || item.style || item.description || "";
        const qty = item.quantity ?? item.qty;
        return qty != null && name ? `${name} × ${qty}` : (name || JSON.stringify(item));
      }).filter(Boolean);
      return parts.join("; ");
    }
    if (typeof value === "object") {
      // Flatten one level of object into "key: val, key: val" — readable
      // for things like address objects without dumping full JSON.
      const parts = Object.entries(value)
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
      return parts.join(", ");
    }
    return String(value);
  }

  function toCsv(rows) {
    if (!rows || rows.length === 0) return "";
    // Union of keys across rows, minus internal ones.
    const headerSet = new Set();
    for (const r of rows) {
      if (r && typeof r === "object") {
        for (const k of Object.keys(r)) {
          if (!HIDE_FIELDS.has(k)) headerSet.add(k);
        }
      }
    }
    // Stable order: priority list first, then alphabetical for the rest.
    const all = Array.from(headerSet);
    const priority = ORDER_PRIORITY.filter((k) => headerSet.has(k));
    const rest = all.filter((k) => !priority.includes(k)).sort();
    const keys = [...priority, ...rest];

    const escape = (v) => {
      if (v == null) return "";
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [keys.map(humanizeLabel).join(",")];
    for (const r of rows) lines.push(keys.map((k) => escape(formatCell(k, r?.[k]))).join(","));
    return lines.join("\n");
  }

  async function fetchAll(entity) {
    try {
      return await entity.filter({ shop_owner: shopScope(user) }, "-created_date", 100000);
    } catch (e) {
      console.error("[Export] fetch failed:", e);
      return [];
    }
  }

  async function exportCsv(item) {
    setBusy(item.key);
    try {
      const rows = await fetchAll(item.entity);
      downloadBlob(toCsv(rows), `inktracker-${item.key}-${dateStamp()}.csv`, "text/csv");
    } finally {
      setBusy(null);
    }
  }

  async function exportFullBackup() {
    setBusy("backup");
    try {
      const results = await Promise.all(
        ENTITIES.map((e) => fetchAll(e.entity).then((r) => [e.key, r]))
      );
      const data = Object.fromEntries(results);
      const payload = JSON.stringify(
        { exportedAt: new Date().toISOString(), shopOwner: shopScope(user), ...data },
        null,
        2,
      );
      downloadBlob(payload, `inktracker-backup-${dateStamp()}.json`, "application/json");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 leading-relaxed">
        Download your shop's data for backup or migration. CSVs are cleaned up for Excel/Sheets — friendly column names, formatted dates, line items as readable summaries. The full backup JSON is a raw dump of every entity for migration or restore. Large datasets may take a moment.
      </p>
      <div className="grid sm:grid-cols-2 gap-2">
        {ENTITIES.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => exportCsv(item)}
            disabled={busy !== null}
            className="flex items-center justify-between px-3 py-2 text-sm font-semibold rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <span className="flex items-center gap-2">
              <DownloadCloud className="w-4 h-4 text-teal-500" />
              {item.label} (CSV)
            </span>
            {busy === item.key && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={exportFullBackup}
        disabled={busy !== null}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-60 disabled:cursor-not-allowed transition"
      >
        {busy === "backup" ? <Loader2 className="w-4 h-4 animate-spin" /> : <DownloadCloud className="w-4 h-4" />}
        {busy === "backup" ? "Building backup…" : "Download Full Backup (JSON)"}
      </button>
    </div>
  );
}

// on the Order Detail modal. Free-text inputs were too easy to typo
// (Auto 1 vs auto-1 vs Press A) and gave no canonical list to filter
// reports by.
function PressesSection({ user }) {
  // Stored as v2 objects: { name, colors }. Legacy string entries are
  // promoted on load via normalizePresses. See lib/presses/normalizePresses.
  const [presses, setPresses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!user?.email) return;
        const { data: shop } = await supabase
          .from("shops")
          .select("presses")
          .eq("owner_email", shopScope(user))
          .maybeSingle();
        if (alive) setPresses(normalizePresses(shop?.presses));
      } catch {
        if (alive) setPresses([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [user?.email]);

  function updatePressName(idx, name) {
    setPresses(prev => prev.map((p, i) => (i === idx ? { ...p, name } : p)));
  }

  function updatePressColors(idx, value) {
    // Allow blank for "unknown". Coerce numeric strings; reject negative / non-finite.
    const n = value === "" ? null : Number(value);
    const colors = Number.isFinite(n) && n > 0 ? n : null;
    setPresses(prev => prev.map((p, i) => (i === idx ? { ...p, colors } : p)));
  }

  function removePress(idx) {
    setPresses(prev => prev.filter((_, i) => i !== idx));
  }

  function addPress() {
    setPresses(prev => [...prev, { name: "", colors: null }]);
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const cleaned = serializePresses(presses);
      const { error } = await supabase
        .from("shops")
        .update({ presses: cleaned })
        .eq("owner_email", shopScope(user));
      if (error) throw error;
      setPresses(cleaned);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      notify.error("Couldn't save presses", err);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <InlineLinesSkeleton />;

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 leading-relaxed">
        List the presses your shop runs jobs on (e.g. "Auto 1 — 8 colors", "Manual A — 6 colors"). They'll appear as picker options under <span className="font-semibold">Assigned Press</span> on each order, and the color count is shown on the Press Schedule lane so dispatchers know which press can run a given job's color count. Operators come from your Admin Panel invites.
      </p>

      <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-2">
        {presses.length === 0 ? (
          <div className="text-xs text-slate-400 italic">No presses yet — add one below.</div>
        ) : (
          <div className="space-y-1.5">
            {presses.map((press, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={press.name}
                  onChange={e => updatePressName(idx, e.target.value)}
                  placeholder="Press name (e.g. Auto 1)"
                  className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={press.colors ?? ""}
                    onChange={e => updatePressColors(idx, e.target.value)}
                    placeholder="—"
                    title="Number of color stations (heads). Leave blank if unknown."
                    className="w-16 text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300 text-center"
                  />
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider">colors</span>
                </div>
                <button
                  type="button"
                  onClick={() => removePress(idx)}
                  title="Remove press"
                  className="text-slate-300 hover:text-red-500 transition w-7 h-7 flex items-center justify-center"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={addPress}
          className="text-xs font-semibold text-teal-600 hover:text-teal-700 mt-1 transition"
        >
          + Add press
        </button>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {saving ? "Saving…" : saved ? "Saved" : "Save Presses"}
        </button>
        {saved && <span className="text-xs text-emerald-600 font-semibold">Saved</span>}
      </div>
    </div>
  );
}

function SupplierKeysSection({ user }) {
  // Supplier secrets (ss_*, ac_*) live on profile_secrets now — the
  // service-role-only RLS-locked table. The frontend can't read them
  // back directly; we fetch boolean flags + the non-secret ac_email
  // via the profileSecrets edge function instead. Once flags load,
  // the "Connected" badges + editing state derive from them.
  const [ssHasKey, setSsHasKey] = useState(false);
  const [acHasKey, setAcHasKey] = useState(false);
  const [acEmailFromServer, setAcEmailFromServer] = useState("");
  const [ssAccount, setSsAccount] = useState("");
  const [ssKey, setSsKey] = useState("");
  const [acSubKey, setAcSubKey] = useState("");
  const [acEmail, setAcEmail] = useState("");
  const [acPassword, setAcPassword] = useState("");
  const [ssEditing, setSsEditing] = useState(true);
  const [acEditing, setAcEditing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load connection flags on mount. Until they load, we render in "no
  // connection" mode so the user doesn't briefly see stale state.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const { data, error } = await base44.functions.invoke("profileSecrets", {
          action: "getFlags",
          accessToken: session.access_token,
        });
        if (!alive || error || !data) return;
        setSsHasKey(!!data.ss);
        setAcHasKey(!!data.ac);
        setAcEmailFromServer(data.ac_email || "");
        setSsEditing(!data.ss);
        setAcEditing(!data.ac);
        if (data.ac_email) setAcEmail(data.ac_email);
      } catch {
        // Stay in "no connection" mode — the user can still re-enter creds.
      }
    })();
    return () => { alive = false; };
  }, []);

  // Free-freight thresholds — drives the progress bar on Purchase Orders.
  // Per supplier so each can have its own minimum (AS Colour vs S&S vs others).
  const initialThresholds = user?.free_freight_thresholds || {};
  const [acThreshold, setAcThreshold] = useState(initialThresholds["AS Colour"] ?? "");
  const [ssThreshold, setSsThreshold] = useState(initialThresholds["S&S Activewear"] ?? "");
  // Default AS Colour warehouse for auto-routing on the PO page. When
  // a SKU is in stock at this warehouse, items ship from here;
  // otherwise they auto-route to the other US warehouse.
  const [defaultAcWarehouse, setDefaultAcWarehouse] = useState(user?.default_ac_warehouse || "CA");

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      // Secret credentials (ss_*, ac_*) go through the profileSecrets edge
      // function — they live on the service-role-only profile_secrets table.
      // Non-secret prefs (thresholds, warehouse) still go through updateMe
      // which writes to profiles.
      //
      // Only send fields the user actually typed into. An empty input is
      // NOT a "clear" signal — that's a footgun (walking away from the
      // form would otherwise null saved keys). Use Disconnect to clear.
      const supplierSecrets = {};
      if (ssEditing) {
        const acct = ssAccount.trim();
        const key = ssKey.trim();
        // S&S account numbers are numeric only. Browsers will sometimes
        // autofill the user's email into the Account # input because it
        // sits next to a password field — without this guard that string
        // would silently overwrite a working set of credentials on save.
        if (acct && !/^\d+$/.test(acct)) {
          notify.error("S&S Account Number must be digits only. Saved credentials were not touched.");
          setSaving(false);
          return;
        }
        if (acct) supplierSecrets.ss_account_number = acct;
        if (key) supplierSecrets.ss_api_key = key;
      }
      if (acEditing) {
        const email = acEmail.trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          notify.error("AS Colour email looks invalid. Saved credentials were not touched.");
          setSaving(false);
          return;
        }
        if (acSubKey.trim()) supplierSecrets.ac_subscription_key = acSubKey.trim();
        if (email) supplierSecrets.ac_email = email;
        if (acPassword.trim() && acPassword !== "********") {
          supplierSecrets.ac_password = acPassword.trim();
        }
      }

      const profileUpdates = {};
      const thresholds = { ...initialThresholds };
      const acT = Number(acThreshold);
      const ssT = Number(ssThreshold);
      if (acThreshold === "" || acT === 0) delete thresholds["AS Colour"];
      else if (acT > 0) thresholds["AS Colour"] = acT;
      if (ssThreshold === "" || ssT === 0) delete thresholds["S&S Activewear"];
      else if (ssT > 0) thresholds["S&S Activewear"] = ssT;
      profileUpdates.free_freight_thresholds = thresholds;
      profileUpdates.default_ac_warehouse = defaultAcWarehouse || "CA";

      if (Object.keys(supplierSecrets).length > 0) {
        const { data: { session } } = await supabase.auth.getSession();
        const { error: invErr, data } = await base44.functions.invoke("profileSecrets", {
          action: "update",
          updates: supplierSecrets,
          accessToken: session?.access_token,
        });
        if (invErr) throw invErr;
        if (data?.error) throw new Error(data.error);
        // Refresh flags so badges update without a full page reload.
        if (supplierSecrets.ss_account_number || supplierSecrets.ss_api_key) {
          setSsHasKey(true);
          setSsEditing(false);
        }
        if (supplierSecrets.ac_subscription_key) {
          setAcHasKey(true);
          setAcEditing(false);
        }
        if (supplierSecrets.ac_email) setAcEmailFromServer(supplierSecrets.ac_email);
      }

      await base44.auth.updateMe(profileUpdates);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      notify.error("Couldn't save supplier credentials", err);
    } finally {
      setSaving(false);
    }
  }

  // Explicit disconnect — only way to actually null the credentials.
  // Save never wipes; users have to opt in here. Goes through the
  // profileSecrets edge function since the secrets live on the
  // service-role-only profile_secrets table.
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
      const { data: { session } } = await supabase.auth.getSession();
      const { error: invErr, data } = await base44.functions.invoke("profileSecrets", {
        action: "disconnectProvider",
        provider: supplier,
        accessToken: session?.access_token,
      });
      if (invErr) throw invErr;
      if (data?.error) throw new Error(data.error);
      if (supplier === "ac") {
        setAcSubKey(""); setAcEmail(""); setAcPassword("");
        setAcHasKey(false); setAcEditing(true); setAcEmailFromServer("");
      } else {
        setSsAccount(""); setSsKey("");
        setSsHasKey(false); setSsEditing(true);
      }
    } catch (err) {
      notify.error("Disconnect failed", err);
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300";

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
                className="text-xs font-semibold text-teal-600 hover:text-teal-700">Edit</button>
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
          <div className="text-xs text-slate-500">
            Credentials saved. Click <span className="font-semibold">Edit</span> to replace.
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
                className="text-xs font-semibold text-teal-600 hover:text-teal-700">Edit</button>
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
            <div>Credentials saved. Click <span className="font-semibold">Edit</span> to replace.</div>
            {acEmailFromServer && <div>Email: {acEmailFromServer}</div>}
          </div>
        ) : (
          <p className="text-xs text-slate-400">No AS Colour credentials configured. Enter your account details to connect.</p>
        )}

        <div className="mt-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5 text-[11px] text-amber-800 leading-relaxed">
          <strong className="block mb-1 text-amber-900">Want to place orders too?</strong>
          The API key above lets you browse the catalog and check live inventory immediately.
          To actually <strong>submit orders</strong> through InkTracker, AS Colour requires approved <strong>credit terms</strong> (their only API payment option).
          <br /><br />
          <strong>How to apply:</strong> email <a href="mailto:support@ascolour.com" className="font-mono underline">support@ascolour.com</a> requesting the credit application. They'll send a PDF; complete and return it. Approval takes <strong>2-4 weeks</strong> (they contact your credit references, then submit to their CFO — speeding up the references step yourself can help).
          <br /><br />
          Without credit terms, orders submit but land in <strong>"awaiting payment"</strong> in AS Colour's system until you arrange payment directly with them.
        </div>
      </div>

      {/* SanMar — not currently supported */}
      <div className="border border-slate-200 bg-slate-50/50 rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-500">SanMar</span>
            <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">Not available</span>
          </div>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          SanMar's API requires per-shop integration approval and static-IP whitelisting that doesn't fit our current infrastructure. Add SanMar items by hand for now — we may revisit a partner-route integration in a future release.
        </p>
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

      {/* Default AS Colour warehouse */}
      <div className="border border-slate-200 rounded-xl p-4 space-y-3">
        <div>
          <div className="text-sm font-bold text-slate-700">Default AS Colour warehouse</div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Items on a PO ship from here when in stock. If the SKU is out of stock at your default,
            it auto-routes to the other US warehouse silently — no per-PO decision needed.
          </p>
        </div>
        <div>
          <select
            value={defaultAcWarehouse}
            onChange={e => setDefaultAcWarehouse(e.target.value)}
            className={inputCls}
          >
            <option value="CA">CA — Carson (West Coast)</option>
            <option value="NC">NC — Charlotte (East Coast)</option>
          </select>
        </div>
      </div>

      <button onClick={handleSave} disabled={saving}
        className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition disabled:opacity-50">
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
    // Per-screen setup fee billing. Off by default. Shops define their
    // own named fees (Screens, Film, Color Match, etc.) each with a
    // per-screen rate plus a cheaper reorder rate (used when "Reorder"
    // is checked on the quote — screens already exist from the first run).
    setupFees: {
      enabled: false,
      items: [
        { id: "screens", label: "Screens", rate: 25, reorderRate: 5 },
        { id: "film",    label: "Film",    rate: 10, reorderRate: 0 },
      ],
    },
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
      extraLabels: { puffEmbroidery: "Puff / 3D Embroidery", metallicThread: "Metallic Thread", applique: "Applique" },
      extraModes: { puffEmbroidery: "flat", metallicThread: "flat", applique: "flat" },
    },
  };

  useEffect(() => {
    async function load() {
      try {
        const shops = await base44.entities.Shop.filter({ owner_email: shopScope(user) });
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
    // Validation gate. Decision + message format pinned by
    // decidePricingSave tests DS1–DS8 (lib/pricing/__tests__/
    // inputValidation.test.js). DS7 in particular locks the
    // user-facing alert wording so a copy refactor doesn't slip
    // past CI.
    const decision = decidePricingSave(config);
    if (!decision.canSave) {
      notify.error("Can't save pricing", decision.alertMessage);
      return;
    }

    setSaving(true);
    try {
      const shops = await base44.entities.Shop.filter({ owner_email: shopScope(user) });
      if (shops?.[0]) {
        await base44.entities.Shop.update(shops[0].id, { pricing_config: config });
      }
      // Refresh the engine's module-level _pc so the change is live
      // without a full reload. Without this, the shop owner saves a
      // toggle, hops to Quotes, and sees stale pricing math until they
      // hard-refresh.
      loadShopPricingConfig(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      notify.error("Couldn't save pricing", err);
    }
    setSaving(false);
  }

  // Helpers below receive already-parsed numbers from NumericInput
  // (or pre-arithmetic-transformed numbers from a few remaining
  // callers). Don't re-coerce — that's how the silent-zero bug crept
  // in originally. Save-gate (decidePricingSave) catches anything
  // that slips through.
  function updatePrintTable(table, colors, tier, value, scope) {
    setConfig(prev => {
      const slice = scope ? (prev.custom_techniques?.[scope] || {}) : prev;
      const next = {
        [table]: {
          ...(slice[table] || {}),
          [colors]: { ...((slice[table] || {})[colors] || {}), [tier]: value },
        },
      };
      if (!scope) return { ...prev, ...next };
      return {
        ...prev,
        custom_techniques: {
          ...(prev.custom_techniques || {}),
          [scope]: { ...slice, ...next },
        },
      };
    });
  }

  function updateMarkup(idx, field, value) {
    setConfig(prev => {
      const m = [...prev.garmentMarkup];
      m[idx] = { ...m[idx], [field]: value };
      return { ...prev, garmentMarkup: m };
    });
  }

  // ── Scope-aware accessors ─────────────────────────────────────────
  // `scope` is undefined for the built-in Screen Print tab (handlers
  // operate on top-level config fields) or a custom-technique name
  // for the "+ Add Method" tabs (handlers operate on
  // config.custom_techniques[scope]). Same rendering + handler code
  // serves both — that's how Screen Print and DTG end up looking
  // structurally identical instead of feeling like two different
  // tools bolted together.
  function getSlice(cfg, scope) {
    if (!scope) return cfg || {};
    if (scope === "embroidery") return cfg?.embroidery || {};
    return cfg?.custom_techniques?.[scope] || {};
  }
  function setSlice(prev, scope, patch) {
    if (!scope) return { ...prev, ...patch };
    if (scope === "embroidery") {
      return { ...prev, embroidery: { ...(prev.embroidery || {}), ...patch } };
    }
    return {
      ...prev,
      custom_techniques: {
        ...(prev.custom_techniques || {}),
        [scope]: { ...(prev.custom_techniques?.[scope] || {}), ...patch },
      },
    };
  }

  function updateExtra(key, value, scope) {
    setConfig(prev => {
      const slice = getSlice(prev, scope);
      return setSlice(prev, scope, {
        extras: { ...(slice.extras || {}), [key]: value },
      });
    });
  }

  function setExtraMode(key, mode, scope) {
    setConfig(prev => {
      const slice = getSlice(prev, scope);
      return setSlice(prev, scope, {
        extraModes: { ...(slice.extraModes || {}), [key]: mode },
      });
    });
  }

  function addExtra(scope) {
    const id = `custom_${Date.now()}`;
    setConfig(prev => {
      const slice = getSlice(prev, scope);
      return setSlice(prev, scope, {
        extras:      { ...(slice.extras || {}),      [id]: 0 },
        extraLabels: { ...(slice.extraLabels || {}), [id]: "New Fee" },
        extraModes:  { ...(slice.extraModes || {}),  [id]: "flat" },
      });
    });
  }

  function removeExtra(key, scope) {
    setConfig(prev => {
      const slice = getSlice(prev, scope);
      const next = {
        extras:      { ...(slice.extras || {}) },
        extraLabels: { ...(slice.extraLabels || {}) },
        extraModes:  { ...(slice.extraModes || {}) },
      };
      delete next.extras[key];
      delete next.extraLabels[key];
      delete next.extraModes[key];
      return setSlice(prev, scope, next);
    });
  }

  function updateExtraLabel(key, label, scope) {
    setConfig(prev => {
      const slice = getSlice(prev, scope);
      return setSlice(prev, scope, {
        extraLabels: { ...(slice.extraLabels || {}), [key]: label },
      });
    });
  }

  // Single editor for any technique's extras. Same row layout
  // (label | $/% toggle | value | × remove) and + Add fee button
  // everywhere — Screen Print, Embroidery, and any custom method.
  // The scope-aware handlers above route writes to the right slice.
  function renderExtrasEditor(scope, opts = {}) {
    const slice = getSlice(config, scope);
    const extras = slice.extras || {};
    const extraLabels = slice.extraLabels || {};
    const extraModes = slice.extraModes || {};
    const title = opts.title ?? "Extra Fees (per piece)";
    const description = opts.description ?? "Rename, reprice, or remove fees. Toggle the $ / % button to charge a flat dollar amount per piece OR a percentage of the line's per-piece decoration cost.";
    return (
      <div>
        <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-2">{title}</h4>
        <p className="text-[10px] text-slate-400 mb-2">{description}</p>
        <div className="space-y-2">
          {Object.entries(extras).map(([key, val]) => {
            const mode = extraModes[key] === "percent" ? "percent" : "flat";
            const isPercent = mode === "percent";
            return (
              <div key={key} className="flex items-center gap-2">
                <input
                  type="text"
                  value={extraLabels[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase()).trim()}
                  onChange={e => updateExtraLabel(key, e.target.value, scope)}
                  className="flex-1 text-xs border border-slate-200 rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300"
                />
                <div className="flex shrink-0 border border-slate-200 rounded overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExtraMode(key, "flat", scope)}
                    className={`text-xs font-semibold w-7 py-1.5 transition ${!isPercent ? "bg-teal-600 text-white" : "bg-white text-slate-400 hover:bg-slate-50"}`}
                    title="Flat dollar amount per piece"
                  >$</button>
                  <button
                    type="button"
                    onClick={() => setExtraMode(key, "percent", scope)}
                    className={`text-xs font-semibold w-7 py-1.5 transition border-l border-slate-200 ${isPercent ? "bg-teal-600 text-white" : "bg-white text-slate-400 hover:bg-slate-50"}`}
                    title="Percent of the line's per-piece decoration cost"
                  >%</button>
                </div>
                <div className="relative w-24 shrink-0">
                  {!isPercent && <span className="absolute left-2 top-1.5 text-xs text-slate-400">$</span>}
                  <NumericInput
                    value={val}
                    onChange={(n) => updateExtra(key, n, scope)}
                    min={0}
                    max={isPercent ? 100 : 10000}
                    label={`Extras → ${key}`}
                    className={`w-full text-xs border border-slate-200 rounded py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300 ${isPercent ? "pl-2 pr-6" : "pl-5 pr-2"}`}
                  />
                  {isPercent && <span className="absolute right-2 top-1.5 text-xs text-slate-400">%</span>}
                </div>
                <button
                  onClick={() => removeExtra(key, scope)}
                  className="text-slate-300 hover:text-red-500 transition text-sm px-1"
                  title="Remove"
                >&times;</button>
              </div>
            );
          })}
        </div>
        <button
          onClick={() => addExtra(scope)}
          className="text-xs font-semibold text-teal-600 hover:text-teal-700 mt-2 transition"
        >
          + Add fee
        </button>
      </div>
    );
  }

  function addTier(scope) {
    setConfig(prev => {
      const slice = getSlice(prev, scope);
      const tiers = slice.tiers || prev.tiers || DEFAULT_TIERS;
      const last = tiers[tiers.length - 1] || 100;
      const newTier = last * 2;
      const newTiers = [...tiers, newTier].sort((a, b) => a - b);
      const fp = { ...(slice.firstPrint || {}) };
      const ap = { ...(slice.addlPrint  || {}) };
      for (const c of Object.keys(fp)) { fp[c] = { ...fp[c], [newTier]: 0 }; }
      for (const c of Object.keys(ap)) { ap[c] = { ...ap[c], [newTier]: 0 }; }
      return setSlice(prev, scope, { tiers: newTiers, firstPrint: fp, addlPrint: ap });
    });
  }

  function removeTier(tier, scope) {
    setConfig(prev => {
      const slice = getSlice(prev, scope);
      const tiers = (slice.tiers || prev.tiers || DEFAULT_TIERS).filter(t => t !== tier);
      if (tiers.length < 1) return prev;
      const stripColumn = (table) => {
        const out = {};
        for (const c of Object.keys(table || {})) {
          const { [tier]: _drop, ...rest } = table[c] || {};
          out[c] = rest;
        }
        return out;
      };
      return setSlice(prev, scope, {
        tiers,
        firstPrint: stripColumn(slice.firstPrint),
        addlPrint:  stripColumn(slice.addlPrint),
      });
    });
  }

  function updateTierValue(oldTier, newValue, scope) {
    const val = parseInt(newValue) || 0;
    if (val <= 0) return;
    setConfig(prev => {
      const slice = getSlice(prev, scope);
      const tiers = (slice.tiers || prev.tiers || DEFAULT_TIERS)
        .map(t => t === oldTier ? val : t)
        .sort((a, b) => a - b);
      const rename = (table) => {
        const out = {};
        for (const c of Object.keys(table || {})) {
          out[c] = {};
          for (const t of Object.keys(table[c])) {
            const k = parseInt(t) === oldTier ? val : parseInt(t);
            out[c][k] = table[c][t];
          }
        }
        return out;
      };
      return setSlice(prev, scope, {
        tiers,
        firstPrint: rename(slice.firstPrint),
        addlPrint:  rename(slice.addlPrint),
      });
    });
  }

  function addColorRow(scope) {
    setConfig(prev => {
      const slice = getSlice(prev, scope);
      const maxC = slice.maxColors || prev.maxColors || DEFAULT_COLORS;
      const newC = maxC + 1;
      const tiers = slice.tiers || prev.tiers || DEFAULT_TIERS;
      const emptyRow = {};
      tiers.forEach(t => { emptyRow[t] = 0; });
      return setSlice(prev, scope, {
        maxColors:  newC,
        firstPrint: { ...(slice.firstPrint || {}), [newC]: { ...emptyRow } },
        addlPrint:  { ...(slice.addlPrint  || {}), [newC]: { ...emptyRow } },
      });
    });
  }

  function removeColorRow(scope) {
    setConfig(prev => {
      const slice = getSlice(prev, scope);
      const maxC = slice.maxColors || prev.maxColors || DEFAULT_COLORS;
      if (maxC <= 1) return prev;
      const fp = { ...(slice.firstPrint || {}) }; delete fp[maxC];
      const ap = { ...(slice.addlPrint  || {}) }; delete ap[maxC];
      return setSlice(prev, scope, { maxColors: maxC - 1, firstPrint: fp, addlPrint: ap });
    });
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
    // Symmetric cleanup with addEmbTier: drop the orphan column from
    // each stitch-tier's pricing object. Without this, removing a tier
    // leaves {[tier]: 0} keys lingering in pricing_config and they
    // accumulate every time a shop adjusts their tiers.
    const pricing = {};
    for (const st of Object.keys(config.embroidery?.pricing || {})) {
      const { [tier]: _drop, ...rest } = config.embroidery.pricing[st] || {};
      pricing[st] = rest;
    }
    setConfig(prev => ({
      ...prev,
      embroidery: { ...prev.embroidery, qtyTiers: et, pricing },
    }));
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
          [stitchTier]: { ...prev.embroidery.pricing[stitchTier], [qtyTier]: value },
        },
      },
    }));
  }


  if (loading || !config) return <div className="text-sm text-slate-400 py-4">Loading pricing config...</div>;

  const tiers = config.tiers || DEFAULT_TIERS;
  const maxColors = config.maxColors || DEFAULT_COLORS;
  const colorRows = Array.from({ length: maxColors }, (_, i) => i + 1);
  const emb = config.embroidery || DEFAULTS.embroidery;
  const inputCls = "w-full text-xs text-center border border-slate-200 rounded px-1 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300";

  // Same renderer for Screen Print (scope undefined) and any custom
  // technique (scope = tech name). Pulls tiers/maxColors/table data
  // from the scope's slice via getSlice, dispatches handlers with
  // the same scope. That's how DTG / DTF / etc. end up with the
  // identical UI as Screen Print instead of feeling like a
  // separate, lesser editor.
  function renderPrintTable(tableKey, title, scope) {
    const cfg = scope ? (config.custom_techniques?.[scope] || {}) : config;
    const t_iers = (Array.isArray(cfg.tiers) && cfg.tiers.length > 0)
      ? cfg.tiers
      : (config.tiers || DEFAULT_TIERS);
    const maxC = cfg.maxColors || (scope ? (config.maxColors || DEFAULT_COLORS) : (config.maxColors || DEFAULT_COLORS));
    const c_rows = Array.from({ length: maxC }, (_, i) => i + 1);
    const table = cfg[tableKey] || {};
    return (
      <div>
        <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-2">{title}</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400">
                <th className="text-left py-1 pr-2">Colors</th>
                {t_iers.map(t => (
                  <th key={t} className="text-center py-1">
                    <div className="inline-flex items-center gap-1">
                      <input type="number" value={t}
                        onChange={e => updateTierValue(t, e.target.value, scope)}
                        className="w-14 text-xs text-center border border-transparent hover:border-slate-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-teal-300 bg-transparent text-slate-400 font-semibold" />
                      <span className="text-slate-300">+</span>
                      {/* Remove this tier column. Hidden when there's
                          only one tier left (can't remove the last). */}
                      {t_iers.length > 1 && (
                        <button
                          onClick={() => removeTier(t, scope)}
                          className="text-slate-300 hover:text-red-500 text-xs ml-0.5"
                          title={`Remove ${t}+ tier`}
                        >×</button>
                      )}
                    </div>
                  </th>
                ))}
                <th className="py-1 px-1">
                  <button onClick={() => addTier(scope)} className="text-teal-500 hover:text-teal-700 text-xs font-bold" title="Add tier">+</button>
                </th>
              </tr>
            </thead>
            <tbody>
              {c_rows.map(c => (
                <tr key={c}>
                  <td className="py-1 pr-2 font-semibold text-slate-600 whitespace-nowrap">{c} color{c > 1 ? "s" : ""}</td>
                  {t_iers.map(t => (
                    <td key={t} className="py-1 px-0.5">
                      <NumericInput
                        value={table[c]?.[t]}
                        onChange={(n) => updatePrintTable(tableKey, c, t, n, scope)}
                        min={0}
                        max={10000}
                        label={`${scope || "Screen Print"} ${tableKey === "firstPrint" ? "first" : "additional"} ${c} color × ${t} pcs`}
                        className={inputCls}
                      />
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
                <NumericInput
                  value={Math.round((tier.markup - 1) * 100)}
                  onChange={(pct) => updateMarkup(i, "markup", pct / 100 + 1)}
                  min={0}
                  max={1000}
                  integer
                  label={`Markup tier ${i + 1} %`}
                  className={inputCls}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Broker Markup Share */}
      <div>
        <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-2">Broker Markup Share</h4>
        <p className="text-[10px] text-slate-400 mb-2">Discount off your garment markup that brokers receive on every quote. Higher = lower wholesale price for brokers (they earn margin by reselling above it).</p>
        <div className="flex items-center gap-3">
          <div className="relative w-28">
            <NumericInput
              value={Math.round((config.brokerMarkupShare ?? 0.2) * 100)}
              onChange={(pct) => setConfig(prev => ({ ...prev, brokerMarkupShare: pct / 100 }))}
              min={0}
              max={100}
              integer
              label="Broker markup share %"
              className={inputCls}
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">%</span>
          </div>
          <span className="text-xs text-slate-400">off garment markup for brokers</span>
        </div>
      </div>

      {/* Standard turnaround — shop-wide, lives above the decoration
          tabs because the default due date and rush surcharge are not
          decoration-specific. */}
      <div>
        <label className="text-[10px] text-slate-400 block mb-1">Standard Turnaround</label>
        <div className="relative w-40">
          <NumericInput
            value={config.standardTurnaroundDays ?? 10}
            onChange={(n) => setConfig(prev => ({ ...prev, standardTurnaroundDays: Math.max(1, Math.round(Number(n) || 1)) }))}
            min={1}
            max={365}
            integer
            label="Standard turnaround days"
            className="w-full text-xs border border-slate-200 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300"
          />
          <span className="absolute right-2 top-1.5 text-[10px] text-slate-400">days</span>
        </div>
        <p className="text-[10px] text-slate-400 mt-1">Default due-date offset on new quotes. Anything sooner than this triggers the rush rate below.</p>
      </div>

      {/* Variable Rush Surcharge — shop-wide tier list. */}
      <div>
        <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-1">Rush Surcharge Tiers</h4>
        <p className="text-[10px] text-slate-400 mb-2">
          Variable rush rate based on how soon the order is due. Add a tier per "cliff": e.g. less than 3 days = +50%, less than 6 days = +25%. The tightest matching tier wins.
          {" "}Tier days can't be longer than Standard Turnaround above — rush is faster than standard, by definition.
        </p>
        <div className="border border-slate-200 rounded-xl p-3 space-y-2">
          <div className="grid grid-cols-[1fr_120px_120px_32px] gap-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-1">
            <div>If due in less than</div>
            <div>Surcharge</div>
            <div />
            <div />
          </div>
          {(() => {
            const tiers = Array.isArray(config.rushTiers) ? [...config.rushTiers] : [];
            const sorted = tiers
              .map((t, i) => ({ ...t, _origIdx: i }))
              .sort((a, b) => (Number(a.maxDays) || 0) - (Number(b.maxDays) || 0));
            if (sorted.length === 0) {
              return (
                <div className="text-xs text-slate-400 italic px-1 py-1">No rush tiers — your shop won't charge any rush surcharge until you add at least one.</div>
              );
            }
            return sorted.map((tier, idx) => (
              <div key={tier._origIdx} className="grid grid-cols-[1fr_120px_120px_32px] gap-2 items-center">
                <div className="relative">
                  <NumericInput
                    value={tier.maxDays ?? ""}
                    onChange={(n) => setConfig(prev => {
                      const next = [...(prev.rushTiers || [])];
                      next[tier._origIdx] = {
                        ...next[tier._origIdx],
                        maxDays: clampRushTierMaxDays(n, prev.standardTurnaroundDays),
                      };
                      return { ...prev, rushTiers: next };
                    })}
                    min={1}
                    max={Math.max(1, Math.round(Number(config.standardTurnaroundDays || 10)))}
                    integer
                    label={`Rush tier ${idx + 1} max days`}
                    className="w-full text-xs border border-slate-200 rounded pl-3 pr-12 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300"
                  />
                  <span className="absolute right-2 top-1.5 text-[10px] text-slate-400">days</span>
                </div>
                <div className="relative">
                  <NumericInput
                    value={Math.round((Number(tier.rate) || 0) * 100)}
                    onChange={(pct) => setConfig(prev => {
                      const next = [...(prev.rushTiers || [])];
                      next[tier._origIdx] = { ...next[tier._origIdx], rate: Math.max(0, Math.min(100, Number(pct) || 0)) / 100 };
                      return { ...prev, rushTiers: next };
                    })}
                    min={0}
                    max={500}
                    integer
                    label={`Rush tier ${idx + 1} rate %`}
                    className="w-full text-xs border border-slate-200 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300"
                  />
                  <span className="absolute right-2 top-1.5 text-xs text-slate-400">%</span>
                </div>
                <div />
                <button
                  onClick={() => setConfig(prev => ({
                    ...prev,
                    rushTiers: (prev.rushTiers || []).filter((_, i) => i !== tier._origIdx),
                  }))}
                  className="text-slate-300 hover:text-red-500 transition text-sm"
                  title="Remove tier"
                >&times;</button>
              </div>
            ));
          })()}
          <button
            type="button"
            onClick={() => {
              const defaultDays = defaultNewRushTierMaxDays(
                config.rushTiers,
                config.standardTurnaroundDays,
              );
              setConfig(prev => ({
                ...prev,
                rushTiers: [...(prev.rushTiers || []), { maxDays: defaultDays, rate: 0.25 }],
              }));
            }}
            className="text-xs font-semibold text-teal-600 hover:text-teal-700 mt-1 transition"
          >
            + Add tier
          </button>
        </div>
      </div>

      {/* Decoration type tabs */}
      {/* First-Location Ordering — global setting, applies to every
          non-embroidery decoration method. Lives above the tabs so
          it's clear it isn't a per-technique knob. */}
      <div>
        <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-2">First-Location Ordering</h4>
        <p className="text-[10px] text-slate-400 mb-2">
          When a job has multiple imprint locations with different color counts, which one absorbs the "first" rate (where you&apos;ve baked in setup)? Applies to all decoration methods.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { value: "fewest", label: "Fewest colors first", hint: "Simpler imprint carries setup. Lower bill on mixed jobs." },
            { value: "most", label: "Most colors first", hint: "Complex imprint carries setup. Matches typical industry convention." },
          ].map(opt => {
            const current = config.firstPrintOrdering || "fewest";
            const selected = current === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setConfig(prev => ({ ...prev, firstPrintOrdering: opt.value }))}
                className={`text-left border rounded-lg p-3 transition ${
                  selected
                    ? "border-teal-500 bg-teal-50 ring-1 ring-teal-300"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <span className={`inline-block w-3 h-3 rounded-full border ${selected ? "bg-teal-500 border-teal-500" : "border-slate-300"}`} />
                  {opt.label}
                </div>
                <p className="text-[10px] text-slate-500 mt-1 ml-4">{opt.hint}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200 pb-0 flex-wrap">
        <button onClick={() => setPricingTab("screen_print")}
          className={`text-xs font-semibold px-4 py-2 rounded-t-lg transition ${pricingTab === "screen_print" ? "bg-teal-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
          Screen Print
        </button>
        <button onClick={() => { setPricingTab("embroidery"); if (!emb.enabled) setConfig(prev => ({ ...prev, embroidery: { ...prev.embroidery, enabled: true } })); }}
          className={`text-xs font-semibold px-4 py-2 rounded-t-lg transition ${pricingTab === "embroidery" ? "bg-teal-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
          Embroidery {emb.enabled && <span className="ml-1 text-emerald-400">*</span>}
        </button>
        {/* Custom techniques (DTG, DTF, Heat Transfer, Sublimation,
            anything the shop has named). Inserted between Embroidery
            and the + Add button so the order matches the technique
            dropdown the line-item editor sees. */}
        {Object.keys(config.custom_techniques || {}).map((name) => (
          <button
            key={name}
            onClick={() => setPricingTab(`custom:${name}`)}
            className={`text-xs font-semibold px-4 py-2 rounded-t-lg transition ${pricingTab === `custom:${name}` ? "bg-teal-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
          >
            {name}
          </button>
        ))}
        <button
          onClick={() => {
            const name = (window.prompt("New decoration method name (e.g. DTG, DTF, Heat Transfer):", "DTG") || "").trim();
            if (!name) return;
            if (name === "Screen Print" || name === "Embroidery") {
              window.alert(`"${name}" already exists as a built-in tab.`);
              return;
            }
            if (config.custom_techniques?.[name]) {
              window.alert(`"${name}" already exists.`);
              setPricingTab(`custom:${name}`);
              return;
            }
            // Seed with the current Screen Print values so the shop
            // has a sane starting point. They can edit any cell.
            setConfig(prev => ({
              ...prev,
              custom_techniques: {
                ...(prev.custom_techniques || {}),
                [name]: {
                  firstPrint: JSON.parse(JSON.stringify(prev.firstPrint || {})),
                  addlPrint:  JSON.parse(JSON.stringify(prev.addlPrint  || {})),
                  tiers:      [...(prev.tiers || [25, 50, 100, 200])],
                  maxColors:  prev.maxColors || 8,
                },
              },
            }));
            setPricingTab(`custom:${name}`);
          }}
          className="text-xs font-semibold px-3 py-2 rounded-t-lg transition text-teal-600 hover:bg-teal-50"
          title="Add a custom decoration method with its own rate table"
        >
          + Add Method
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

      {/* Extras & Fees — same editor used by Embroidery + each custom
          method so the layout never drifts between tabs. */}
      {/* Global preference: show add-on names on line descriptions everywhere
          (quote page, PDF, QuickBooks invoice) vs. baking them silently into
          the price. Default off preserves the prior hidden behavior. Snapshotted
          per-line at quote save, so it only affects quotes saved while it's on. */}
      <label className="flex items-start gap-2 text-xs text-slate-600 mb-3 cursor-pointer select-none bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
        <input
          type="checkbox"
          checked={!!config.show_addons_in_description}
          onChange={(e) => setConfig(prev => ({ ...prev, show_addons_in_description: e.target.checked }))}
          className="w-4 h-4 mt-0.5 rounded border-slate-300 text-teal-600"
        />
        <span>
          <span className="font-semibold text-slate-700">Show add-on names on line items</span>
          {" — "}list each line's active add-ons (e.g. "Ink Color Match") on the quote, PDF, and
          QuickBooks invoice. When off, add-ons are still charged but not itemized.
        </span>
      </label>
      {renderExtrasEditor(null)}

      {/* Setup Fees — per-screen multiplier (list) */}
      <div className="border-t border-slate-100 dark:border-slate-700 pt-5 mt-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-bold text-slate-700 dark:text-slate-200">Setup Fees</div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Per-screen charges added to each quote (e.g. Screens, Film, Color Match). Each fee multiplies by the screen count. Linked artwork shared between line items only counts once. Editable per-quote.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={!!config.setupFees?.enabled}
              onChange={(e) => setConfig(prev => ({
                ...prev,
                setupFees: { ...(prev.setupFees || {}), enabled: e.target.checked },
              }))}
              className="w-4 h-4 rounded border-slate-300 text-teal-600"
            />
            Enabled
          </label>
        </div>

        <div className={config.setupFees?.enabled ? "" : "opacity-50 pointer-events-none"}>
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_120px_120px_32px] gap-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 px-1">
            <div>Fee Name</div>
            <div>Per-Screen Rate</div>
            <div>Reorder Rate</div>
            <div />
          </div>

          {(config.setupFees?.items || []).map((fee, idx) => (
            <div key={fee.id || idx} className="grid grid-cols-[1fr_120px_120px_32px] gap-2 mb-2">
              <input
                type="text"
                value={fee.label || ""}
                onChange={(e) => setConfig(prev => {
                  const items = [...(prev.setupFees?.items || [])];
                  items[idx] = { ...items[idx], label: e.target.value };
                  return { ...prev, setupFees: { ...(prev.setupFees || {}), items } };
                })}
                placeholder="e.g. Screens"
                className="text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300"
              />
              <div className="relative">
                <span className="absolute left-2 top-1.5 text-xs text-slate-400">$</span>
                <NumericInput
                  value={Number(fee.rate || 0)}
                  onChange={(v) => setConfig(prev => {
                    const items = [...(prev.setupFees?.items || [])];
                    items[idx] = { ...items[idx], rate: v };
                    return { ...prev, setupFees: { ...(prev.setupFees || {}), items } };
                  })}
                  min={0}
                  label={`${fee.label} per-screen rate`}
                  className="w-full text-xs border border-slate-200 rounded pl-5 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300"
                />
              </div>
              <div className="relative">
                <span className="absolute left-2 top-1.5 text-xs text-slate-400">$</span>
                <NumericInput
                  value={Number(fee.reorderRate || 0)}
                  onChange={(v) => setConfig(prev => {
                    const items = [...(prev.setupFees?.items || [])];
                    items[idx] = { ...items[idx], reorderRate: v };
                    return { ...prev, setupFees: { ...(prev.setupFees || {}), items } };
                  })}
                  min={0}
                  label={`${fee.label} reorder rate`}
                  className="w-full text-xs border border-slate-200 rounded pl-5 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300"
                />
              </div>
              <button
                type="button"
                onClick={() => setConfig(prev => {
                  const items = (prev.setupFees?.items || []).filter((_, i) => i !== idx);
                  return { ...prev, setupFees: { ...(prev.setupFees || {}), items } };
                })}
                title={`Remove ${fee.label || "fee"}`}
                className="text-slate-300 hover:text-red-500 transition flex items-center justify-center"
              >
                ×
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setConfig(prev => {
              const items = [...(prev.setupFees?.items || [])];
              // Generate a unique id by combining a slug with a timestamp
              // suffix — labels can collide ("Color Match" twice) so the
              // id has to be the stable handle for skippedFeeIds.
              const id = `fee_${Date.now().toString(36)}`;
              items.push({ id, label: "New Fee", rate: 0, reorderRate: 0 });
              return { ...prev, setupFees: { ...(prev.setupFees || {}), items } };
            })}
            className="text-xs font-semibold text-teal-600 hover:text-teal-700 mt-1 transition"
          >
            + Add fee
          </button>

          <p className="text-[10px] text-slate-400 mt-3">
            Reorder rate is used when "Reorder" is checked on the quote — screens already exist from the first run, so film/burn can be skipped.
          </p>
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
                className="w-4 h-4 rounded border-slate-300 text-teal-600" />
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
                  <NumericInput
                    value={emb.digitizingFee}
                    onChange={(n) => setConfig(prev => ({ ...prev, embroidery: { ...prev.embroidery, digitizingFee: n } }))}
                    min={0}
                    max={10000}
                    label="Digitizing fee"
                    className="w-full text-xs border border-slate-200 rounded px-5 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300"
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-1">One-time fee per new design</p>
              </div>
            </div>

            {/* Embroidery Pricing Table */}
            {/* Tier editing lives in the table header (same pattern as
                renderPrintTable above) — the previous standalone
                "Quantity Tiers" section was redundant since the table
                already renders one column per tier. Edit a tier value
                inline, click × to remove a column, click + at the end
                to add one. */}
            <div>
              <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-2">Per Piece Pricing</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400">
                      <th className="text-left py-1 pr-2">Stitch Count</th>
                      {(emb.qtyTiers || []).map(t => (
                        <th key={t} className="text-center py-1">
                          <div className="inline-flex items-center gap-1">
                            <input type="number" value={t}
                              onChange={e => updateEmbTierValue(t, e.target.value)}
                              className="w-14 text-xs text-center border border-transparent hover:border-slate-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-teal-300 bg-transparent text-slate-400 font-semibold" />
                            <span className="text-slate-300">+</span>
                            {(emb.qtyTiers || []).length > 1 && (
                              <button
                                onClick={() => removeEmbTier(t)}
                                className="text-slate-300 hover:text-red-500 text-xs ml-0.5"
                                title={`Remove ${t}+ tier`}
                              >×</button>
                            )}
                          </div>
                        </th>
                      ))}
                      <th className="py-1 px-1">
                        <button onClick={addEmbTier} className="text-teal-500 hover:text-teal-700 text-xs font-bold" title="Add tier">+</button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(emb.stitchTiers || []).map(st => (
                      <tr key={st}>
                        <td className="py-1 pr-2 font-semibold text-slate-600 whitespace-nowrap">{st}</td>
                        {(emb.qtyTiers || []).map(t => (
                          <td key={t} className="py-1 px-0.5">
                            <NumericInput
                              value={emb.pricing?.[st]?.[t]}
                              onChange={(n) => updateEmbroideryPrice(st, t, n)}
                              min={0}
                              max={10000}
                              label={`Embroidery "${st}" × ${t} pcs`}
                              className={inputCls}
                            />
                          </td>
                        ))}
                        {/* Pad for the + add-tier column in the header */}
                        <td></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Embroidery Extras — same editor as Screen Print, scoped
                to the embroidery slice. Existing rows without
                extraLabels/extraModes fall back to camelCase→Title +
                "flat" so the migration is implicit. */}
            {renderExtrasEditor("embroidery", {
              title: "Embroidery Extras (per piece)",
              description: "Fees that only apply when an imprint's technique is Embroidery. Toggle $ / % per fee.",
            })}
          </>}
        </div>
      )}

      {/* Custom technique editor — uses the SAME blocks as Screen
          Print (Max Colors header + inline +/× matrices + Extras
          section) via the scope-aware handlers above. That's how
          DTG / DTF / etc. end up structurally identical to Screen
          Print instead of feeling like a separate, lesser editor. */}
      {pricingTab.startsWith("custom:") && (() => {
        const name = pricingTab.slice("custom:".length);
        const tech = config.custom_techniques?.[name];
        if (!tech) {
          return (
            <div className="text-xs text-slate-400 italic py-4">
              This method no longer exists.
              <button
                onClick={() => setPricingTab("screen_print")}
                className="ml-2 text-teal-600 font-semibold hover:text-teal-700"
              >
                Back to Screen Print
              </button>
            </div>
          );
        }

        const techMaxC = tech.maxColors || maxColors;

        return (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs text-slate-500">
                Rates apply when an imprint's technique is set to <span className="font-semibold text-slate-700">{name}</span>. Fields with no value fall back to your Screen Print rates so a partial save still produces a quote.
              </p>
              <button
                onClick={() => {
                  if (!window.confirm(`Remove "${name}"? Past quotes stay anchored to their saved values — only future imprints are affected.`)) return;
                  setConfig(prev => {
                    const next = { ...prev, custom_techniques: { ...(prev.custom_techniques || {}) } };
                    delete next.custom_techniques[name];
                    return next;
                  });
                  setPricingTab("screen_print");
                }}
                className="text-xs font-semibold text-red-400 hover:text-red-600 transition px-3 py-1.5 rounded-lg border border-red-100 hover:bg-red-50 whitespace-nowrap"
              >
                Remove {name}
              </button>
            </div>

            {/* Max Colors — same control as Screen Print, scoped to this tech */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest">Max Colors</h4>
                <div className="flex items-center gap-1">
                  <button onClick={() => removeColorRow(name)} disabled={techMaxC <= 1}
                    className="w-6 h-6 flex items-center justify-center text-xs font-bold border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30">-</button>
                  <span className="text-sm font-bold text-slate-700 w-6 text-center">{techMaxC}</span>
                  <button onClick={() => addColorRow(name)}
                    className="w-6 h-6 flex items-center justify-center text-xs font-bold border border-slate-200 rounded hover:bg-slate-50">+</button>
                </div>
              </div>
            </div>

            {renderPrintTable("firstPrint", `First ${name} Location (per piece)`, name)}
            {renderPrintTable("addlPrint",  `Additional ${name} Locations (per piece)`, name)}

            {/* Per-technique Extras — same editor as Screen Print + Embroidery. */}
            {renderExtrasEditor(name, {
              description: `Fees that only apply when an imprint's technique is ${name}. Toggle $ / % per fee.`,
            })}
          </div>
        );
      })()}

      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving}
          className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition disabled:opacity-50">
          {saving ? "Saving..." : saved ? "Saved" : "Save Pricing"}
        </button>
        <button
          onClick={() => {
            if (window.confirm("Reset all pricing to defaults? This wipes your custom tiers, print rates, markups, extras, and embroidery config. You'll still need to click Save to persist the reset.")) {
              setConfig({ ...DEFAULTS });
            }
          }}
          className="text-xs text-slate-500 hover:text-slate-700 font-semibold">
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}