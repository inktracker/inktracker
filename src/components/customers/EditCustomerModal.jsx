import { openSignedArtwork } from "@/lib/uploadFile";
import { normalizeShipTo } from "@/lib/tax/address";
import ModalBackdrop from "@/components/shared/ModalBackdrop";
import AddressFields from "@/components/shared/AddressFields";
import ExemptionFields from "@/components/customers/ExemptionFields";

// The Edit Customer modal — fields, addresses, exemption, payment terms,
// saved imprints editor, artwork library, and the delete confirm. Pure move
// of the JSX out of Customers.jsx; parent owns `editing` state and every
// handler threaded in below.
export default function EditCustomerModal({
  editing,
  setEditing,
  confirmDelete,
  setConfirmDelete,
  artworkNote,
  setArtworkNote,
  artworkColorCount,
  setArtworkColorCount,
  handleSaveEdit,
  editSaving,
  editSaved,
  handleDelete,
  handleArtworkUpload,
  uploadingArtwork,
  currentEditingArtwork,
  handleRemoveArtwork,
}) {
  return (
    <ModalBackdrop
      onClose={() => {
        setEditing(null);
        setConfirmDelete(false);
        setArtworkNote("");
        setArtworkColorCount("");
      }}
      z="z-50"
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl p-6 space-y-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Edit Customer</h3>
          <button
            onClick={() => {
              setEditing(null);
              setConfirmDelete(false);
              setArtworkNote("");
              setArtworkColorCount("");
            }}
            className="text-slate-500 hover:text-slate-600 text-lg"
          >
            ✕
          </button>
        </div>

        <div className="grid gap-3 grid-cols-2">
          {[
            { key: "name", label: "Name *", placeholder: "Jane Smith" },
            { key: "company", label: "Company / Org", placeholder: "Company name" },
            { key: "email", label: "Email", placeholder: "jane@example.com" },
            { key: "phone", label: "Phone", placeholder: "(775) 555-0000" },
            { key: "notes", label: "Notes", placeholder: "Terms, preferences…" },
            { key: "tax_id", label: "Tax ID", placeholder: "12-3456789" },
          ].map((f) => (
            <div key={f.key}>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                {f.label}
              </label>
              <input
                value={editing[f.key] || ""}
                onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300"
              />
            </div>
          ))}
        </div>

        <AddressFields
          label="Billing Address"
          value={editing.bill_to_address}
          onChange={(next) => setEditing({ ...editing, bill_to_address: next })}
        />

        <AddressFields
          label="Shipping Address"
          sublabel="used to calculate sales tax"
          taxHint
          value={editing.ship_to_address}
          onChange={(next) => setEditing({ ...editing, ship_to_address: next })}
          onSameAsBilling={() => setEditing({ ...editing, ship_to_address: normalizeShipTo(editing.bill_to_address) })}
        />

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="tax_exempt_edit"
            checked={!!editing.tax_exempt}
            onChange={(e) => {
              const checked = e.target.checked;
              setEditing({
                ...editing,
                tax_exempt: checked,
                ...(checked ? {} : {
                  exemption_type: "", exemption_certificate_number: "",
                  exemption_certificate_path: "", exemption_expires_at: "", exemption_states: null,
                }),
              });
            }}
            className="w-4 h-4 accent-teal-600"
          />
          <label htmlFor="tax_exempt_edit" className="text-sm font-semibold text-slate-600">
            Tax Exempt
          </label>
        </div>

        {editing.tax_exempt && (
          <ExemptionFields
            key={`exempt-${editing.id || "new"}`}
            value={editing}
            onChange={(patch) => setEditing({ ...editing, ...patch })}
          />
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600 uppercase tracking-widest">Default Payment Terms</label>
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="payment_terms_edit"
                checked={Number(editing.default_deposit_pct || 0) === 0}
                onChange={() => setEditing({ ...editing, default_deposit_pct: 0 })}
                className="accent-teal-600"
              />
              Pay in full
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="payment_terms_edit"
                checked={Number(editing.default_deposit_pct || 0) > 0}
                onChange={() => setEditing({ ...editing, default_deposit_pct: 50 })}
                className="accent-teal-600"
              />
              Deposit
            </label>
            {Number(editing.default_deposit_pct || 0) > 0 && (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={editing.default_deposit_pct}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    setEditing({ ...editing, default_deposit_pct: Number.isFinite(v) ? Math.max(1, Math.min(100, v)) : 50 });
                  }}
                  className="w-14 text-xs text-center border border-slate-200 dark:border-slate-700 rounded px-1.5 py-1"
                />
                <span className="text-slate-500">%</span>
              </div>
            )}
          </div>
        </div>

        {/* Saved Imprints Editor */}
        <div className="border border-slate-200 dark:border-slate-700 rounded-2xl p-4 space-y-3">
          <div className="flex justify-between items-center">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Saved Imprints</div>
            <button
              onClick={() => setEditing({
                ...editing,
                saved_imprints: [...(editing.saved_imprints || []), { title: "", location: "Front", width: "", height: "", colors: 1, technique: "Screen Print", pantones: "" }]
              })}
              className="text-xs font-semibold text-teal-600 border border-teal-200 px-2.5 py-1 rounded-lg hover:bg-teal-50 transition"
            >
              + Add Imprint
            </button>
          </div>

          {(editing.saved_imprints || []).length === 0 ? (
            <div className="text-sm text-slate-500 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-4 text-center">
              No saved imprints yet. They are added automatically when saving quotes.
            </div>
          ) : (
            <div className="space-y-2">
              {(editing.saved_imprints || []).map((imp, i) => (
                <div key={i} className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 space-y-2">
                  <div className="flex gap-2 flex-wrap">
                    <div className="flex-1 min-w-28">
                      <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Title</label>
                      <input
                        value={imp.title || ""}
                        onChange={(e) => {
                          const updated = [...editing.saved_imprints];
                          updated[i] = { ...updated[i], title: e.target.value };
                          setEditing({ ...editing, saved_imprints: updated });
                        }}
                        placeholder="e.g. Front Logo"
                        className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300"
                      />
                    </div>
                    <div className="w-28">
                      <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Location</label>
                      <select
                        value={imp.location || "Front"}
                        onChange={(e) => {
                          const updated = [...editing.saved_imprints];
                          updated[i] = { ...updated[i], location: e.target.value };
                          setEditing({ ...editing, saved_imprints: updated });
                        }}
                        className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-900 focus:outline-none"
                      >
                        {["Front","Back","Left Chest","Right Chest","Left Sleeve","Right Sleeve","Pocket","Hood","Other"].map(l => <option key={l}>{l}</option>)}
                      </select>
                    </div>
                    <div className="w-16">
                      <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Width</label>
                      <input
                        value={imp.width || ""}
                        onChange={(e) => {
                          const updated = [...editing.saved_imprints];
                          updated[i] = { ...updated[i], width: e.target.value };
                          setEditing({ ...editing, saved_imprints: updated });
                        }}
                        placeholder='4"'
                        className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300"
                      />
                    </div>
                    <div className="w-16">
                      <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Height</label>
                      <input
                        value={imp.height || ""}
                        onChange={(e) => {
                          const updated = [...editing.saved_imprints];
                          updated[i] = { ...updated[i], height: e.target.value };
                          setEditing({ ...editing, saved_imprints: updated });
                        }}
                        placeholder='2"'
                        className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300"
                      />
                    </div>
                    <div className="w-16">
                      <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Colors</label>
                      <input
                        type="number"
                        min="1"
                        max="8"
                        value={imp.colors || 1}
                        onChange={(e) => {
                          const updated = [...editing.saved_imprints];
                          updated[i] = { ...updated[i], colors: parseInt(e.target.value) || 1 };
                          setEditing({ ...editing, saved_imprints: updated });
                        }}
                        className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300"
                      />
                    </div>
                    <div className="w-28">
                      <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Technique</label>
                      <select
                        value={imp.technique || "Screen Print"}
                        onChange={(e) => {
                          const updated = [...editing.saved_imprints];
                          updated[i] = { ...updated[i], technique: e.target.value };
                          setEditing({ ...editing, saved_imprints: updated });
                        }}
                        className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-900 focus:outline-none"
                      >
                        {["Screen Print","DTG","Embroidery","DTF","Heat Transfer","Sublimation"].map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <button
                      onClick={() => {
                        const updated = (editing.saved_imprints || []).filter((_, idx) => idx !== i);
                        setEditing({ ...editing, saved_imprints: updated });
                      }}
                      className="text-slate-300 hover:text-red-400 text-xs mt-4 transition"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border border-slate-200 dark:border-slate-700 rounded-2xl p-4 space-y-4">
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">
              Customer Artwork Library
            </div>
            <div className="text-sm text-slate-500 mt-1">
              These files are stored in BrokerDocument so they survive page reloads.
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 space-y-3">
            <input
              type="text"
              value={artworkNote}
              onChange={(e) => setArtworkNote(e.target.value)}
              placeholder="Optional note (example: Front chest logo)"
              className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400"
            />

            <input
              type="number"
              min="1"
              max="12"
              value={artworkColorCount}
              onChange={(e) => setArtworkColorCount(e.target.value)}
              placeholder="Production color count (example: 3)"
              className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400"
            />

            <div className="text-xs text-slate-500">
              Set the production color count once here so quotes can auto-fill imprint pricing later.
            </div>

            <label
              className={`flex items-center gap-2 cursor-pointer w-fit text-sm font-semibold px-4 py-2 rounded-xl border transition ${
                uploadingArtwork
                  ? "bg-slate-100 text-slate-500 border-slate-200 dark:border-slate-700"
                  : "bg-teal-600 text-white border-teal-600 hover:bg-teal-700"
              }`}
            >
              {uploadingArtwork ? "Uploading…" : "Choose File & Upload Artwork"}
              <input
                type="file"
                className="hidden"
                onChange={handleArtworkUpload}
                disabled={uploadingArtwork}
              />
            </label>
          </div>

          {currentEditingArtwork.length === 0 ? (
            <div className="text-sm text-slate-500 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-6 text-center">
              No artwork saved for this client yet.
            </div>
          ) : (
            <div className="space-y-2">
              {currentEditingArtwork.map((art) => (
                <div
                  key={art.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800 dark:text-slate-200 text-sm truncate">
                      {art.name}
                    </div>
                    {art.note && (
                      <div className="text-xs text-slate-500 truncate">{art.note}</div>
                    )}
                    <div className="flex flex-wrap gap-2 mt-1">
                      {art.colors ? (
                        <span className="text-[11px] font-semibold text-teal-700 bg-teal-50 border border-teal-100 px-2 py-0.5 rounded-full">
                          {art.colors} color{String(art.colors) === "1" ? "" : "s"}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-500">
                          No color count set
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-300 mt-0.5">
                      {art.uploaded_at
                        ? new Date(art.uploaded_at).toLocaleDateString()
                        : ""}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={art.url}
                      onClick={(e) => { e.preventDefault(); openSignedArtwork(art.path || art.url); }}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-teal-600 border border-teal-200 px-3 py-1.5 rounded-lg hover:bg-teal-50 transition"
                    >
                      Open
                    </a>
                    <button
                      onClick={() => handleRemoveArtwork(art.id)}
                      className="text-xs font-semibold text-red-500 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {confirmDelete ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold text-red-700">
              Are you sure you want to delete this client? This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => handleDelete(editing.id)}
                className="bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
              >
                Yes, Delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-slate-600 border border-slate-200 dark:border-slate-700 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-slate-50 dark:bg-slate-800 transition"
              >
                No, Go Back
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2 pt-2 items-center">
            <button
              onClick={handleSaveEdit}
              disabled={editSaving}
              className="bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
            >
              {editSaving ? "Saving…" : "Save Changes"}
            </button>
            {editSaved && (
              <span className="text-sm font-semibold text-emerald-600 flex items-center gap-1">
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4L8.5 12l6.8-6.7a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
                Saved
              </span>
            )}
            <button
              onClick={() => setConfirmDelete(true)}
              className="ml-auto text-red-400 border border-red-200 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-red-50 transition"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}
