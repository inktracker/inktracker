import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { base44, supabase } from "@/api/supabaseClient";
import { FormSkeleton } from "@/components/shared/Skeletons";

export default function BrokerOnboarding() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [draft, setDraft] = useState({
    full_name: "",
    broker_phone: "",
    company_name: "",
    broker_address: "",
    broker_notes: "",
  });
  // Brokers reach this page via a magic-link sign-in from the invite email
  // (no password yet). Forcing password creation here closes the gap where
  // a broker could finish onboarding and then be unable to sign in by
  // email+password later — they'd have to keep using "Forgot password" or
  // request a new magic link every time. If `existing_password` is true we
  // skip the prompt (returning users completing onboarding incrementally).
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const [hostShop, setHostShop] = useState(null);

  useEffect(() => {
    async function load() {
      const currentUser = await base44.auth.me();
      if (!currentUser) {
        await base44.auth.redirectToLogin();
        return;
      }

      // If this broker already finished onboarding (name set + password
      // we set ourselves via handleSave), send them straight to the
      // dashboard. Revisiting /BrokerOnboarding from an old link
      // shouldn't dump them into an empty form pretending it's fresh.
      //
      // Why user_metadata.has_password and not email_verified: Supabase
      // flips email_verified=true the instant the magic link is used,
      // which would bounce every freshly-invited broker straight past
      // this page (their full_name is pre-filled from the invite). We
      // set has_password ourselves in handleSave so this check only
      // fires for brokers who actually completed onboarding.
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (currentUser.full_name?.trim() && authUser?.user_metadata?.has_password) {
          window.location.assign("/BrokerDashboard");
          return;
        }
      } catch {
        // Don't block onboarding on a check failure — let them complete the form.
      }

      setUser(currentUser);
      setDraft({
        full_name:      currentUser.full_name ?? "",
        broker_phone:   currentUser.broker_phone ?? currentUser.phone ?? "",
        company_name:   currentUser.company_name ?? "",
        broker_address: currentUser.broker_address ?? currentUser.address ?? "",
        broker_notes:   currentUser.broker_notes ?? currentUser.notes ?? "",
      });

      // Load the inviting shop's profile so we can welcome the broker by
      // name and reassure them they're in the right place. `assigned_shops`
      // is set by adminAction.inviteBroker to [shopOwnerEmail].
      const assignedShop = Array.isArray(currentUser.assigned_shops) ? currentUser.assigned_shops[0] : null;
      if (assignedShop) {
        try {
          const shopProfile = await base44.entities.User.filter({ email: assignedShop });
          if (Array.isArray(shopProfile) && shopProfile[0]) {
            setHostShop(shopProfile[0]);
          }
        } catch {
          // Best-effort: missing shop context is okay, just no welcome line.
        }
      }

      setLoading(false);
    }
    load();
  }, []);

  function updateDraft(field, value) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    if (!draft.full_name.trim()) {
      setError("Your name is required.");
      return;
    }
    if (password.length < 9) {
      setError("Set a password (at least 9 characters) so you can sign in later.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error("Not signed in");

      // Set the password BEFORE the profile update. If this fails (rare —
      // expired session, weak password), we want to know before partially
      // updating the profile. The has_password metadata flag is what the
      // load-time redirect check above reads — without it, returning
      // brokers would land on this page again with an empty form.
      const { error: pwErr } = await supabase.auth.updateUser({
        password,
        data: { has_password: true },
      });
      if (pwErr) throw pwErr;

      const updates = {
        full_name:      draft.full_name.trim(),
        broker_phone:   draft.broker_phone.trim() || null,
        company_name:   draft.company_name.trim() || null,
        broker_address: draft.broker_address.trim() || null,
        broker_notes:   draft.broker_notes.trim() || null,
      };

      // Try update by auth_id first.
      const { data: byAuth, error: authErr } = await supabase
        .from("profiles")
        .update(updates)
        .eq("auth_id", authUser.id)
        .select("id");
      if (authErr) throw authErr;

      // Fall back to email — handles legacy profile rows that were pre-created
      // with auth_id=null. Also backfill auth_id so future lookups work.
      if (!byAuth || byAuth.length === 0) {
        const { error: emailErr } = await supabase
          .from("profiles")
          .update({ ...updates, auth_id: authUser.id })
          .eq("email", authUser.email);
        if (emailErr) throw emailErr;
      }

      setSaved(true);
      setTimeout(() => navigate("/BrokerDashboard"), 1200);
    } catch (err) {
      setError(err?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="max-w-md mx-auto px-4 py-16"><FormSkeleton /></div>;
  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
        <div className="mb-6">
          {hostShop?.shop_name ? (
            <>
              <div className="flex items-center gap-3 mb-3">
                {hostShop.logo_url && (
                  <img
                    src={hostShop.logo_url}
                    alt={`${hostShop.shop_name} logo`}
                    className="h-9 w-9 rounded-lg object-contain border border-slate-200 bg-white"
                  />
                )}
                <div className="text-xs font-semibold uppercase tracking-widest text-teal-600">
                  Welcome from {hostShop.shop_name}
                </div>
              </div>
              <h1 className="text-2xl font-bold text-slate-900">Set up your broker account</h1>
              <p className="text-sm text-slate-500 mt-1">
                You've been invited to broker for <span className="font-semibold text-slate-700">{hostShop.shop_name}</span>. Finish the steps below and you'll be ready to send your first quote.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-slate-900">Welcome — complete your profile</h1>
              <p className="text-sm text-slate-500 mt-1">
                Tell us about yourself so we can get you set up.
              </p>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 p-4 mb-5">
          <div className="text-base font-semibold text-slate-900 mb-4">Profile</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 mb-2">Name *</label>
              <input
                value={draft.full_name}
                onChange={(e) => updateDraft("full_name", e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
                autoFocus
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 mb-2">Email</label>
              <input
                value={user.email || ""}
                disabled
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-500"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Phone</label>
              <input
                value={draft.broker_phone}
                onChange={(e) => updateDraft("broker_phone", e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Company</label>
              <input
                value={draft.company_name}
                onChange={(e) => updateDraft("company_name", e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 mb-2">Address</label>
              <input
                value={draft.broker_address}
                onChange={(e) => updateDraft("broker_address", e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 mb-2">Notes</label>
              <textarea
                rows={3}
                value={draft.broker_notes}
                onChange={(e) => updateDraft("broker_notes", e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 p-4 mb-5">
          <div className="text-base font-semibold text-slate-900 mb-1">Create a password</div>
          <p className="text-xs text-slate-500 mb-4">
            You signed in from your invite email — now set a password so you can sign in directly next time.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Password *</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={9}
                  autoComplete="new-password"
                  className="w-full px-4 py-2.5 pr-11 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  placeholder="At least 9 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Confirm password *</label>
              <input
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={9}
                autoComplete="new-password"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="Re-type to confirm"
              />
            </div>
          </div>
        </div>

        <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mb-5">
          Your shop will verify resale certificates and W-9 separately — you don't need to upload those here.
        </div>

        {error && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2">
            {error}
          </div>
        )}
        {saved && (
          <div className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-2">
            Saved. Taking you to your dashboard…
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving || saved}
          className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white font-semibold py-3 rounded-xl transition"
        >
          {saving ? "Saving…" : saved ? "Saved" : "Save & Continue"}
        </button>
      </div>
    </div>
  );
}
