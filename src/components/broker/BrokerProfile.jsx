import { useState } from "react";
import { base44 } from "@/api/supabaseClient";
import { User, Save, CheckCircle2, AlertCircle } from "lucide-react";
import BrokerCredentials from "./BrokerCredentials";

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
          <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center">
            <User className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <div className="font-bold text-slate-900">{user.display_name || user.full_name || "Broker"}</div>
            <div className="text-xs text-slate-400">{user.email} · Broker account</div>
          </div>
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
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
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
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
          />
        </div>

        {/* Save button */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
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

      <BrokerCredentials user={user} onUpdate={onUpdate} />
    </div>
  );
}