import { useState } from "react";
import { uploadCertificate, signCertificateUrl } from "@/lib/tax/certificateStorage";
import {
  EXEMPTION_TYPES, parseStateList,
  isExemptionExpired, isExemptionExpiringSoon,
} from "@/lib/tax/exemption";

// Exemption certificate capture (Phase 2 of multi-state tax). Shown when a
// customer is marked tax-exempt. Captures the basis (type), the certificate
// (number + document), where it applies (states), and when it expires — the
// record needed to defend the exemption in an audit. An expired cert is
// surfaced loudly because qbSync then collects tax until it's renewed.
export default function ExemptionFields({ value, onChange }) {
  const v = value || {};
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  // Local text mirror for the states input so in-progress typing isn't
  // clobbered by the parse-to-array round-trip. Init once (component is keyed
  // per customer at the call site, so this stays correct across edits).
  const [statesText, setStatesText] = useState(() =>
    Array.isArray(v.exemption_states) ? v.exemption_states.join(", ") : ""
  );

  const expired = isExemptionExpired(v);
  const expiringSoon = !expired && isExemptionExpiringSoon(v);

  const inputCls =
    "w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-300";

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadErr("");
    setUploading(true);
    try {
      // Private cert bucket (not the public artwork bucket) — certs carry a tax ID.
      const { path } = await uploadCertificate(file);
      onChange({ exemption_certificate_path: path });
    } catch (err) {
      setUploadErr(err?.message || "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = ""; // allow re-selecting the same file
    }
  }

  async function viewCert() {
    const url = await signCertificateUrl(v.exemption_certificate_path);
    if (url) window.open(url, "_blank", "noopener");
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2 bg-white/60 dark:bg-slate-900/40">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        Exemption Certificate
      </div>

      <div className="grid grid-cols-2 gap-2">
        <select
          value={v.exemption_type || ""}
          onChange={(e) => onChange({ exemption_type: e.target.value })}
          className={inputCls}
        >
          <option value="">Type…</option>
          {EXEMPTION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <input
          type="text"
          value={v.exemption_certificate_number || ""}
          onChange={(e) => onChange({ exemption_certificate_number: e.target.value })}
          placeholder="Certificate #"
          className={inputCls}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">Expires</label>
          <input
            type="date"
            value={v.exemption_expires_at || ""}
            onChange={(e) => onChange({ exemption_expires_at: e.target.value })}
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">States (blank = all)</label>
          <input
            type="text"
            value={statesText}
            onChange={(e) => {
              setStatesText(e.target.value);
              onChange({ exemption_states: parseStateList(e.target.value) });
            }}
            placeholder="CA, NV"
            className={`${inputCls} uppercase`}
          />
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs">
        {v.exemption_certificate_path ? (
          <>
            <span className="text-emerald-600 font-semibold">✓ Certificate attached</span>
            <button type="button" onClick={viewCert} className="text-teal-600 hover:text-teal-700 underline">View</button>
            <button
              type="button"
              onClick={() => onChange({ exemption_certificate_path: "" })}
              className="text-slate-400 hover:text-rose-600"
            >
              Remove
            </button>
          </>
        ) : (
          <label className="text-teal-600 hover:text-teal-700 underline cursor-pointer">
            {uploading ? "Uploading…" : "Attach certificate (PDF/image)"}
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              className="hidden"
              onChange={handleFile}
              disabled={uploading}
            />
          </label>
        )}
      </div>

      {uploadErr && <p className="text-[11px] text-rose-600">{uploadErr}</p>}
      {expired && (
        <p className="text-[11px] text-rose-600 font-semibold">
          ⚠ Certificate expired — sales tax will be collected until it's renewed.
        </p>
      )}
      {expiringSoon && (
        <p className="text-[11px] text-amber-600">Certificate expires soon — renew it to keep the exemption.</p>
      )}
    </div>
  );
}
