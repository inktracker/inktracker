import { useState, useRef } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import {
  Store, Image, Mail, CheckCircle2, ChevronRight,
  Loader2, Upload, X
} from "lucide-react";

const QB_CLIENT_ID    = import.meta.env.VITE_QB_CLIENT_ID ?? "ABJLeI2LHqN4eXU90P8rozRsksp5DqdjYvIrzZQ9P7jhIeN7Cf";
const QB_REDIRECT_URI = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/qbOAuthCallback`;
const SUPABASE_URL    = import.meta.env.VITE_SUPABASE_URL;

const STEPS = [
  { id: "welcome",  icon: Store,      title: "Welcome to InkTracker" },
  { id: "shop",     icon: Store,      title: "Shop Details" },
  { id: "branding", icon: Image,      title: "Logo & Branding" },
  { id: "email",    icon: Mail,       title: "Email & Payments" },
  { id: "done",     icon: CheckCircle2, title: "You're all set!" },
];

export default function OnboardingWizard({ user, onComplete }) {
  const [step, setStep] = useState(0);
  const [shopName, setShopName] = useState(user?.shop_name || "");
  const [contactEmail, setContactEmail] = useState(user?.email || "");
  const [logoUrl, setLogoUrl] = useState(user?.logo_url || "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [qbChecking, setQbChecking] = useState(false);
  const [qbConnected, setQbConnected] = useState(false);
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
        const { uploadFile: upload } = await import("@/lib/uploadFile");
        const { file_url } = await upload(file);
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
      const res = await fetch(`${SUPABASE_URL}/functions/v1/qbSync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "checkConnection", accessToken: session?.access_token }),
      });
      const data = await res.json();
      setQbConnected(!!data.connected);
    } catch {
      setQbConnected(false);
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
      await base44.auth.updateMe({
        shop_name: shopName.trim() || user.email,
        logo_url: logoUrl,
      });

      // Also upsert a Shop entity so quotes/orders can find it
      const shops = await base44.entities.Shop.filter({ owner_email: user.email });
      const shopPayload = {
        owner_email: user.email,
        shop_name: shopName.trim() || user.email,
        logo_url: logoUrl,
      };
      if (shops?.length) {
        await base44.entities.Shop.update(shops[0].id, shopPayload);
      } else {
        await base44.entities.Shop.create(shopPayload);
      }

      onComplete?.();
    } catch (err) {
      console.error("Onboarding save error:", err);
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
    <div className="fixed inset-0 z-[300] bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Progress bar */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-indigo-300 uppercase tracking-widest">Setup</span>
            <span className="text-xs text-slate-400">{step + 1} of {totalSteps}</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-400 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between mt-2">
            {STEPS.map((s, i) => (
              <div
                key={s.id}
                className={`text-[10px] font-semibold transition ${i <= step ? "text-indigo-300" : "text-slate-600"}`}
              >
                {s.title.split(" ")[0]}
              </div>
            ))}
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          {/* Step header */}
          <div className="px-8 pt-8 pb-6 border-b border-slate-100">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center">
                <current.icon className="w-5 h-5 text-white" />
              </div>
              <h2 className="text-xl font-bold text-slate-900">{current.title}</h2>
            </div>
          </div>

          {/* Step body */}
          <div className="px-8 py-6 min-h-[280px] flex flex-col">

            {/* ── Step 0: Welcome ────────────────────────────────────────── */}
            {step === 0 && (
              <div className="flex-1 flex flex-col gap-5">
                <p className="text-slate-600 leading-relaxed">
                  Hi{user?.email ? ` ${user.email.split("@")[0]}` : ""}! InkTracker is your all-in-one platform for quotes, orders, and production tracking.
                </p>
                <p className="text-slate-600 leading-relaxed">
                  This quick setup takes about 2 minutes. You can change everything later in your Account settings.
                </p>
                <div className="grid grid-cols-3 gap-3 mt-2">
                  {[
                    { icon: "📋", label: "Quotes & Orders" },
                    { icon: "📅", label: "Production Calendar" },
                    { icon: "📊", label: "Performance Reports" },
                  ].map(({ icon, label }) => (
                    <div key={label} className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 text-center">
                      <div className="text-2xl mb-1">{icon}</div>
                      <div className="text-xs font-semibold text-indigo-800">{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Step 1: Shop Details ────────────────────────────────────── */}
            {step === 1 && (
              <div className="flex-1 flex flex-col gap-4">
                <p className="text-sm text-slate-500">This name appears on quotes, invoices, and emails sent to your customers.</p>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Shop Name *</label>
                  <input
                    type="text"
                    value={shopName}
                    onChange={e => setShopName(e.target.value)}
                    placeholder="Biota MFG, Custom Ink Co., etc."
                    autoFocus
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Contact Email</label>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={e => setContactEmail(e.target.value)}
                    placeholder="you@yourshop.com"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 text-slate-900"
                  />
                  <p className="text-xs text-slate-400 mt-1.5">This is your login email — customers won't see it.</p>
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
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-indigo-800">
                    <Mail className="w-4 h-4" />
                    Email is ready to go
                  </div>
                  <p className="text-xs text-indigo-700 leading-relaxed">
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
                        onClick={async () => { await checkQBConnection(); if (!qbConnected) connectQB(); }}
                        disabled={qbChecking}
                        className="text-xs font-semibold text-[#2CA01C] border border-[#2CA01C] px-3 py-1.5 rounded-lg hover:bg-green-50 transition disabled:opacity-50 shrink-0"
                      >
                        {qbChecking ? "Checking…" : "Connect"}
                      </button>
                    )}
                  </div>

                  {/* Stripe */}
                  <div className="border border-slate-200 rounded-xl p-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white shrink-0">
                      <svg viewBox="0 0 28 28" fill="currentColor" className="w-5 h-5"><path d="M13.6 8c-2 0-3.2 1-3.2 2.5 0 3.2 5.3 2.3 5.3 5 0 1.2-.9 2-2.7 2-1.7 0-3.2-.7-4.2-1.7l-1.2 2c1.2 1.2 3 2 5.4 2 2.6 0 4.4-1.4 4.4-3.6 0-3.4-5.3-2.6-5.3-5 0-1 .8-1.7 2.2-1.7 1.2 0 2.4.5 3.2 1.2l1.2-2C17.5 8.5 15.8 8 13.6 8z"/></svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-800">Stripe Payments</div>
                      <div className="text-xs text-slate-500">Connect your bank account to receive customer payments</div>
                    </div>
                    <span className="text-xs font-semibold text-slate-400 border border-slate-200 px-2 py-1 rounded-full shrink-0">Coming soon</span>
                  </div>
                </div>
              </div>
            )}

            {/* ── Step 4: Done ────────────────────────────────────────────── */}
            {step === 4 && (
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
                    { emoji: "📋", label: "Create a Quote" },
                    { emoji: "📦", label: "Add an Order" },
                    { emoji: "👥", label: "Add Customers" },
                    { emoji: "⚙️", label: "Account Settings" },
                  ].map(({ emoji, label }) => (
                    <div key={label} className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-center">
                      <div className="text-xl mb-0.5">{emoji}</div>
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
                  className="flex items-center gap-2 px-6 py-2.5 text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition disabled:opacity-40 ml-auto"
                >
                  {step === 0 ? "Get Started" : "Continue"}
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            ) : (
              <button
                onClick={saveAndFinish}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {saving ? "Saving…" : "Go to Dashboard"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
