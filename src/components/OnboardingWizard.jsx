import { useState, useRef } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { uploadFile } from "@/lib/uploadFile";
import { seedDemoData } from "@/lib/demoSeed";
import {
  buildOnboardingProfile,
  buildShopUpsertPayload,
} from "@/lib/onboarding/buildOnboardingProfile";
import { SHOP_TIMEZONE_OPTIONS, loadShopTimezone } from "@/lib/shopTimezone";
import { loadShopPricingConfig } from "@/components/shared/pricing";
import {
  Store, Image, Mail, CheckCircle2, ChevronRight,
  Loader2, Upload, X, FileText, Package, Users, Settings, ShieldCheck
} from "lucide-react";
import { requestMfaSignInCode, verifyMfaSignInCode, enableMfaEmail } from "@/lib/mfa";
import { notify } from "@/lib/notify";

const QB_CLIENT_ID    = import.meta.env.VITE_QB_CLIENT_ID;
// Routes through Vercel proxy — see src/pages/Account.jsx note.
const QB_REDIRECT_URI = `${import.meta.env.VITE_APP_URL?.trim() || "https://inktracker.app"}/api/qb-callback`;
const SUPABASE_URL    = import.meta.env.VITE_SUPABASE_URL;

const STEPS = [
  { id: "welcome",  icon: Store,      title: "Welcome to InkTracker" },
  { id: "shop",     icon: Store,      title: "Shop Details" },
  { id: "branding", icon: Image,      title: "Logo & Branding" },
  { id: "email",    icon: Mail,       title: "Email & Payments" },
  { id: "security", icon: ShieldCheck, title: "Protect Your Account" },
  { id: "done",     icon: CheckCircle2, title: "You're all set!" },
];

export default function OnboardingWizard({ user, onComplete }) {
  const [step, setStep] = useState(0);
  const [shopName, setShopName] = useState(user?.shop_name || "");
  const [contactEmail, setContactEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [address, setAddress] = useState(user?.address || "");
  const [city, setCity] = useState(user?.city || "");
  const [stateVal, setStateVal] = useState(user?.state || "");
  const [zip, setZip] = useState(user?.zip || "");
  const [website, setWebsite] = useState(user?.website || "");
  const [taxRate, setTaxRate] = useState(user?.default_tax_rate || "");
  // Pre-select the user's browser timezone if it's one of our curated
  // options — saves 95% of US shops a click. Falls back to "" (browser
  // default at runtime via getShopTimezone) for anything we don't have
  // an explicit option for.
  const [timezone, setTimezone] = useState(() => {
    try {
      const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const match = SHOP_TIMEZONE_OPTIONS.find((opt) => opt.value === browserTz);
      return match ? match.value : "";
    } catch {
      return "";
    }
  });
  const [offersEmbroidery, setOffersEmbroidery] = useState(false);
  const [logoUrl, setLogoUrl] = useState(user?.logo_url || "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [qbChecking, setQbChecking] = useState(false);
  const [qbConnected, setQbConnected] = useState(false);
  // Phase 5b — MFA enrollment inside the wizard. Same verify-then-enable
  // contract as SecuritySection (request code → verify → enableMfaEmail);
  // the mfa.js wrappers carry the 34 contract specs. Skipping is fine —
  // the Dashboard nudge banner keeps prompting until enrolled.
  const [mfaPhase, setMfaPhase] = useState("intro"); // intro | code | on
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState("");
  // Default OFF — most new shops want a clean dashboard, not a
  // mix of "Demo Acme Co." rows alongside real customers. Users
  // who want to see the app populated can still opt in via the
  // checkbox in the onboarding wizard.
  const [seedDemo, setSeedDemo] = useState(false);
  const fileRef = useRef();

  const totalSteps = STEPS.length;
  const current = STEPS[step];
  const pct = Math.round((step / (totalSteps - 1)) * 100);

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `logos/${user.id}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("public")
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("public").getPublicUrl(path);
      setLogoUrl(data.publicUrl);
    } catch {
      // fallback using shared upload helper
      try {
        const { file_url } = await uploadFile(file);
        if (file_url) setLogoUrl(file_url);
      } catch {}
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function checkQBConnection() {
    setQbChecking(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error: invErr } = await base44.functions.invoke("qbSync", {
        action: "checkConnection",
        accessToken: session?.access_token,
      });
      const ok = !invErr && !!data?.connected;
      setQbConnected(ok);
      return ok;
    } catch {
      setQbConnected(false);
      return false;
    } finally {
      setQbChecking(false);
    }
  }

  async function connectQB() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const state = crypto.randomUUID();
    await supabase.from("profiles").update({ qb_oauth_state: state }).eq("auth_id", session.user.id);
    const params = new URLSearchParams({
      client_id: QB_CLIENT_ID,
      response_type: "code",
      scope: "com.intuit.quickbooks.accounting com.intuit.quickbooks.payment",
      redirect_uri: QB_REDIRECT_URI,
      state,
      prompt: "login",
    });
    window.location.href = `https://appcenter.intuit.com/connect/oauth2?${params}`;
  }

  async function saveAndFinish() {
    setSaving(true);
    try {
      const wizardInput = { user, shopName, logoUrl, phone, address, city, stateVal, zip, website, taxRate, timezone, offersEmbroidery };
      const profileData = buildOnboardingProfile(wizardInput);
      await base44.auth.updateMe(profileData);

      // Built before the upsert try-block so it's in scope for the
      // loadShopPricingConfig call below — that fires regardless of
      // whether the network upsert succeeded (in-memory _pc should
      // reflect what we INTENDED to save, even if Supabase was
      // unreachable; the hard reload will re-sync from DB anyway).
      const shopPayload = buildShopUpsertPayload(wizardInput);
      // Also upsert a Shop entity so quotes/orders can find it
      try {
        const shops = await base44.entities.Shop.filter({ owner_email: user.email });
        if (shops?.length) {
          await base44.entities.Shop.update(shops[0].id, shopPayload);
        } else {
          await base44.entities.Shop.create(shopPayload);
        }
      } catch (shopErr) {
        console.warn("Shop upsert failed (non-blocking):", shopErr);
      }

      // Refresh the in-memory timezone singleton so calendar / date
      // helpers pick up the user's choice without a hard reload. Mirrors
      // the loadShopPricingConfig pattern called on Save in Account.
      loadShopTimezone(timezone || null);

      // Same refresh for pricing config. Account → Pricing → Save
      // already does this; without it, the onboarding finish leaves
      // _pc out of sync (the user "enabled embroidery" but the quote
      // modal didn't show it). The hard reload at the end would
      // eventually fix it via AuthContext, but anything between (a
      // CTA, a router transition, a pre-reload render) saw stale _pc.
      // The shopPayload.pricing_config we just persisted IS the
      // authoritative new value — replay it in memory now too.
      if (shopPayload?.pricing_config) {
        loadShopPricingConfig(shopPayload.pricing_config);
      }

      // Seed demo data if the user opted in. Non-blocking on failure —
      // we'd rather drop them into the app than fail the whole flow.
      if (seedDemo && user?.email) {
        try {
          await seedDemoData(user.email);
        } catch (seedErr) {
          console.warn("Demo seed failed (non-blocking):", seedErr);
        }
      }

      if (onComplete) {
        await onComplete();
      }
      // Force reload to ensure fresh state
      window.location.href = "/";
    } catch (err) {
      // Surface and stay on the wizard so the user can retry instead of
      // getting silently redirected into a possibly half-saved state.
      notify.error("Onboarding save failed", err);
    } finally {
      setSaving(false);
    }
  }

  function next() {
    if (step < totalSteps - 1) setStep(s => s + 1);
  }

  function back() {
    if (step > 0) setStep(s => s - 1);
  }

  return (
    <div className="fixed inset-0 z-[300] bg-gradient-to-br from-slate-900 via-teal-950 to-slate-900 overflow-y-auto flex items-start justify-center p-4 sm:py-8">
      <div className="w-full max-w-lg my-auto">
        {/* Progress bar */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-teal-300 uppercase tracking-widest">Setup</span>
            <span className="text-xs text-slate-400">{step + 1} of {totalSteps}</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-400 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between mt-2">
            {STEPS.map((s, i) => (
              <button
                key={s.id}
                onClick={() => { if (i < step) setStep(i); }}
                className={`text-[10px] font-semibold transition ${i < step ? "text-teal-300 hover:text-teal-100 cursor-pointer" : i === step ? "text-teal-300" : "text-slate-600 cursor-default"}`}
              >
                {s.title.split(" ")[0]}
              </button>
            ))}
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          {/* Step header */}
          <div className="px-8 pt-8 pb-6 border-b border-slate-100">
            <div className="flex items-center gap-3 mb-1">
              <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69aa650fd3e825e66ff81817/b4e2dc53f_logo.png"
                alt="InkTracker" className="w-9 h-9 rounded-xl" />
              <h2 className="text-xl font-bold text-slate-900">{current.title}</h2>
            </div>
          </div>

          {/* Step body */}
          <div className="px-8 py-6 min-h-[280px] flex flex-col">

            {/* ── Step 0: Welcome ────────────────────────────────────────── */}
            {step === 0 && (
              <div className="flex-1 flex flex-col gap-5">
                <p className="text-slate-600 leading-relaxed">
                  InkTracker is your all-in-one platform for quotes, orders, and production tracking.
                </p>
                <p className="text-slate-600 leading-relaxed">
                  This quick setup takes about 2 minutes. You can change everything later in your Account settings.
                </p>

                <label className="flex items-start gap-3 p-3 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition">
                  <input
                    type="checkbox"
                    checked={seedDemo}
                    onChange={(e) => setSeedDemo(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-teal-600 cursor-pointer"
                  />
                  <span className="text-sm text-slate-700">
                    <span className="font-semibold">Add sample data so I can explore</span>
                    <span className="block text-xs text-slate-500 mt-0.5">
                      Creates 3 demo customers, 5 quotes, and 2 orders. Each is prefixed "Demo —" so they're easy to delete.
                    </span>
                  </span>
                </label>
              </div>
            )}

            {/* ── Step 1: Shop Details ────────────────────────────────────── */}
            {step === 1 && (
              <div className="flex-1 flex flex-col gap-4">
                <p className="text-sm text-slate-500">This info appears on quotes, invoices, and customer emails.</p>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Shop Name *</label>
                  <input type="text" value={shopName} onChange={e => setShopName(e.target.value)}
                    placeholder="" autoFocus
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 text-slate-900" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Phone</label>
                    <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                      placeholder=""
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 text-slate-900" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Sales Tax %</label>
                    <input type="number" step="0.001" value={taxRate} onChange={e => setTaxRate(e.target.value)}
                      placeholder="e.g. 8.25"
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 text-slate-900" />
                    <p className="text-xs text-slate-400 mt-1">Enter the percentage (8.25 means 8.25%), not a decimal.</p>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Street Address</label>
                  <input type="text" value={address} onChange={e => setAddress(e.target.value)}
                    placeholder=""
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 text-slate-900" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">City</label>
                    <input type="text" value={city} onChange={e => setCity(e.target.value)} placeholder=""
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 text-slate-900" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">State</label>
                    <input type="text" value={stateVal} onChange={e => setStateVal(e.target.value)} placeholder="" maxLength={2}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 text-slate-900 uppercase" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">ZIP</label>
                    <input type="text" value={zip} onChange={e => setZip(e.target.value)} placeholder=""
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 text-slate-900" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Website</label>
                  <input
                    type="url"
                    value={website}
                    onChange={e => setWebsite(e.target.value)}
                    placeholder="https://yourshop.com"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 text-slate-900"
                  />
                  <p className="text-xs text-slate-400 mt-1.5">Shown on art proofs in place of the platform footer.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Shop Timezone</label>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 text-slate-900 bg-white"
                  >
                    {SHOP_TIMEZONE_OPTIONS.map((opt) => (
                      <option key={opt.value || "__default__"} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-400 mt-1">
                    Used by the calendar so employees logging in from another state still see your shop's "today." You can change this later in Account.
                  </p>
                </div>

                <div className="pt-3 mt-1 border-t border-slate-100">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Services Offered</p>
                  <label className="flex items-start gap-3 p-3 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition">
                    <input
                      type="checkbox"
                      checked={offersEmbroidery}
                      onChange={(e) => setOffersEmbroidery(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-teal-600 cursor-pointer"
                    />
                    <span className="text-sm text-slate-700">
                      <span className="font-semibold">We also offer embroidery</span>
                      <span className="block text-xs text-slate-500 mt-0.5">
                        Turns on embroidery pricing (stitch-count tiers + digitizing fee). You can fine-tune the rates later in Account → Pricing.
                      </span>
                    </span>
                  </label>
                  <p className="text-xs text-slate-400 mt-2">Screen printing is enabled by default.</p>
                </div>
              </div>
            )}

            {/* ── Step 2: Branding ────────────────────────────────────────── */}
            {step === 2 && (
              <div className="flex-1 flex flex-col gap-4">
                <p className="text-sm text-slate-500">Your logo appears on customer-facing quotes and the payment page. You can skip this and add it later.</p>
                <div className="flex flex-col items-center gap-4">
                  {logoUrl ? (
                    <div className="relative">
                      <img src={logoUrl} alt="Logo" className="w-28 h-28 object-contain rounded-2xl border border-slate-200 shadow-sm" />
                      <button
                        onClick={() => setLogoUrl("")}
                        className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="w-28 h-28 border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center justify-center gap-2 text-slate-400">
                      <Image className="w-8 h-8" />
                      <span className="text-xs">No logo</span>
                    </div>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="flex items-center gap-2 px-5 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
                  >
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {uploading ? "Uploading…" : logoUrl ? "Replace Logo" : "Upload Logo"}
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 3: Email & Payments ─────────────────────────────────── */}
            {step === 3 && (
              <div className="flex-1 flex flex-col gap-4">
                <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-teal-800">
                    <Mail className="w-4 h-4" />
                    Email is ready to go
                  </div>
                  <p className="text-xs text-teal-700 leading-relaxed">
                    Quote emails are sent automatically on behalf of <strong>{shopName || "your shop"}</strong>. No email server setup needed.
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Optional Integrations</p>

                  {/* QuickBooks */}
                  <div className="border border-slate-200 rounded-xl p-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[#2CA01C] flex items-center justify-center text-white font-black text-xs shrink-0">QB</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-800">QuickBooks</div>
                      <div className="text-xs text-slate-500">Sync invoices and get QB payment links</div>
                    </div>
                    {qbConnected ? (
                      <span className="text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-full">Connected</span>
                    ) : (
                      <button
                        onClick={async () => {
                          // Use the resolved return value rather than the
                          // React state — useState is async, so reading
                          // qbConnected here gets the stale (pre-check)
                          // value and the connectQB() branch was always
                          // taken even when checkQBConnection just found
                          // an active link.
                          const ok = await checkQBConnection();
                          if (!ok) connectQB();
                        }}
                        disabled={qbChecking}
                        className="text-xs font-semibold text-[#2CA01C] border border-[#2CA01C] px-3 py-1.5 rounded-lg hover:bg-green-50 transition disabled:opacity-50 shrink-0"
                      >
                        {qbChecking ? "Checking…" : "Connect"}
                      </button>
                    )}
                  </div>

                  {/* Stripe Connect was removed in v1 (QuickBooks-only).
                      Customer payments flow through QB's Commerce Network
                      payment links on quotes. If/when Stripe Connect comes
                      back, restore the integration row here. */}
                </div>
              </div>
            )}

            {/* ── Step 4: Done ────────────────────────────────────────────── */}
            {step === 4 && (
              <div className="flex-1 flex flex-col gap-4 py-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center">
                    <ShieldCheck className="w-5 h-5 text-teal-600" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Two-factor authentication</h3>
                    <p className="text-xs text-slate-500">Strongly recommended — takes about 20 seconds.</p>
                  </div>
                </div>

                {mfaPhase === "intro" && (
                  <>
                    <p className="text-sm text-slate-500 leading-relaxed">
                      Your InkTracker account can connect to your QuickBooks and hold your
                      customers' history — a stolen password shouldn't be enough to reach
                      either. With 2FA on, signing in also takes a 6-digit code we email
                      you. Tick "remember this device" at sign-in and your own computer
                      skips the code for 30 days.
                    </p>
                    <button
                      onClick={async () => {
                        setMfaError("");
                        setMfaBusy(true);
                        try {
                          const r = await requestMfaSignInCode();
                          if (r.ok || r.error === "rate_limited") {
                            setMfaPhase("code");
                          } else {
                            setMfaError(r.error || "Couldn't send the verification code.");
                          }
                        } finally {
                          setMfaBusy(false);
                        }
                      }}
                      disabled={mfaBusy}
                      className="flex items-center justify-center gap-2 px-6 py-3 text-sm font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition disabled:opacity-50 w-full"
                    >
                      {mfaBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                      Turn on 2FA — email me a code
                    </button>
                    <p className="text-xs text-slate-400 text-center">
                      You can also do this later under Account → Security.
                    </p>
                  </>
                )}

                {mfaPhase === "code" && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const trimmed = mfaCode.trim().replace(/\D/g, "");
                      if (trimmed.length !== 6) {
                        setMfaError("Enter the 6-digit code from your email.");
                        return;
                      }
                      setMfaBusy(true);
                      setMfaError("");
                      try {
                        const v = await verifyMfaSignInCode(trimmed);
                        if (!v.ok) {
                          setMfaError(v.error === "expired" ? "That code expired — resend a fresh one." : "That code didn't match — try again or resend.");
                          setMfaCode("");
                          return;
                        }
                        const en = await enableMfaEmail();
                        if (!en.ok) {
                          setMfaError(en.error || "Couldn't turn on 2FA after verifying. Try again.");
                          return;
                        }
                        setMfaPhase("on");
                        notify.success("Two-factor authentication is on", "Sign-ins now require a code from your email.");
                      } finally {
                        setMfaBusy(false);
                      }
                    }}
                    className="flex flex-col gap-3"
                  >
                    <p className="text-sm text-slate-500">
                      We emailed a 6-digit code to <strong>{user?.email}</strong>. Enter it to finish:
                    </p>
                    <input
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value)}
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="123456"
                      autoFocus
                      className="w-full text-center text-2xl tracking-[0.5em] font-mono border border-slate-200 rounded-xl px-3 py-3 focus:outline-none focus:ring-2 focus:ring-teal-300"
                    />
                    <button
                      type="submit"
                      disabled={mfaBusy}
                      className="flex items-center justify-center gap-2 px-6 py-3 text-sm font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition disabled:opacity-50"
                    >
                      {mfaBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Verify & turn on
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        setMfaError("");
                        setMfaBusy(true);
                        try {
                          const r = await requestMfaSignInCode();
                          if (!r.ok && r.error !== "rate_limited") setMfaError(r.error || "Couldn't send a new code.");
                        } finally {
                          setMfaBusy(false);
                        }
                      }}
                      disabled={mfaBusy}
                      className="text-xs font-semibold text-teal-600 hover:underline disabled:opacity-50"
                    >
                      Resend code
                    </button>
                  </form>
                )}

                {mfaPhase === "on" && (
                  <div className="flex flex-col items-center gap-3 text-center py-4">
                    <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
                      <ShieldCheck className="w-7 h-7 text-emerald-600" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900">Two-factor authentication is on</div>
                      <p className="text-sm text-slate-500 mt-1">
                        Next sign-in, we'll email you a code. Tick "remember this device" to skip it on your own computer for 30 days.
                      </p>
                    </div>
                  </div>
                )}

                {mfaError && <div className="text-xs text-red-500 text-center">{mfaError}</div>}
              </div>
            )}

            {step === 5 && (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center py-4">
                <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                  <CheckCircle2 className="w-9 h-9 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 mb-1">
                    {shopName || "Your shop"} is ready!
                  </h3>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    You can update your shop details, logo, email templates, and integrations any time from <strong>Account Settings</strong>.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 w-full mt-2">
                  {[
                    { Icon: FileText, label: "Create a Quote" },
                    { Icon: Package, label: "Add an Order" },
                    { Icon: Users, label: "Add Customers" },
                    { Icon: Settings, label: "Account Settings" },
                  ].map(({ Icon: CardIcon, label }) => (
                    <div key={label} className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-center">
                      <CardIcon className="w-5 h-5 text-teal-600 mx-auto mb-1" />
                      <div className="text-xs font-semibold text-slate-600">{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer buttons */}
          <div className="px-8 py-5 border-t border-slate-100 flex gap-3 bg-slate-50 rounded-b-3xl">
            {step > 0 && step < totalSteps - 1 && (
              <button
                onClick={back}
                className="px-4 py-2.5 text-sm font-semibold text-slate-500 border border-slate-200 rounded-xl hover:bg-white transition"
              >
                Back
              </button>
            )}

            {step < totalSteps - 1 ? (
              <>
                {step > 0 && step !== 1 && (
                  <button
                    onClick={next}
                    className="px-4 py-2.5 text-sm font-semibold text-slate-400 hover:text-slate-600 transition ml-auto"
                  >
                    Skip
                  </button>
                )}
                <button
                  onClick={next}
                  disabled={step === 1 && !shopName.trim()}
                  className="flex items-center gap-2 px-6 py-2.5 text-sm font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition disabled:opacity-40 ml-auto"
                >
                  {step === 0 ? "Get Started" : "Continue"}
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={back}
                  className="px-4 py-2.5 text-sm font-semibold text-slate-500 border border-slate-200 rounded-xl hover:bg-white transition"
                >
                  Back
                </button>
                <button
                  onClick={saveAndFinish}
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {saving ? "Saving…" : "Go to Dashboard"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
