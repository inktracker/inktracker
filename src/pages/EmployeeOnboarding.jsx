// Employee onboarding — fires when a freshly invited employee clicks
// the magic link in their welcome email. Mirrors BrokerOnboarding but
// trimmed: employees just need a name + password before being dropped
// onto /ShopFloor. No company / address / notes (those are broker
// fields the shop owner verifies separately).
//
// Without this page, employees clicked Accept Invite → got magic-link-
// authed → landed on /ShopFloor → the email+password sign-in form
// rejected them because they had no password yet. They were stuck.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { base44, supabase } from "@/api/supabaseClient";

export default function EmployeeOnboarding() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [fullName, setFullName] = useState("");
  // Password creation is required here — see BrokerOnboarding for the
  // same reasoning (magic links are one-shot; without a real password
  // the employee can never sign in to /ShopFloor again).
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

      // Already finished onboarding? Skip to ShopFloor. Same has_password
      // gate as BrokerOnboarding — Supabase's email_verified flips true
      // the instant the magic link fires, so we can't use that as the
      // signal. has_password is set by handleSave below.
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (currentUser.full_name?.trim() && authUser?.user_metadata?.has_password) {
          window.location.assign("/ShopFloor");
          return;
        }
      } catch {
        // Don't block onboarding on a check failure — let them complete the form.
      }

      setUser(currentUser);
      setFullName(currentUser.full_name ?? "");

      // Show which shop invited them so the page doesn't feel anonymous.
      const assignedShop = Array.isArray(currentUser.assigned_shops) ? currentUser.assigned_shops[0] : null;
      if (assignedShop) {
        try {
          const shopProfile = await base44.entities.User.filter({ email: assignedShop });
          if (Array.isArray(shopProfile) && shopProfile[0]) {
            setHostShop(shopProfile[0]);
          }
        } catch {
          // Best-effort: missing shop context is okay.
        }
      }

      setLoading(false);
    }
    load();
  }, []);

  async function handleSave() {
    if (!fullName.trim()) {
      setError("Your name is required.");
      return;
    }
    if (password.length < 6) {
      setError("Set a password (at least 6 characters) so you can sign in later.");
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

      // Set password BEFORE profile update — if this fails (expired
      // session, weak password), we want to know before partially saving.
      // has_password metadata is what the redirect check above reads.
      const { error: pwErr } = await supabase.auth.updateUser({
        password,
        data: { has_password: true },
      });
      if (pwErr) throw pwErr;

      const updates = { full_name: fullName.trim() };

      const { data: byAuth, error: authErr } = await supabase
        .from("profiles")
        .update(updates)
        .eq("auth_id", authUser.id)
        .select("id");
      if (authErr) throw authErr;

      // Email-fallback for legacy rows pre-created with auth_id=null.
      // Backfills auth_id so future lookups work.
      if (!byAuth || byAuth.length === 0) {
        const { error: emailErr } = await supabase
          .from("profiles")
          .update({ ...updates, auth_id: authUser.id })
          .eq("email", authUser.email);
        if (emailErr) throw emailErr;
      }

      setSaved(true);
      setTimeout(() => navigate("/ShopFloor"), 1200);
    } catch (err) {
      setError(err?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-center text-slate-400 py-16">Loading…</div>;
  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-md mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
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
                  Welcome to {hostShop.shop_name}
                </div>
              </div>
              <h1 className="text-2xl font-bold text-slate-900">Set up your account</h1>
              <p className="text-sm text-slate-500 mt-1">
                Tell us your name and pick a password — then you'll be ready to use the Shop Floor.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-slate-900">Set up your account</h1>
              <p className="text-sm text-slate-500 mt-1">
                Tell us your name and pick a password to finish setting up.
              </p>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 p-4 mb-5 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Name *</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Email</label>
            <input
              value={user.email || ""}
              disabled
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-500"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 p-4 mb-5">
          <div className="text-base font-semibold text-slate-900 mb-1">Create a password</div>
          <p className="text-xs text-slate-500 mb-4">
            You signed in from your invite email — set a password so you can sign in directly to the Shop Floor next time.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Password *</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  autoComplete="new-password"
                  className="w-full px-4 py-2.5 pr-11 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  placeholder="At least 6 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
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
                minLength={6}
                autoComplete="new-password"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="Re-type to confirm"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2">
            {error}
          </div>
        )}
        {saved && (
          <div className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-2">
            Saved. Taking you to the Shop Floor…
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
