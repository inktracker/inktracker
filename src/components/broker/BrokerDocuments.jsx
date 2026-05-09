import { useState, useEffect } from "react";
import { base44 } from "@/api/supabaseClient";
import { uploadFile } from "@/lib/uploadFile";
import { Upload, FileText, Trash2, Download, Paperclip } from "lucide-react";

/**
 * Document sharing component.
 * If isAdmin=true, shows documents shared by the broker (read-only + delete by admin).
 * If isAdmin=false (broker view), broker can upload and delete their own docs.
 */
export default function BrokerDocuments({ brokerEmail, shopOwner, isAdmin = false }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!brokerEmail) return;
    const query = isAdmin
      ? { broker_id: brokerEmail, shop_owner: shopOwner }
      : { broker_id: brokerEmail };
    base44.entities.BrokerDocument.filter(query, "-created_date", 100)
      .then(d => { setDocs(d); })
      .catch(err => console.error("BrokerDocuments load failed:", err))
      .finally(() => setLoading(false));
  }, [brokerEmail, shopOwner, isAdmin]);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const { file_url } = await uploadFile(file);
    const doc = await base44.entities.BrokerDocument.create({
      broker_id: brokerEmail,
      shop_owner: shopOwner || "",
      name: file.name,
      file_url,
      file_type: file.type,
      note: note.trim(),
    });
    setDocs(prev => [doc, ...prev]);
    setNote("");
    setUploading(false);
    e.target.value = "";
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this document?")) return;
    await base44.entities.BrokerDocument.delete(id);
    setDocs(prev => prev.filter(d => d.id !== id));
  }

  return (
    <div className="space-y-4">
      {!isAdmin && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Upload Document</div>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Optional note (e.g. 'Art file for client X')"
            className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <label className={`flex items-center gap-2 cursor-pointer w-fit text-sm font-semibold px-4 py-2 rounded-xl border transition ${uploading ? "bg-slate-100 text-slate-400 border-slate-200" : "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700"}`}>
            <Upload className="w-4 h-4" />
            {uploading ? "Uploading…" : "Choose File & Upload"}
            <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
          </label>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-400">Loading documents…</div>
      ) : docs.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl py-14 text-center">
          <Paperclip className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">No documents yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map(doc => (
            <div key={doc.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="w-5 h-5 text-indigo-400 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800 text-sm truncate">{doc.name}</div>
                  {doc.note && <div className="text-xs text-slate-400 truncate">{doc.note}</div>}
                  <div className="text-xs text-slate-300 mt-0.5">{doc.created_date ? new Date(doc.created_date).toLocaleDateString() : ""}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={doc.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                  title="Download"
                >
                  <Download className="w-4 h-4" />
                </a>
                <button
                  onClick={() => handleDelete(doc.id)}
                  className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}