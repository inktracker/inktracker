import { fmtMoney, getMinOrderQty } from "@/components/shared/pricing";
import { summarizeImprints } from "@/components/wizard/steps/wizardHelpers";

// Desktop pricing side panel + mobile bottom pricing bar. Extracted
// verbatim from OrderWizard.jsx as a pure structural move. All numeric
// values (liveTotals, livePerGarmentPpp, livePpp, totalAllQty) are
// computed in the parent and threaded in — this component performs NO
// pricing / cost math, it only renders the numbers it's given.
export default function PriceSidebar({
  bcDark, bcDarker,
  showPriceSummary,
  garments,
  imprints,
  totalAllQty,
  liveTotals,
  livePerGarmentPpp,
  livePpp,
  rush,
  enrichingStyle,
}) {
  return (
    <>
      {/* RIGHT COLUMN — desktop pricing side panel. Uses position:sticky
          so the panel stays in its own grid column and never leaves the
          wizard's bounding box. Previously this was position:fixed
          anchored to the viewport's right edge — that worked for the
          standalone embed but overlapped the main content on the
          authenticated /Wizard page (which sits inside an app shell
          with a left sidebar). Sticky positioning is layout-relative:
          it works correctly whether the wizard is embedded in an
          iframe, rendered standalone, or rendered inside the app
          shell, no math required. Hidden on mobile (md:block) — the
          fixed bottom bar further down takes over for narrow screens. */}
      <aside className="hidden md:block">
        <div className="md:sticky md:top-4 w-full space-y-4 z-30">
          {/* Pricing panel proper. */}
          <div
            className="relative p-5 space-y-4 border"
            style={{ background: bcDark, borderColor: bcDarker, color: "#fff" }}
          >
            <h3 className="text-2xl font-bold leading-tight">
              {showPriceSummary ? "Building your run" : "Start building"}
            </h3>

              {/* Stats row — visible always (zeros until configured). */}
              <div className="pt-3 space-y-2 text-sm border-t" style={{ borderColor: "rgba(255,255,255,0.2)" }}>
                <div className="flex justify-between">
                  <span style={{ color: "rgba(255,255,255,0.75)" }}>Garments</span>
                  <span className="font-semibold">
                    {(() => {
                      const n = garments.filter(gg => gg.style).length;
                      return n === 1 ? "1 style" : `${n} styles`;
                    })()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "rgba(255,255,255,0.75)" }}>Locations</span>
                  <span className="font-semibold">
                    {garments.some(gg => gg.style) ? imprints.length : 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "rgba(255,255,255,0.75)" }}>Total quantity</span>
                  <span className="font-semibold">{totalAllQty}</span>
                </div>
              </div>

              {/* Per-garment breakdown only after a style is selected. */}
              {showPriceSummary ? (
                <>
                  {garments.filter(gg => gg.style).length > 0 && (
                    <div className="pt-3 space-y-2.5 border-t" style={{ borderColor: "rgba(255,255,255,0.2)" }}>
                      {garments.filter(gg => gg.style).map(gg => {
                        const gQty = Object.values(gg.sizes).reduce((a, v) => a + (parseInt(v) || 0), 0);
                        const ppp = livePerGarmentPpp[gg.id] || 0;
                        return (
                          <div key={gg.id} className="text-sm">
                            <div className="flex justify-between gap-2">
                              <span className="truncate" style={{ color: "rgba(255,255,255,0.9)" }}>
                                {gg.style.name}{gg.color ? ` · ${gg.color}` : ""}
                              </span>
                              <span className="shrink-0">{gQty > 0 ? gQty : "25 est."}</span>
                            </div>
                            {gQty > 0 && ppp > 0 && (
                              <div className="flex justify-between text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>
                                <span>Per piece</span>
                                <span>{fmtMoney(ppp)}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {(() => {
                        const printSummary = summarizeImprints(imprints);
                        return printSummary ? (
                          <div className="text-[11px] leading-snug pt-1" style={{ color: "rgba(255,255,255,0.55)" }}>
                            Prints: {printSummary}
                          </div>
                        ) : null;
                      })()}
                    </div>
                  )}
                  {rush && (
                    <div className="flex justify-between text-sm">
                      <span style={{ color: "rgba(255,255,255,0.75)" }}>Turnaround</span>
                      <span style={{ color: "#FDBA74" }}>Rush · +20%</span>
                    </div>
                  )}
                  <div className="pt-3 border-t flex items-baseline justify-between" style={{ borderColor: "rgba(255,255,255,0.2)" }}>
                    <p
                      className="text-[10px] font-bold tracking-[0.22em] uppercase"
                      style={{ color: "#86A89A" }}
                    >
                      Run Total
                    </p>
                    <p className="text-3xl font-bold leading-none">
                      {fmtMoney(liveTotals.total)}
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-sm leading-relaxed pt-2" style={{ color: "rgba(255,255,255,0.6)" }}>
                  {enrichingStyle
                    ? "Loading garment details…"
                    : "Add quantities to see pricing."}
                </p>
              )}
          </div>

          {/* Benefits checklist — small white card below the panel. */}
          <div className="mt-3 bg-white p-4 border" style={{ borderColor: "#e5e5e5" }}>
            <ul className="space-y-2 text-sm" style={{ color: "#2a2a2a" }}>
              {[
                "Free art mockup before production",
                "Combine garments in one run for volume pricing",
                "No commitment — submit a request, then review the quote before you pay.",
              ].map(text => (
                <li key={text} className="flex items-start gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={bcDark} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="mt-1 shrink-0" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span className="leading-snug">{text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>

      {/* MOBILE — fixed bottom pricing bar. Replaces the side panel on
          narrow viewports where there's no room for a column. Uses fixed
          positioning so it survives iframe embeds with min-height or
          height:100vh equally well. */}
      {showPriceSummary && (
        <div
          className="md:hidden fixed bottom-0 left-0 right-0 z-30 border-t shadow-lg"
          style={{ background: bcDark, borderColor: bcDarker, color: "#fff" }}
        >
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="text-xs min-w-0 truncate" style={{ color: "rgba(255,255,255,0.7)" }}>
              {totalAllQty > 0 ? `${totalAllQty} pcs` : `${getMinOrderQty()} pcs (est.)`}
              {rush && <span className="ml-2" style={{ color: "#FDBA74" }}>Rush</span>}
            </div>
            <div className="flex items-baseline gap-3 shrink-0">
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.7)" }}>{fmtMoney(livePpp)}/pc</span>
              <span className="text-lg font-bold">{fmtMoney(liveTotals.total)}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
