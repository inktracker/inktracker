// Color photo preview modal for the public OrderWizard — extracted verbatim
// from OrderWizard.jsx as part of a pure structural decomposition (zero
// behavior change). Presentational only.

// `colorPreview` is `{ colorName, images[], idx }` or null. `bc` is the shop
// brand color used to tint the active thumbnail tab.
export default function ColorPreviewModal({ colorPreview, setColorPreview, bc }) {
  if (!colorPreview) return null;
  const imgs = colorPreview.images || [];
  const previewIdx = colorPreview.idx || 0;
  const current = imgs[previewIdx];
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
      onClick={() => setColorPreview(null)}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-900">{colorPreview.colorName}</h3>
          <button onClick={() => setColorPreview(null)} className="text-slate-500 hover:text-slate-600 text-lg font-bold px-2">✕</button>
        </div>
        {imgs.length > 1 && (
          <div className="flex justify-center gap-1 px-5 pt-3">
            {imgs.map((img, i) => (
              <button key={i} onClick={() => setColorPreview(prev => ({ ...prev, idx: i }))}
                style={previewIdx === i ? { backgroundColor: bc } : undefined}
                className={`text-[11px] font-semibold px-3 py-1 rounded-lg transition ${previewIdx === i ? "text-white" : "border border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                {img.label || `View ${i + 1}`}
              </button>
            ))}
          </div>
        )}
        <div className="p-4">
          {current ? (
            <img src={current.url || current} alt={`${colorPreview.colorName} ${current.label || ""}`}
              className="w-full rounded-xl object-contain bg-slate-50" />
          ) : (
            <div className="text-center text-slate-500 py-8 text-sm">No photos available</div>
          )}
        </div>
      </div>
    </div>
  );
}
