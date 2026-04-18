import { useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { uploadFile } from "@/lib/uploadFile";
import { Upload, FileText, CheckCircle2, AlertCircle, XCircle, FileWarning } from "lucide-react";

const DEFAULT_CREDENTIALS = [
  { type: "resale_certificate", title: "Resale Certificate",
    fields: ["number", "state", "expiration"] },
  { type: "w9", title: "W-9",
    fields: ["expiration"] },
  { type: "business_license", title: "Business License",
    fields: ["number", "state", "expiration"] },
];

function normalize(raw) {
  if (!Array.isArray(raw)) raw = [];
  return DEFAULT_CREDENTIALS.map((base) => {
    const match = raw.find((c) => c.type === base.type);
    return {
      type: base.type,
      title: base.title,
      number: match?.number ?? "",
      state: match?.state ?? "",
      expiration: match?.expiration ?? "",
      file: match?.file ?? "",
      file_name: match?.file_name ?? "",
      status: match?.status ?? "missing",
      verified_at: match?.verified_at ?? "",
      submitted_at: match?.submitted_at ?? "",
      fields: base.fields,
    };
  });
}

function statusPill(status) {
  const map = {
    verified: { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: CheckCircle2, label: "Verified" },
    pending:  { cls: "bg-amber-50 text-amber-700 border-amber-200", Icon: AlertCircle, label: "Pending review" },
    expired:  { cls: "bg-red-50 text-red-700 border-red-200", Icon: XCircle, label: "Expired" },
    rejected: { cls: "bg-red-50 text-red-700 border-red-200", Icon: XCircle, label: "Rejected" },
    missing:  { cls: "bg-slate-50 text-slate-500 border-slate-200", Icon: FileWarning, label: "Not uploaded" },
  };
  return map[status] || map.missing;
}

export default function BrokerCredentials({ user, onUpdate }) {
  const [creds, setCreds] = useState(() => normalize(user?.broker_credentials));
  const [savingIdx, setSavingIdx] = useState(null);
  const [uploadingIdx, setUploadingIdx] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function updateCred(idx, patch) {
    setCreds((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  async function handleFileUpload(idx, e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingIdx(idx);
    setError("");
    try {
      const { file_url } = await uploadFile(file);
      updateCred(idx, {
        file: file_url,
        file_name: file.name,
        status: "pending",
        submitted_at: new Date().toISOString(),
      });
      await persist(idx);
    } catch (err) {
      setError("Upload failed — try again.");
    } finally {
      setUploadingIdx(null);
      e.target.value = "";
    }
  }

  async function persist(idx) {
    setSavingIdx(idx);
    setError("");
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error("Not signed in");
      // Serialize without local-only `fields` array
      const toSave = creds.map((c) => {
        const { fields: _, ...rest } = c;
        return rest;
      });
      const { error: updErr } = await supabase
        .from("profiles")
        .update({ broker_credentials: toSave })
        .eq("auth_id", authUser.id);
      if (updErr) throw updErr;
      setMessage("Saved — your shop will be notified for review.");
      setTimeout(() => setMessage(""), 3000);
      onUpdate?.({ broker_credentials: toSave });
    } catch (err) {
      setError(err?.message || "Could not save.");
    } finally {
      setSavingIdx(null);
    }
  }

  async function handleSubmitRow(idx) {
    updateCred(idx, { status: "pending", submitted_at: new Date().toISOString() });
    await persist(idx);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Credentials</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Upload your compliance docs. Your shop admin will review and mark them verified.
        </p>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">{error}</div>
      )}
      {message && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2 text-sm text-emerald-700">{message}</div>
      )}

      <div className="space-y-3">
        {creds.map((c, idx) => {
          const pill = statusPill(c.status);
          const Icon = pill.Icon;
          const saving = savingIdx === idx;
          const uploading = uploadingIdx === idx;
          return (
            <div key={c.type} className="bg-white border border-slate-200 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-slate-400" />
                  <div>
                    <div className="font-semibold text-slate-900">{c.title}</div>
                    {c.file_name && (
                      <a
                        href={c.file}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-indigo-600 underline"
                      >
                        {c.file_name}
                      </a>
                    )}
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-2.5 py-1 border ${pill.cls}`}>
                  <Icon className="w-3.5 h-3.5" />
                  {pill.label}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 mb-4">
                {c.fields.includes("number") && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Number</label>
                    <input
                      value={c.number}
                      onChange={(e) => updateCred(idx, { number: e.target.value })}
                      disabled={c.status === "verified"}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-slate-50 disabled:text-slate-500"
                    />
                  </div>
                )}
                {c.fields.includes("state") && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">State</label>
                    <input
                      value={c.state}
                      onChange={(e) => updateCred(idx, { state: e.target.value })}
                      disabled={c.status === "verified"}
                      placeholder="CA"
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-slate-50 disabled:text-slate-500"
                    />
                  </div>
                )}
                {c.fields.includes("expiration") && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Expiration</label>
                    <input
                      type="date"
                      value={c.expiration || ""}
                      onChange={(e) => updateCred(idx, { expiration: e.target.value })}
                      disabled={c.status === "verified"}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-slate-50 disabled:text-slate-500"
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <label className={`flex items-center gap-2 cursor-pointer text-sm font-semibold px-3 py-2 rounded-lg border transition ${uploading ? "bg-slate-100 text-slate-400 border-slate-200" : "border-indigo-200 text-indigo-600 hover:bg-indigo-50"}`}>
                  <Upload className="w-4 h-4" />
                  {uploading ? "Uploading…" : (c.file ? "Replace File" : "Upload File")}
                  <input type="file" className="hidden" onChange={(e) => handleFileUpload(idx, e)} disabled={uploading} />
                </label>
                <button
                  onClick={() => handleSubmitRow(idx)}
                  disabled={saving || c.status === "verified"}
                  className="text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white px-3 py-2 rounded-lg"
                >
                  {saving ? "Saving…" : c.status === "verified" ? "Locked" : "Save details"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
