import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { base44, supabase } from "@/api/supabaseClient";

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const currentUser = await base44.auth.me();
      if (!currentUser) {
        await base44.auth.redirectToLogin();
        return;
      }
      setUser(currentUser);
      setDraft({
        full_name:      currentUser.full_name ?? "",
        broker_phone:   currentUser.broker_phone ?? currentUser.phone ?? "",
        company_name:   currentUser.company_name ?? "",
        broker_address: currentUser.broker_address ?? currentUser.address ?? "",
        broker_notes:   currentUser.broker_notes ?? currentUser.notes ?? "",
      });
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
    setError("");
    setSaving(true);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error("Not signed in");

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

  if (loading) return <div className="text-center text-slate-400 py-16">Loading…</div>;
  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Welcome — complete your profile</h1>
          <p className="text-sm text-slate-500 mt-1">
            Tell us about yourself so we can get you set up.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 p-4 mb-5">
          <div className="text-base font-semibold text-slate-900 mb-4">Profile</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 mb-2">Name *</label>
              <input
                value={draft.full_name}
                onChange={(e) => updateDraft("full_name", e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Company</label>
              <input
                value={draft.company_name}
                onChange={(e) => updateDraft("company_name", e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 mb-2">Address</label>
              <input
                value={draft.broker_address}
                onChange={(e) => updateDraft("broker_address", e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 mb-2">Notes</label>
              <textarea
                rows={3}
                value={draft.broker_notes}
                onChange={(e) => updateDraft("broker_notes", e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold py-3 rounded-xl transition"
        >
          {saving ? "Saving…" : saved ? "Saved" : "Save & Continue"}
        </button>
      </div>
    </div>
  );
}
