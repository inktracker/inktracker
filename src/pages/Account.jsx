import { openAuthRedirect } from "@/lib/mobile/native";
import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { base44, supabase } from "@/api/supabaseClient";
import { FormSkeleton } from "@/components/shared/Skeletons";
import { uploadLogo } from "@/lib/uploadFile";
import { normalizeBrandColor } from "@/lib/branding";
import { User, LogOut, Package, Link2, Mail, ChevronDown, Wand2, CreditCard, CheckSquare, Shield, Handshake } from "lucide-react";
import PartnersSection from "../components/account/PartnersSection";
import { loadShopTimezone } from "@/lib/shopTimezone";
import WizardConfigEditor from "../components/wizard/WizardConfigEditor";
import SecuritySection from "../components/account/SecuritySection";
import ProfileSection from "../components/account/ProfileSection";
import QuickBooksSection from "../components/account/QuickBooksSection";
import BillingSection from "../components/account/BillingSection";
import PricingConfigEditor from "../components/account/PricingConfigEditor";
import ProductionTasksSection from "../components/account/ProductionTasksSection";
import OrderEditingSection from "../components/account/OrderEditingSection";
import DeleteAccountSection from "../components/account/DeleteAccountSection";
import ExportDataSection from "../components/account/ExportDataSection";
import SupplierKeysSection from "../components/account/SupplierKeysSection";
import StepUpConfirmModal from "@/components/StepUpConfirmModal";
import { notify } from "@/lib/notify";
import { qbOAuthErrorMessage } from "@/lib/qb/oauthErrorMessage";
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
        <ChevronDown className={`w-5 h-5 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
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
  const [shopRecord, setShopRecord] = useState(null);
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
  // True when an access token lingers but the refresh token has expired — the
  // connection is effectively dead. Shows a "reconnect" prompt, not "connect".
  const [qbNeedsReconnect, setQbNeedsReconnect] = useState(false);
  // Income-account picker — where InkTracker invoices post revenue in QB.
  // "" = Auto (let qbSync guess). qbIncomeAccounts: null=not loaded, []=loaded.
  const [qbIncomeAccountId, setQbIncomeAccountId] = useState("");
  const [qbIncomeAccounts, setQbIncomeAccounts] = useState(null);
  // The account "Auto" currently resolves to (from listIncomeAccounts), so
  // the picker can show where un-configured revenue actually posts.
  const [qbAutoAccountId, setQbAutoAccountId] = useState("");
  const [qbAccountsLoading, setQbAccountsLoading] = useState(false);
  const [qbAccountSaving, setQbAccountSaving] = useState(false);
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
        // Load shop-level settings (timezone, brand color, QB income
        // account, email template) from the Shop entity.
        try {
          const shops = await base44.entities.Shop.filter({ owner_email: shopScope(currentUser) });
          setShopRecord(shops?.[0] || null);
          setTimezone(shops?.[0]?.timezone || "");
          setBrandColor(shops?.[0]?.brand_color || "");
          setQbIncomeAccountId(shops?.[0]?.qb_income_account_id || "");
          if (shops?.[0]?.quote_email_subject) setEmailSubject(shops[0].quote_email_subject);
          if (shops?.[0]?.quote_email_body) setEmailBody(shops[0].quote_email_body);
        } catch {}

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
            setQbNeedsReconnect(!!data.needsReconnect);
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
    // Tax rate: don't silently coerce invalid/out-of-range input to 0% (FE-05).
    // Empty is allowed (= 0%, tax-exempt shop); a typed value must be 0–100.
    const trRaw = String(taxRate).trim();
    const trNum = parseFloat(trRaw);
    if (trRaw !== "" && (!Number.isFinite(trNum) || trNum < 0 || trNum > 100)) {
      notify.error("Tax rate must be a number between 0 and 100.");
      return;
    }
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
        default_tax_rate: trRaw === "" ? 0 : Math.max(0, Math.min(100, trNum)),
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
      // M-1: logos go to the public bucket, not the (soon-private) artwork one.
      const { file_url } = await uploadLogo(file, user?.id);

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

  // Load the shop's QB Income accounts for the picker, once connected.
  useEffect(() => {
    if (!qbConnected) { setQbIncomeAccounts(null); return; }
    let cancelled = false;
    (async () => {
      setQbAccountsLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const { data, error } = await base44.functions.invoke("qbSync", {
          action: "listIncomeAccounts",
          accessToken: session?.access_token,
        });
        if (!cancelled && !error && Array.isArray(data?.accounts)) {
          setQbIncomeAccounts(data.accounts);
          setQbAutoAccountId(data.autoSelectedId || "");
        }
      } catch { /* leave null — the picker shows a soft fallback */ }
      finally { if (!cancelled) setQbAccountsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [qbConnected]);

  // Save the chosen income account on the shop (Auto = null → qbSync guesses).
  async function saveIncomeAccount(id) {
    setQbAccountSaving(true);
    try {
      const name = id ? ((qbIncomeAccounts || []).find((a) => a.id === id)?.name || null) : null;
      const shops = await base44.entities.Shop.filter({ owner_email: shopScope(user) });
      const payload = { qb_income_account_id: id || null, qb_income_account_name: name };
      if (shops?.[0]) {
        await base44.entities.Shop.update(shops[0].id, payload);
      }
      setQbIncomeAccountId(id);
      setQbMessage({ type: "success", text: id ? "Income account saved." : "Set to Auto — InkTracker will choose." });
      setTimeout(() => setQbMessage(null), 3000);
    } catch (err) {
      setQbMessage({ type: "error", text: "Couldn't save the income account. Try again." });
    } finally {
      setQbAccountSaving(false);
    }
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
      openAuthRedirect(buildQBAuthUrl(data.state));
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
    // Enforce customers-before-invoices. Invoices link to a customer by
    // qb_customer_id, so pulling them before any customers are imported
    // leaves them unlinked — the exact gap a shop hit running the invoice
    // sync alone. Fast-path: a successful customer sync THIS session means
    // we're clearly in order. Otherwise check for any already-imported QB
    // customer; if there are none, steer them to sync customers first
    // (a plain confirm, not a banner).
    const syncedCustomersThisSession = !!(qbMigrateResult && !qbMigrateResult.error);
    if (!syncedCustomersThisSession) {
      let hasQbCustomers = true; // fail-open: a check error must not block the sync
      try {
        const { count } = await supabase
          .from("customers")
          .select("id", { count: "exact", head: true })
          .not("qb_customer_id", "is", null);
        hasQbCustomers = (count ?? 0) > 0;
      } catch (err) {
        console.warn("QB customer presence check failed — proceeding:", err);
      }
      if (!hasQbCustomers) {
        const proceed = window.confirm(
          "Sync your QuickBooks customers first so these invoices link to the right customer.\n\nSync invoices anyway?"
        );
        if (!proceed) return;
      }
    }
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
          <ProfileSection
            user={user}
            firstName={firstName} setFirstName={setFirstName}
            lastName={lastName} setLastName={setLastName}
            shopName={shopName} setShopName={setShopName}
            phone={phone} setPhone={setPhone}
            taxRate={taxRate} setTaxRate={setTaxRate}
            timezone={timezone} setTimezone={setTimezone}
            address={address} setAddress={setAddress}
            city={city} setCity={setCity}
            stateVal={stateVal} setStateVal={setStateVal}
            zip={zip} setZip={setZip}
            website={website} setWebsite={setWebsite}
            logoUrl={logoUrl}
            brandColor={brandColor} setBrandColor={setBrandColor}
            uploading={uploading}
            saving={saving}
            message={message}
            handleSave={handleSave}
            handleLogoUpload={handleLogoUpload}
            handleRemoveLogo={handleRemoveLogo}
          />
        </Section>

        {(user?.role === "admin" || user?.role === "shop") && <Section icon={CreditCard} title="Billing & Plan" defaultOpen={location.search?.includes("billing")}>
          <BillingSection user={user} />
        </Section>}

        {(user?.role === "admin" || user?.role === "shop" || user?.role === "manager") && (
          <Section icon={Handshake} title="Partners">
            <PartnersSection />
          </Section>
        )}

        <Section icon={User} title="Account">
          <div className="space-y-5">
            <div className="space-y-3">
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">Email</div>
                <div className="text-sm text-slate-700 font-semibold">{user?.email}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">Role</div>
                <div className="text-sm text-slate-700 font-semibold capitalize">{user?.role || "user"}</div>
              </div>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700 pt-5">
              <div className="text-sm font-semibold text-slate-700 mb-2">Export Data</div>
              <ExportDataSection user={user} />
            </div>

            {(user?.role === "admin" || user?.role === "shop") && (
              <div className="border-t border-red-200 dark:border-red-900/50 pt-5">
                <div className="text-sm font-semibold text-red-700 mb-2">Danger Zone</div>
                <DeleteAccountSection user={user} />
              </div>
            )}
          </div>
        </Section>

        {user && (
          <Section icon={Shield} title="Security" defaultOpen={location.search?.includes("security")}>
            <SecuritySection />
          </Section>
        )}

        {user && (
          <Section icon={Wand2} title="Quote Wizard">
            <p className="text-sm text-slate-500 mb-3">
              Curate the styles and print setups walk-in customers see on the Wizard page.
            </p>
            <WizardConfigEditor user={user} shop={shopRecord} onSaved={() => {}} />
          </Section>
        )}

        <Section icon={Mail} title="Quote Email Template">
          <p className="text-sm text-slate-500 mb-4">
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
          <QuickBooksSection
            user={user}
            qbMessage={qbMessage}
            setQbMessage={setQbMessage}
            qbConnected={qbConnected}
            qbRealmId={qbRealmId}
            qbExpiresAt={qbExpiresAt}
            qbRefreshExpiresAt={qbRefreshExpiresAt}
            qbNeedsReconnect={qbNeedsReconnect}
            qbConnecting={qbConnecting}
            qbAccountsLoading={qbAccountsLoading}
            qbIncomeAccounts={qbIncomeAccounts}
            qbIncomeAccountId={qbIncomeAccountId}
            qbAutoAccountId={qbAutoAccountId}
            qbAccountSaving={qbAccountSaving}
            saveIncomeAccount={saveIncomeAccount}
            qbSyncingAll={qbSyncingAll}
            qbSyncAllError={qbSyncAllError}
            qbMigrating={qbMigrating}
            qbMigrateResult={qbMigrateResult}
            qbMigratingInv={qbMigratingInv}
            qbMigrateInvResult={qbMigrateInvResult}
            qbDisconnecting={qbDisconnecting}
            handleConnectQB={handleConnectQB}
            handleSyncAll={handleSyncAll}
            handleMigrateCustomers={handleMigrateCustomers}
            handleMigrateInvoices={handleMigrateInvoices}
            handleDisconnectQB={handleDisconnectQB}
          />
        </Section>}

        <Section icon={CreditCard} title="Pricing & Fees">
          <PricingConfigEditor user={user} />
        </Section>

        <Section icon={CheckSquare} title="Production Tasks">
          <ProductionTasksSection user={user} />

          <OrderEditingSection user={user} />
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
