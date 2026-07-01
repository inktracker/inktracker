import { calcLinkedLinePrice, BIG_SIZES, SIZES, fmtMoney, fmtDate, getMinOrderQty, getWizardRushDisplay } from "@/components/shared/pricing";

// STEP 3: Review & Submit. Extracted verbatim from OrderWizard.jsx as a
// pure structural move. IMPORTANT: the per-garment price display below
// calls calcLinkedLinePrice with the EXACT same arguments the original
// inline JSX used — this is display-only pricing that was already living
// in the render and is relocated unchanged. All computed totals
// (liveTotals, total, livePpp, totalQtyAll) are computed in the parent
// and threaded in; nothing here alters cost/total math.
export default function ReviewStep({
  bc, bcDark,
  validGarments,
  imprints,
  artFiles,
  rush,
  contact,
  liveTotals,
  total,
  totalQtyAll,
  livePpp,
  submitError,
  submitting,
  handleSubmit,
  setStep,
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={()=>setStep(2)} className="text-slate-500 hover:text-slate-700 text-sm">← Back</button>
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">Review &amp; Submit</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="space-y-4">
          {/* Order summary — all garments */}
          {validGarments.map((gg, gIdx) => {
            const gQty = Object.values(gg.sizes).reduce((a,v) => a + (parseInt(v) || 0), 0);
            return (
              <div key={gg.id} className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
                <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                  {validGarments.length > 1 ? `Garment ${gIdx + 1}` : "Order Summary"}
                </div>
                <div className="flex justify-between text-sm"><span className="text-slate-500">Style</span><span className="font-semibold">{gg.style.name}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-500">Color</span><span className="font-semibold">{gg.color}</span></div>
                <div className="border-t border-slate-100 pt-2">
                  <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">Sizes</div>
                  <div className="flex flex-wrap gap-1.5">
                    {SIZES.filter(sz => (parseInt(gg.sizes[sz]) || 0) > 0).map(sz => (
                      <span key={sz} className={`text-xs font-semibold px-2 py-1 rounded-lg border ${BIG_SIZES.includes(sz) ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-slate-50 border-slate-200 text-slate-600"}`}>
                        {sz}: {gg.sizes[sz]}
                      </span>
                    ))}
                    <span className="text-xs text-slate-500 ml-1">({gQty} pcs)</span>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Shared run-level prints + artwork — one block, applies
              to every garment above. */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
            <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Prints (whole run)</div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Locations</span>
              <span className="font-semibold text-right">{imprints.map(i => `${i.location} (${i.colors}c ${i.technique})`).join(", ")}</span>
            </div>
            {Object.keys(artFiles || {}).length > 0 && (
              <div className="border-t border-slate-100 pt-2">
                <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">Artwork</div>
                {Object.entries(artFiles).map(([idx, f]) => (
                  <div key={idx} className="flex items-center gap-1.5 text-xs text-slate-600">
                    <span className="text-emerald-500">✓</span>
                    <span className="text-slate-500">{imprints[idx]?.location}:</span>
                    <span className="font-medium truncate">{f.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-between text-sm bg-white rounded-2xl border border-slate-100 p-5">
            <span className="text-slate-500">Turnaround</span>
            <span className={`font-semibold ${rush ? "text-orange-600" : ""}`}>{rush ? "Rush — 7 days" : "Standard — 14 days"}</span>
          </div>

          {/* Contact */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-1.5 text-sm">
            <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Contact</div>
            <div className="flex justify-between"><span className="text-slate-500">Name</span><span className="font-semibold">{contact.name}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Email</span><span className="font-semibold">{contact.email}</span></div>
            {contact.phone && <div className="flex justify-between"><span className="text-slate-500">Phone</span><span className="font-semibold">{contact.phone}</span></div>}
            {contact.company && <div className="flex justify-between"><span className="text-slate-500">Company</span><span className="font-semibold">{contact.company}</span></div>}
            {contact.dueDate && <div className="flex justify-between"><span className="text-slate-500">In-Hands</span><span className="font-semibold">{fmtDate(contact.dueDate)}</span></div>}
          </div>
        </div>

        {/* Pricing total */}
        <div className="bg-slate-900 rounded-2xl overflow-hidden">
          <div className="bg-slate-800 px-5 py-3 border-b border-slate-700">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Pricing Summary</div>
          </div>
          <div className="p-5 space-y-0">
            {validGarments.map((gg) => {
              const gQty = Object.values(gg.sizes).reduce((a,v) => a + (parseInt(v) || 0), 0);
              return (
                <div key={gg.id} className="flex justify-between py-2 border-b border-slate-800 text-xs">
                  <span className="text-slate-500">{gg.style.name} · {gg.color} ({gQty} pcs)</span>
                  <span className="text-white font-semibold">
                    {(() => {
                      const gPrice = calcLinkedLinePrice(
                        { garmentCost: gg.style.garmentCost, sizes: gg.sizes, imprints: imprints.length ? imprints : [{colors:1}] },
                        rush ? getWizardRushDisplay().rate : 0, {}, undefined, {}
                      );
                      return gPrice ? fmtMoney(gPrice.lineTotal) : "—";
                    })()}
                  </span>
                </div>
              );
            })}
            {rush && (
              <div className="flex justify-between py-2 border-b border-slate-800 text-xs">
                <span className="text-orange-400 uppercase tracking-wide">Rush Fee (+20%)</span>
                <span className="text-orange-400 font-semibold">included</span>
              </div>
            )}
          </div>
          <div style={{ backgroundColor: bcDark }} className="px-5 py-5 flex justify-between items-center">
            <div>
              <div className="text-xs font-bold text-white/80 uppercase tracking-widest mb-0.5">Estimated Total</div>
              <div className="text-white/70 text-xs">{totalQtyAll > 0 ? `${totalQtyAll} pcs` : `${getMinOrderQty()} pcs (est.)`} · {fmtMoney(livePpp)}/pc</div>
              <div className="text-white/80 text-xs mt-1">*Final quote confirmed after art review</div>
            </div>
            <div className="text-4xl font-bold text-white">{fmtMoney(liveTotals?.total || total)}</div>
          </div>
          <div className="p-5">
            {submitError && (
              <div role="alert" className="mb-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                {submitError}
              </div>
            )}
            <button onClick={handleSubmit}
              disabled={submitting}
              style={{ backgroundColor: bc }}
              className="w-full hover:opacity-90 text-white font-bold py-3.5 rounded-xl transition text-sm disabled:opacity-50 disabled:cursor-not-allowed">
              {submitting ? "Submitting..." : "Submit Order Request →"}
            </button>
            <p className="text-xs text-slate-500 text-center mt-3">We'll confirm your order within 1 business day. No payment required now.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
