import { useState } from "react";
import { uploadFile } from "@/lib/uploadFile";
import { filterAndSortClients } from "@/lib/broker/clientFilter";
import ModalBackdrop from "../shared/ModalBackdrop";
import {
  Users,
  Search,
  Upload,
  Paperclip,
  Trash2,
  ExternalLink,
} from "lucide-react";

const FIELDS = [
  { key: "name", label: "Name *", placeholder: "Jane Smith" },
  { key: "company", label: "Company / Org", placeholder: "Company name" },
  {
    key: "email",
    label: "Email",
    placeholder: "jane@example.com",
    type: "email",
  },
  {
    key: "phone",
    label: "Phone",
    placeholder: "(555) 555-0000",
    type: "tel",
  },
  { key: "address", label: "Address", placeholder: "123 Main St" },
  { key: "notes", label: "Notes", placeholder: "Terms, preferences…" },
  { key: "tax_id", label: "Tax ID", placeholder: "12-3456789" },
];

const EMPTY = {
  name: "",
  company: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
  tax_id: "",
  tax_exempt: false,
  artwork_files: [],
};

function newArtwork(file, fileUrl, note = "") {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    url: fileUrl,
    type: file.type || "",
    note: note.trim(),
    uploaded_at: new Date().toISOString(),
  };
}

export default function BrokerClientList({ clients, onAdd, onEdit, onDelete }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({});
  const [uploadingArtwork, setUploadingArtwork] = useState(false);
  const [artNote, setArtNote] = useState("");

  const filtered = filterAndSortClients(clients, { search, filters });

  function handleAdd() {
    if (!form.name.trim()) return;
    onAdd({ ...form, artwork_files: form.artwork_files || [] });
    setForm(EMPTY);
    setShowForm(false);
  }

  function handleSaveEdit() {
    if (!editing.name.trim()) return;
    onEdit(editing.id, {
      ...editing,
      artwork_files: editing.artwork_files || [],
    });
    setEditing(null);
    setConfirmDel(false);
    setArtNote("");
  }

  function handleDelete() {
    onDelete(editing.id);
    setEditing(null);
    setConfirmDel(false);
    setArtNote("");
  }

  async function handleArtworkUpload(e) {
    const file = e.target.files?.[0];
    if (!file || !editing?.id) return;

    try {
      setUploadingArtwork(true);

      const { file_url } = await uploadFile(file);
      const nextArtwork = [
        ...(editing.artwork_files || []),
        newArtwork(file, file_url, artNote),
      ];

      const nextClient = {
        ...editing,
        artwork_files: nextArtwork,
      };

      await onEdit(editing.id, nextClient);
      setEditing(nextClient);
      setArtNote("");
    } catch (error) {
      console.error("Artwork upload failed:", error);
      alert("There was a problem uploading the artwork.");
    } finally {
      setUploadingArtwork(false);
      e.target.value = "";
    }
  }

  async function handleRemoveArtwork(artworkId) {
    if (!editing?.id) return;
    if (!window.confirm("Remove this artwork file from the client?")) return;

    const nextClient = {
      ...editing,
      artwork_files: (editing.artwork_files || []).filter(
        (a) => a.id !== artworkId
      ),
    };

    await onEdit(editing.id, nextClient);
    setEditing(nextClient);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clients…"
              className="pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300 w-56"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!filters.taxExempt}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  taxExempt: e.target.checked || undefined,
                }))
              }
              className="w-4 h-4 accent-indigo-600"
            />
            Tax Exempt Only
          </label>
        </div>

        <button
          onClick={() => {
            setShowForm((v) => !v);
            setForm(EMPTY);
          }}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition shadow-sm"
        >
          {showForm ? "✕ Cancel" : "+ Add Client"}
        </button>
      </div>

      {showForm && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5 space-y-3">
          <div className="text-xs font-bold text-indigo-700 uppercase tracking-widest">
            New Client
          </div>

          <div className="grid gap-3 grid-cols-2">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  {f.label}
                </label>
                <input
                  type={f.type || "text"}
                  value={form[f.key]}
                  onChange={(e) =>
                    setForm({ ...form, [f.key]: e.target.value })
                  }
                  placeholder={f.placeholder}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="new_tax_exempt"
              checked={form.tax_exempt}
              onChange={(e) =>
                setForm({ ...form, tax_exempt: e.target.checked })
              }
              className="w-4 h-4 accent-indigo-600"
            />
            <label
              htmlFor="new_tax_exempt"
              className="text-sm font-semibold text-slate-600"
            >
              Tax Exempt
            </label>
          </div>

          <button
            onClick={handleAdd}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
          >
            Add Client
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 py-16 text-center">
          <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-slate-400 text-sm">
            {search
              ? "No clients match your search."
              : "No clients yet. Add your first client above."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-100 to-indigo-200 text-indigo-700 font-bold text-sm flex items-center justify-center flex-shrink-0">
                  {c.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                </div>
                <div>
                  <div className="font-bold text-slate-800 text-sm">{c.name}</div>
                  {c.company && <div className="text-xs text-slate-400">{c.company}</div>}
                </div>
              </div>

              <div className="text-xs text-slate-500 space-y-1.5 mb-4">
                {c.email && (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">✉</span>
                    {c.email}
                  </div>
                )}
                {c.phone && (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">☎</span>
                    {c.phone}
                  </div>
                )}
              </div>

              <div className="mb-3 text-xs text-slate-500 bg-slate-50 rounded-lg border border-slate-200 px-3 py-2">
                Artwork files: <span className="font-bold text-slate-700">{(c.artwork_files || []).length}</span>
              </div>

              <div className="flex gap-3 border-t border-slate-100 pt-3 items-center">
                {c.tax_exempt && (
                  <span className="text-xs font-semibold text-purple-600 bg-purple-50 border border-purple-100 px-2 py-0.5 rounded-full">
                    Tax Exempt
                  </span>
                )}

                <button
                  onClick={() => {
                    setEditing({
                      ...c,
                      artwork_files: c.artwork_files || [],
                    });
                    setConfirmDel(false);
                    setArtNote("");
                  }}
                  className="ml-auto text-xs text-slate-400 hover:text-slate-600 border border-slate-200 hover:border-slate-300 px-2.5 py-1 rounded-lg transition"
                >
                  Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ModalBackdrop
          onClose={() => { setEditing(null); setConfirmDel(false); setArtNote(""); }}
          z="z-50"
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-slate-900">Edit Client</h3>
              <button
                onClick={() => {
                  setEditing(null);
                  setConfirmDel(false);
                  setArtNote("");
                }}
                className="text-slate-400 hover:text-slate-600 text-lg"
              >
                ✕
              </button>
            </div>

            <div className="grid gap-3 grid-cols-2">
              {FIELDS.map((f) => (
                <div key={f.key}>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    {f.label}
                  </label>
                  <input
                    type={f.type || "text"}
                    value={editing[f.key] || ""}
                    onChange={(e) =>
                      setEditing({ ...editing, [f.key]: e.target.value })
                    }
                    placeholder={f.placeholder}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="edit_tax_exempt"
                checked={!!editing.tax_exempt}
                onChange={(e) =>
                  setEditing({ ...editing, tax_exempt: e.target.checked })
                }
                className="w-4 h-4 accent-indigo-600"
              />
              <label
                htmlFor="edit_tax_exempt"
                className="text-sm font-semibold text-slate-600"
              >
                Tax Exempt
              </label>
            </div>

            {/* Saved Imprints Editor */}
            <div className="border border-slate-200 rounded-2xl p-4 space-y-3">
              <div className="flex justify-between items-center">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Saved Imprints</div>
                <button
                  onClick={() => setEditing({
                    ...editing,
                    saved_imprints: [...(editing.saved_imprints || []), { title: "", location: "Front", width: "", height: "", colors: 1, technique: "Screen Print", pantones: "" }]
                  })}
                  className="text-xs font-semibold text-indigo-600 border border-indigo-200 px-2.5 py-1 rounded-lg hover:bg-indigo-50 transition"
                >
                  + Add Imprint
                </button>
              </div>

              {(editing.saved_imprints || []).length === 0 ? (
                <div className="text-sm text-slate-400 border border-dashed border-slate-200 rounded-xl p-4 text-center">
                  No saved imprints yet. They are added automatically when saving quotes.
                </div>
              ) : (
                <div className="space-y-2">
                  {(editing.saved_imprints || []).map((imp, i) => (
                    <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                      <div className="flex gap-2 flex-wrap">
                        <div className="flex-1 min-w-28">
                          <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-0.5">Title</label>
                          <input
                            value={imp.title || ""}
                            onChange={(e) => {
                              const updated = [...editing.saved_imprints];
                              updated[i] = { ...updated[i], title: e.target.value };
                              setEditing({ ...editing, saved_imprints: updated });
                            }}
                            placeholder="e.g. Front Logo"
                            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          />
                        </div>
                        <div className="w-28">
                          <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-0.5">Location</label>
                          <select
                            value={imp.location || "Front"}
                            onChange={(e) => {
                              const updated = [...editing.saved_imprints];
                              updated[i] = { ...updated[i], location: e.target.value };
                              setEditing({ ...editing, saved_imprints: updated });
                            }}
                            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none"
                          >
                            {["Front","Back","Left Chest","Right Chest","Left Sleeve","Right Sleeve","Pocket","Hood","Other"].map(l => <option key={l}>{l}</option>)}
                          </select>
                        </div>
                        <div className="w-16">
                          <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-0.5">Width</label>
                          <input
                            value={imp.width || ""}
                            onChange={(e) => {
                              const updated = [...editing.saved_imprints];
                              updated[i] = { ...updated[i], width: e.target.value };
                              setEditing({ ...editing, saved_imprints: updated });
                            }}
                            placeholder='4"'
                            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          />
                        </div>
                        <div className="w-16">
                          <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-0.5">Height</label>
                          <input
                            value={imp.height || ""}
                            onChange={(e) => {
                              const updated = [...editing.saved_imprints];
                              updated[i] = { ...updated[i], height: e.target.value };
                              setEditing({ ...editing, saved_imprints: updated });
                            }}
                            placeholder='2"'
                            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          />
                        </div>
                        <div className="w-16">
                          <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-0.5">Colors</label>
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
                            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          />
                        </div>
                        <div className="w-28">
                          <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-0.5">Technique</label>
                          <select
                            value={imp.technique || "Screen Print"}
                            onChange={(e) => {
                              const updated = [...editing.saved_imprints];
                              updated[i] = { ...updated[i], technique: e.target.value };
                              setEditing({ ...editing, saved_imprints: updated });
                            }}
                            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none"
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

            <div className="border-t border-slate-100 pt-5 space-y-4">
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                  Client Artwork
                </div>
                <p className="text-sm text-slate-500">
                  Upload art files here so they can be reused when writing quotes.
                </p>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                <input
                  type="text"
                  value={artNote}
                  onChange={(e) => setArtNote(e.target.value)}
                  placeholder="Optional note (e.g. Front chest logo, vector source, etc.)"
                  className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />

                <label
                  className={`inline-flex items-center gap-2 cursor-pointer text-sm font-semibold px-4 py-2 rounded-xl border transition ${
                    uploadingArtwork
                      ? "bg-slate-100 text-slate-400 border-slate-200"
                      : "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700"
                  }`}
                >
                  <Upload className="w-4 h-4" />
                  {uploadingArtwork ? "Uploading…" : "Upload Artwork"}
                  <input
                    type="file"
                    className="hidden"
                    onChange={handleArtworkUpload}
                    disabled={uploadingArtwork}
                  />
                </label>
              </div>

              {(editing.artwork_files || []).length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl py-10 text-center">
                  <Paperclip className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400">
                    No artwork files saved yet.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {(editing.artwork_files || []).map((art) => (
                    <div
                      key={art.id}
                      className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-slate-800 truncate">
                          {art.name}
                        </div>
                        {art.note && (
                          <div className="text-xs text-slate-400 truncate">
                            {art.note}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <a
                          href={art.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                          title="Open artwork"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>

                        <button
                          onClick={() => handleRemoveArtwork(art.id)}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                          title="Remove artwork"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {confirmDel ? (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                <p className="text-sm font-semibold text-red-700">
                  Are you sure you want to delete this client? This cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleDelete}
                    className="bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
                  >
                    Yes, Delete
                  </button>
                  <button
                    onClick={() => setConfirmDel(false)}
                    className="text-slate-600 border border-slate-200 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-slate-50 transition"
                  >
                    No, Go Back
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleSaveEdit}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
                >
                  Save Changes
                </button>

                <button
                  onClick={() => setConfirmDel(true)}
                  className="ml-auto text-red-500 border border-red-200 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-red-50 transition"
                >
                  Delete Client
                </button>
              </div>
            )}
          </div>
        </ModalBackdrop>
      )}
    </div>
  );
}