import { useState } from "react";
import Icon from "@/components/shared/Icon";
import ColorAnalysisResult from "@/components/shared/ColorAnalysisResult";
import { BIG_SIZES, SIZES, DEFAULT_EMB_STITCH_TIERS, getEnabledTechniques, getMinOrderQty, getShopPricingConfig, getStandardTurnaroundDays, getWizardRushDisplay } from "@/components/shared/pricing";
import { StepBadge, TintedImage, colorNameToHex, LOCATIONS, COLOR_COUNTS, CATEGORY_BLURBS } from "@/components/wizard/steps/wizardHelpers";

// STEP 1: Configure — style + color + sizes + prints all on one page.
// Extracted verbatim from OrderWizard.jsx as a pure structural move.
// The parent (OrderWizard) still owns ALL wizard state, the pricing /
// cost computation, and the derived values (qty, effectiveCost, etc.);
// this component only renders the Step-1 JSX and calls handlers threaded
// down as props. No pricing or cost math lives here.
export default function ConfigureStep({
  POPULAR_STYLES,
  bc, bcDark, bcDarker,
  garments, activeIdx, setActiveIdx,
  style, color, sizes,
  setG, setStyle, setColor, setSizes,
  selectedGarment, setSelectedGarment,
  setPreviewStyle,
  enrichedPreviews, enrichStylePreviews, selectAndEnrichStyle,
  enrichingStyle,
  ssLookupInput, setSsLookupInput, ssLookupLoading, ssLookupError, handleSSLookup,
  ssMatches, setSsMatches, pickSSMatch,
  uid,
  setColorPreview,
  imprints, updateImprint, removeImprint, setImprints,
  artFiles, setArtFiles, colorResults, setColorResults,
  uploading, handleArtUpload,
  rush, setRush,
  sizesRef,
  qty,
  addGarment, removeGarment,
  getValidationIssues,
  setStep,
}) {
  const garmentTypes = [...new Set(POPULAR_STYLES.map(s => s.garment))];
  const styleOptions = selectedGarment
    ? POPULAR_STYLES.filter(s => s.garment === selectedGarment)
    : [];

  // Image URLs that failed to load this session. Supplier CDNs rotate
  // image paths (BigCommerce bakes an upload timestamp into the URL), so
  // a styleImage saved into `wizard_styles[]` months ago can 404 today.
  // Tracking dead URLs lets the render fall through to the next candidate
  // (enriched preview → placeholder) instead of the browser's
  // broken-image icon. Render-local UI state only — never persisted.
  const [deadImgs, setDeadImgs] = useState(() => new Set());
  const markDead = (url) => {
    if (url) setDeadImgs(prev => prev.has(url) ? prev : new Set(prev).add(url));
  };
  const liveImg = (...urls) => urls.find(u => u && !deadImgs.has(u)) || "";

  return (
  <div className="space-y-5">
    {/* All garments as collapsible cards */}
    {garments.map((gg, idx) => {
      const isActive = idx === activeIdx;
      const gQty = Object.values(gg.sizes).reduce((s,v)=>s+(parseInt(v)||0),0);
      const hasStyle = !!gg.style;

      // Collapsed chip
      if (!isActive) {
        return (
          <button key={gg.id} onClick={() => setActiveIdx(idx)}
            className="w-full flex items-center justify-between bg-white rounded-2xl px-5 py-4 border-2 border-slate-200 hover:border-[var(--brand)] transition text-left">
            <div className="flex items-center gap-3 min-w-0">
              {(() => {
                const colorImg = hasStyle && gg.style.colorImages?.[gg.color];
                const baseImg = hasStyle && (gg.style.colorImages?.["Black"] || gg.style.styleImage);
                if (colorImg) return <img src={colorImg} alt="" className="w-10 h-10 rounded-lg object-contain bg-slate-50" />;
                if (baseImg && gg.color && colorNameToHex(gg.color)) return <TintedImage baseImg={baseImg} colorName={gg.color} className="w-10 h-10 flex-shrink-0" />;
                if (baseImg) return <img src={baseImg} alt="" className="w-10 h-10 rounded-lg object-contain bg-slate-50" />;
                return <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0"><Icon name="tee" className="w-5 h-5 text-slate-500" /></div>;
              })()}
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                  {hasStyle ? `${gg.style.name}${gg.color ? ` · ${gg.color}` : ""}` : "New garment"}
                </div>
                <div className="text-xs text-slate-500">
                  {gQty > 0 ? `${gQty} pcs` : "no sizes"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className="text-xs text-[var(--brand)] font-semibold">Edit</span>
              {garments.length > 1 && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="Remove garment"
                  onClick={(e) => { e.stopPropagation(); removeGarment(idx); }}
                  onKeyDown={(e) => {
                    // Keyboard parity with the click handler (FE-03). This
                    // sits inside the card <button>, so swallow the event
                    // to keep Enter/Space from also toggling the card.
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      removeGarment(idx);
                    }
                  }}
                  className="text-xs text-red-400 hover:text-red-600 cursor-pointer">Remove</span>
              )}
            </div>
          </button>
        );
      }

      // Expanded card — all sections inside one block
      const isCollapsed = gg.collapsed && hasStyle && gg.color;
      return (
        <div key={gg.id} className="bg-white dark:bg-slate-900 rounded-2xl border-2 border-[var(--brand)] dark:border-[var(--brand-dark)] shadow-sm">
          {/* Card header */}
          <div className="bg-slate-50 dark:bg-slate-800 px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between rounded-t-2xl">
            <div className="flex items-center gap-3">
              {hasStyle && (() => {
                const colorImg = gg.style.colorImages?.[gg.color];
                const baseImg = gg.style.colorImages?.["Black"] || gg.style.styleImage;
                if (colorImg) return <img src={colorImg} alt="" className="w-9 h-9 rounded-lg object-contain bg-white flex-shrink-0" />;
                if (baseImg && gg.color && colorNameToHex(gg.color)) return <TintedImage baseImg={baseImg} colorName={gg.color} className="w-9 h-9 flex-shrink-0" />;
                if (baseImg) return <img src={baseImg} alt="" className="w-9 h-9 rounded-lg object-contain bg-white flex-shrink-0" />;
                return null;
              })()}
              <div className="text-sm font-bold text-slate-800 dark:text-slate-200">
                {garments.length > 1 ? `Garment ${idx + 1}` : ""}{hasStyle && <span className={`font-normal text-slate-500 dark:text-slate-400 ${garments.length > 1 ? "ml-2" : ""}`}>{garments.length > 1 ? "— " : ""}{gg.style.name}{gg.color ? ` · ${gg.color}` : ""}</span>}
                {!hasStyle && garments.length <= 1 && <span className="text-slate-500 dark:text-slate-500">Select a style below</span>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {hasStyle && gg.color && (
                <button onClick={() => setG({ collapsed: !gg.collapsed })}
                  className="text-xs font-semibold text-[var(--brand)] hover:text-[var(--brand-dark)]">
                  {isCollapsed ? "Expand" : "Collapse"}
                </button>
              )}
              {garments.length > 1 && (
                <button onClick={() => removeGarment(idx)} className="text-xs text-red-400 hover:text-red-600">Remove</button>
              )}
            </div>
          </div>

          {!isCollapsed && <div className="p-5 space-y-5">

  {/* ── Style ── */}
  <div className="space-y-4">

    {!style ? (<>
      {/* Category accordion — each category is a full-width button.
          When one is selected, its top picks render inline directly
          beneath it so the suggestions sit under the category they
          belong to (mobile feedback 2026-06-09 — previously every
          category's picks rendered in one block at the bottom,
          which made the relationship to a specific category unclear
          on phones). */}
      <div className="flex flex-col gap-2.5">
        {garmentTypes.map(gt => {
          const active = selectedGarment === gt;
          const inlineStyles = active ? POPULAR_STYLES.filter(s => s.garment === gt) : [];
          return (
            <div key={gt} className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedGarment(active ? "" : gt);
                  setPreviewStyle(null);
                  if (!active) enrichStylePreviews(POPULAR_STYLES.filter(s => s.garment === gt));
                }}
                className={`w-full text-left px-4 py-3 border-2 rounded-xl transition ${
                  active
                    ? "text-white border-transparent shadow-sm"
                    : "bg-white border-slate-200 hover:border-[var(--brand)] text-slate-800"
                }`}
                style={active ? { background: bcDark, borderColor: bcDarker } : undefined}
              >
                <div className={`font-bold text-sm uppercase tracking-wide ${active ? "text-white" : "text-[var(--brand-dark)]"}`}>
                  {gt}
                </div>
                {CATEGORY_BLURBS[gt] && (
                  <div className={`text-xs leading-snug mt-1 ${active ? "text-white/85" : "text-slate-500"}`}>
                    {CATEGORY_BLURBS[gt]}
                  </div>
                )}
              </button>

              {/* Inline styles for the active category. Rendered
                  here (not below the whole category list) so the
                  dropdown reads as belonging to the category that
                  was tapped. */}
              {active && inlineStyles.length > 0 && (
                <div className="pl-2 sm:pl-3 space-y-2">
                  <p className="text-xs text-slate-500 dark:text-slate-500">
                    Our top picks for {gt.toLowerCase()}. More options at{' '}
                    <a
                      href="https://www.ascolour.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--brand)] hover:text-[var(--brand-dark)] underline underline-offset-2"
                    >
                      ascolour.com
                    </a>
                    {' '}or{' '}
                    <a
                      href="https://www.ssactivewear.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--brand)] hover:text-[var(--brand-dark)] underline underline-offset-2"
                    >
                      ssactivewear.com
                    </a>
                    .
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {inlineStyles.map(s => {
                      const ep = enrichedPreviews[s.id];
                      const previewImg = liveImg(s.styleImage, typeof ep === "object" ? ep.styleImage : ep, s.image);
                      const displayName = s.name || (typeof ep === "object" ? ep.name : "") || s.styleNumber || "Style";
                      const displayDesc = s.description || (typeof ep === "object" ? ep.description : "");
                      const displayWeight = s.weight || (typeof ep === "object" ? ep.weight : "");
                      return (
                        <button key={s.id} onClick={() => selectAndEnrichStyle(s)}
                          className="relative group flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 border-slate-200 hover:border-[var(--brand)] hover:bg-[var(--brand-tint)] transition text-left bg-white">
                          {previewImg ? <img src={previewImg} alt="" onError={() => markDead(previewImg)} className="w-10 h-10 rounded-lg object-contain bg-slate-50" /> :
                            <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center animate-pulse"><Icon name="tee" className="w-5 h-5 text-slate-300" /></div>}
                          <div className="min-w-0"><div className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{displayName}</div>
                            <div className="text-xs text-slate-500">{displayWeight}{s.tag ? (displayWeight ? " · " : "") + s.tag : ""}</div></div>
                          <div className="fixed inset-0 z-40 pointer-events-none flex items-start justify-center" style={{display:"contents"}}>
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-white rounded-xl shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-40 overflow-hidden">
                              {previewImg && <img src={previewImg} alt="" onError={() => markDead(previewImg)} className="w-full aspect-square object-contain bg-white p-4" />}
                              <div className="px-4 py-3">
                                <div className="font-bold text-sm text-slate-900">{displayName}</div>
                                {displayDesc && <div className="text-xs text-slate-500 mt-0.5">{displayDesc}</div>}
                                <div className="mt-2 space-y-0.5 text-xs text-slate-500">
                                  {s.styleNumber && <div>Style Number: <span className="font-semibold text-slate-700 dark:text-slate-300">{s.styleNumber}</span></div>}
                                  {displayWeight && <div>Weight: <span className="font-semibold text-slate-700 dark:text-slate-300">{displayWeight}</span></div>}
                                </div>
                                {s.hoverDescription && (
                                  <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-600 leading-relaxed">{s.hoverDescription}</div>
                                )}
                              </div>
                            </div>
                          </div>
                        </button>);
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Style # search — now lives below the entire accordion as
          the "can't find it here?" escape hatch. */}
      <div>
        <label htmlFor="wiz-style-search" className="block text-xs text-slate-500 mb-1">Or search by style #</label>
        <form onSubmit={handleSSLookup} className="flex gap-1.5">
          <input id="wiz-style-search" value={ssLookupInput} onChange={(e) => setSsLookupInput(e.target.value)} placeholder="e.g. 5001"
            className="flex-1 text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]" disabled={ssLookupLoading} />
            <button type="submit" disabled={ssLookupLoading||!ssLookupInput.trim()}
              className="text-sm font-semibold text-[var(--brand)] border border-[var(--brand-tint)] px-3 py-2 rounded-xl hover:bg-[var(--brand-tint)] disabled:opacity-50">
              {ssLookupLoading ? "…" : "Go"}</button>
          </form>
        {ssLookupError && <div role="alert" className="text-xs text-red-500 mt-1">{ssLookupError}</div>}
      </div>
      {/* Legacy below-the-categories block kept guarded as a
          no-op render — falls through to false now that styles
          render inline above. Left for the diff to read as a
          pure relocation, easy to delete in a follow-up sweep. */}
      {/* eslint-disable-next-line no-constant-binary-expression -- the `false &&`
          is the intentional no-op guard described above; deleting the block is a
          separate cleanup, not something to do inside a bug-fix diff. */}
      {false && styleOptions.length > 0 && <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {styleOptions.map(s => {
          const ep = enrichedPreviews[s.id];
          // Prefer the saved-config image (whatever color the
          // shop owner picked / the supplier ships as primary)
          // so the public wizard mirrors the variety they see
          // in the editor — green, gray, white, black, etc.
          // Runtime enrichment defaults to the "Black" variant
          // and was flattening every tile to the same color.
          const previewImg = s.styleImage || (typeof ep === "object" ? ep.styleImage : ep) || s.image;
          const displayName = s.name || (typeof ep === "object" ? ep.name : "") || s.styleNumber || "Style";
          const displayDesc = s.description || (typeof ep === "object" ? ep.description : "");
          const displayWeight = s.weight || (typeof ep === "object" ? ep.weight : "");
          return (
          <button key={s.id} onClick={() => selectAndEnrichStyle(s)}
            className="relative group flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 border-slate-200 hover:border-[var(--brand)] hover:bg-[var(--brand-tint)] transition text-left">
            {previewImg ? <img src={previewImg} alt="" className="w-10 h-10 rounded-lg object-contain bg-slate-50" /> :
              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center animate-pulse"><Icon name="tee" className="w-5 h-5 text-slate-300" /></div>}
            <div className="min-w-0"><div className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{displayName}</div>
              <div className="text-xs text-slate-500">{displayWeight}{s.tag ? (displayWeight ? " · " : "") + s.tag : ""}</div></div>
            <div className="fixed inset-0 z-40 pointer-events-none flex items-start justify-center" style={{display:"contents"}}>
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-white rounded-xl shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-40 overflow-hidden">
                {previewImg && <img src={previewImg} alt="" className="w-full aspect-square object-contain bg-white p-4" />}
                <div className="px-4 py-3">
                  <div className="font-bold text-sm text-slate-900">{displayName}</div>
                  {displayDesc && <div className="text-xs text-slate-500 mt-0.5">{displayDesc}</div>}
                  <div className="mt-2 space-y-0.5 text-xs text-slate-500">
                    {s.styleNumber && <div>Style Number: <span className="font-semibold text-slate-700 dark:text-slate-300">{s.styleNumber}</span></div>}
                    {displayWeight && <div>Weight: <span className="font-semibold text-slate-700 dark:text-slate-300">{displayWeight}</span></div>}
                  </div>
                  {s.hoverDescription && (
                    <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-600 leading-relaxed">{s.hoverDescription}</div>
                  )}
                </div>
              </div>
            </div>
          </button>);
        })}
      </div>}
      {ssMatches.length > 0 && <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {ssMatches.map(m => (
          <button key={m.id} onClick={() => pickSSMatch(m)}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-slate-200 hover:border-[var(--brand)] hover:bg-[var(--brand-tint)] transition text-left">
            {m.styleImage && <img src={m.styleImage} alt="" className="w-10 h-10 rounded-lg object-contain bg-white" />}
            <div className="min-w-0"><div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{m.brandName} {m.styleNumber}</div>
              <div className="text-xs text-slate-500 truncate">{m.description}</div></div>
          </button>))}
      </div>}
    </>) : (
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold text-slate-900 dark:text-slate-100">{style.name}</div>
          {style.description && <div className="text-xs text-slate-500">{style.description}</div>}
        </div>
        <button onClick={()=>{ setStyle(null); setColor(""); setSelectedGarment(""); setPreviewStyle(null); setSsMatches([]); setSsLookupInput(""); }}
          className="text-xs text-[var(--brand)] font-semibold hover:text-[var(--brand-dark)]">Change</button>
      </div>
    )}
  </div>

  {/* ── Color ── */}
  {style && (
    <div className="border-t border-slate-100 dark:border-slate-700 pt-5">
      <StepBadge
        n={1}
        title="Pick a color"
        subtitle={color ? `Selected: ${color}` : "Tap a swatch to choose; tap again to preview the full photo."}
      />
      {enrichingStyle && <div className="text-center text-sm text-slate-500 py-4">Loading colors…</div>}
      {!enrichingStyle && style.colors?.length > 0 ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
          {(() => {
            const baseImg = liveImg(style.colorImages?.["Black"], style.styleImage, ...Object.values(style.colorImages || {}));
            return style.colors.filter(c => style.colorImages?.[c] || colorNameToHex(c)).map(c => {
              const colorImg = liveImg(style.colorImages?.[c]);
              const isSelected = color === c;
              return (
                <button key={c} onClick={() => {
                  if (isSelected) {
                    // Second click — open photo preview with all angles
                    const cUpper = c.toUpperCase();
                    const apiImages = (style.allImages || [])
                      .filter(img => {
                        const t = (img.colour || img.type || "").toUpperCase();
                        return t === cUpper || t.startsWith(cUpper + " -") || t.startsWith(cUpper + " ");
                      })
                      .map(img => ({ url: img.url, label: (img.colour || img.type || "").replace(new RegExp("^" + cUpper + "\\s*-?\\s*", "i"), "").trim() || "Front" }));
                    // Fallback to the single colorImages entry
                    if (apiImages.length === 0 && colorImg) apiImages.push({ url: colorImg, label: "Front" });
                    setColorPreview({ colorName: c, images: apiImages });
                  } else {
                    setColor(c);
                  }
                }}
                  className={`rounded-xl border-2 p-2 text-center transition hover:shadow-md ${isSelected?"border-[var(--brand)] bg-[var(--brand-tint)]":"border-slate-200 hover:border-[var(--brand)]"}`}>
                  {colorImg ? <img src={colorImg} alt={c} onError={() => markDead(colorImg)} className="w-full aspect-square rounded-lg object-contain bg-white mb-2" />
                    : <TintedImage baseImg={baseImg} colorName={c} className="w-full aspect-square mb-2" />}
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">{c}</div>
                  {isSelected && <div className="text-[10px] text-[var(--brand)] mt-0.5">Tap to preview</div>}
                </button>);
            });
          })()}
        </div>
      ) : !enrichingStyle ? (
        <input value={color} aria-label="Garment color" onChange={e=>setColor(e.target.value)} placeholder="e.g. Black, Navy, Heather Grey"
          className="w-full text-sm border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]" />
      ) : null}
    </div>
  )}

  {/* Print / Stitch Locations + Turnaround live below the
      garments list — they apply to the whole run, not to any one
      garment. See the run-level block after garments.map(). */}

  {/* ── Sizes ── */}
  {style && (
    <div ref={sizesRef} className="border-t border-slate-100 dark:border-slate-700 pt-5">
      <StepBadge
        n={2}
        title="Sizes & Quantity"
        subtitle="Enter how many of each size. Volume breaks unlock at 12, 25, 50, 100, and 250 pieces."
      />
      {(() => {
        const rawInv = color ? (style.inventoryMap?.[color] || {}) : {};
        // Normalize OS aliases
        const inv = {};
        const osAliases = ["adjustable", "osfa", "one size", "os", "osfm", "one_size", "uni", "n/a"];
        for (const [k, v] of Object.entries(rawInv)) {
          if (osAliases.includes(k.toLowerCase())) inv["OS"] = (inv["OS"] || 0) + v;
          else inv[k] = v;
        }
        const hasInv = Object.keys(inv).length > 0;
        // Total count of oversized (2XL/3XL/...) pieces, used
        // for the "N oversized pcs" badge. Mirrors the
        // `twoXL` calc in shared/pricing.jsx — kept inline
        // because the wizard doesn't otherwise call the
        // pricing engine at this point in the flow.
        const oversizeQty = BIG_SIZES.reduce(
          (sum, sz) => sum + (parseInt((sizes || {})[sz], 10) || 0),
          0
        );
        return (<>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 sm:gap-3 mb-3">
            {SIZES.map(sz => {
              const stock = inv[sz] ?? inv[sz.replace("XL","X")] ?? null;
              return (<div key={sz} className="text-center">
                <div className={`text-xs font-bold mb-1 ${BIG_SIZES.includes(sz)?"text-amber-600":"text-slate-500"}`}>{sz}</div>
                <input type="number" min="0" aria-label={`Quantity for size ${sz}`} value={sizes[sz]||""} onChange={e=>setSizes(prev=>({...prev,[sz]:Math.max(0,Math.min(100000,parseInt(e.target.value,10)||0))}))}
                  placeholder="0" className={`w-full text-center text-sm border rounded-xl py-2.5 focus:outline-none focus:ring-2 focus:ring-[var(--brand)] dark:text-slate-200 ${BIG_SIZES.includes(sz)?"border-amber-200 bg-amber-50 dark:bg-amber-900/30 dark:border-amber-700":"border-slate-200 dark:border-slate-600 dark:bg-slate-800"}`} />
                {hasInv && <div className={`text-[10px] mt-1 ${stock!=null&&stock>0?(stock<50?"text-amber-500":"text-emerald-500"):"text-red-400"}`}>
                  {stock!=null?(stock>0?`${stock} avail`:"out"):"—"}</div>}
              </div>);
            })}
          </div>
          <div className="flex justify-between items-center border-t border-slate-100 pt-3">
            <div className="text-sm text-slate-500">Total: <span className="font-bold text-slate-900">{qty} pcs</span>
              {oversizeQty > 0 && <span className="ml-3 text-amber-600 text-xs font-semibold">{oversizeQty} oversized pcs</span>}</div>
            {qty > 0 && qty < getMinOrderQty() && <span className="text-xs font-semibold text-red-500 bg-red-50 px-3 py-1 rounded-full border border-red-100">Min {getMinOrderQty()} pcs</span>}
          </div>
        </>);
      })()}
    </div>
  )}

          </div>}
        </div>
      );
    })}

    {/* Add Garment + hint — invites a second garment OR redirects
        folks who actually want different prints to a separate
        request. Keeping the hint on the same row keeps the
        redirect option visible at the moment of decision. */}
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <button
        onClick={addGarment}
        className="font-semibold px-5 py-2.5 rounded-xl transition text-sm border-2 border-[var(--brand-tint)] text-[var(--brand)] hover:bg-[var(--brand-tint)] self-start"
      >
        + Add Another Garment
      </button>
      <p className="text-xs text-slate-500 sm:text-right">
        Different prints? <span className="text-slate-600 font-medium">Submit a separate quote for each.</span>
      </p>
    </div>

    {/* ── Run-level: Print / Stitch Locations ── Shared across
        every garment above. Linked imprints combine quantities so
        the customer hits the right volume break. */}
    {garments.some(gg => gg.style) && (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border-2 border-[var(--brand)] dark:border-[var(--brand-dark)] shadow-sm p-5 space-y-3">
        <StepBadge
          n={3}
          title="Print / Stitch Locations"
          subtitle="All garments in this run will be printed the same way. Each location can use a different decoration method (e.g. screen back + embroidered front)."
        />
        {imprints.map((imp, idx) => (
          <div key={imp.id} className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-600">Print {idx+1}</span>
              {imprints.length > 1 && <button onClick={() => removeImprint(idx)} className="text-xs text-red-400 hover:text-red-600">Remove</button>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-[11px] text-slate-500 mb-1">Placement</label>
                <select value={imp.location} onChange={e=>updateImprint(idx,{location:e.target.value})}
                  className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]">
                  {LOCATIONS.map(l=><option key={l} value={l}>{l}</option>)}</select></div>
              <div><label className="block text-[11px] text-slate-500 mb-1">Technique</label>
                <select value={imp.technique}
                  onChange={e=>{
                    const t = e.target.value;
                    // imp.colors means "ink color count" for print methods but
                    // "stitch-tier index" for Embroidery (imprintLabels.js
                    // contract) — crossing that boundary must reset it or the
                    // old value silently selects the wrong price tier.
                    const crossed = (t === "Embroidery") !== (imp.technique === "Embroidery");
                    updateImprint(idx, { technique: t, ...(crossed ? { colors: 1 } : {}) });
                  }}
                  className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]">
                  {getEnabledTechniques().map(t=><option key={t}>{t}</option>)}</select></div>
            </div>
            {imp.technique === "Embroidery" ? (
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-[11px] text-slate-500 mb-1">Stitch Count</label>
                  <select value={imp.colors || 1} onChange={e=>updateImprint(idx,{colors:parseInt(e.target.value)||1})}
                    className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]">
                    {(getShopPricingConfig()?.embroidery?.stitchTiers || DEFAULT_EMB_STITCH_TIERS).map((st,i)=>(
                      <option key={st} value={i+1}>{st}</option>
                    ))}</select></div>
                <div><label className="block text-[11px] text-slate-500 mb-1">Thread Colors <span className="text-slate-300">(optional)</span></label>
                  <input value={imp.pantones || ""} onChange={e=>updateImprint(idx,{pantones:e.target.value})}
                    placeholder="e.g. Navy, White, Gold"
                    className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]" /></div>
              </div>
            ) : (
            <div><label className="block text-[11px] text-slate-500 mb-1.5">Colors</label>
              <div className="flex gap-1.5">{COLOR_COUNTS.map(n=>(
                <button key={n} onClick={()=>updateImprint(idx,{colors:n})}
                  style={imp.colors===n ? { backgroundColor: bc } : undefined}
                  className={`w-9 h-9 rounded-lg text-sm font-bold transition ${imp.colors===n?"text-white":"bg-white border border-slate-200 text-slate-600 hover:border-[var(--brand)]"}`}>{n}</button>
              ))}</div></div>
            )}
            <div><label className="block text-[11px] text-slate-500 mb-1">Artwork <span className="text-slate-300">(optional)</span></label>
              {artFiles[idx] ? (
                <div>
                  <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs">
                    <span className="text-emerald-600 font-semibold truncate flex-1">✓ {artFiles[idx].name}</span>
                    <button onClick={()=>{setArtFiles(prev=>{const n={...prev};delete n[idx];return n;}); setColorResults(prev=>{const n={...prev};delete n[idx];return n;});}} className="text-slate-500 hover:text-red-500 text-xs">Remove</button>
                  </div>
                  <ColorAnalysisResult result={colorResults[idx]} imageUrl={artFiles[idx]?.previewUrl || artFiles[idx]?.url}
                    onApplyCount={(count, pantones) => updateImprint(idx, {
                      // Embroidery: imp.colors is the stitch-tier index, not a
                      // color count — detected colors only fill the thread list.
                      ...(imp.technique === "Embroidery" ? {} : { colors: Math.min(8, Math.max(1, count)) }),
                      ...(pantones ? { pantones } : {}),
                    })} />
                </div>
              ) : (
                <label className={`flex items-center gap-2 border-2 border-dashed rounded-lg px-3 py-2.5 cursor-pointer transition text-xs ${uploading[idx]?"border-[var(--brand)] bg-[var(--brand-tint)]":"border-slate-200 hover:border-[var(--brand)] hover:bg-slate-50"}`}>
                  <input type="file" accept=".ai,.eps,.pdf,.png,.jpg,.jpeg,.psd" className="hidden"
                    onChange={e=>e.target.files[0]&&handleArtUpload(idx,e.target.files[0])} />
                  {uploading[idx] ? <span className="text-[var(--brand)]">Uploading…</span> : <span className="text-slate-500">Upload artwork</span>}
                </label>
              )}</div>
          </div>
        ))}
        <button onClick={() => {
          // Inherit the technique from the previous location so
          // customers building "front print + back print" runs
          // don't have to re-pick the method every row. Each new
          // row's dropdown can still override.
          const seedMethod = imprints[imprints.length - 1]?.technique || "Screen Print";
          setImprints(prev => [...prev, {id:uid(),location:"Back",colors:1,pantones:"",technique:seedMethod,details:""}]);
        }}
          className="w-full text-sm font-semibold text-[var(--brand)] border border-[var(--brand-tint)] rounded-xl py-2.5 hover:bg-[var(--brand-tint)] transition">+ Add Print Location</button>
      </div>
    )}

    {/* ── Run-level: Turnaround ── Global rush flag; rendered once
        so it doesn't duplicate inside every garment card. */}
    {garments.some(gg => gg.style) && (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border-2 border-[var(--brand)] dark:border-[var(--brand-dark)] shadow-sm p-5">
        <StepBadge
          n={4}
          title="Turnaround"
          subtitle={`Standard ships in ~${getStandardTurnaroundDays()} business days. Rush ships in ${getWizardRushDisplay().daysLabel} for a ${Math.round(getWizardRushDisplay().rate * 100)}% surcharge.`}
        />
        <div className="flex gap-3">
          {[{val:false,label:"Standard",sub:`${getStandardTurnaroundDays()} business days`},{val:true,label:"Rush",sub:getWizardRushDisplay().daysLabel,badge:`+${Math.round(getWizardRushDisplay().rate * 100)}%`}].map(opt=>(
            <button key={String(opt.val)} onClick={()=>setRush(opt.val)}
              className={`flex-1 rounded-xl border-2 px-4 py-3 text-left transition ${rush===opt.val?"border-[var(--brand)] bg-[var(--brand-tint)]":"border-slate-200 hover:border-slate-300"}`}>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold ${rush===opt.val?"text-[var(--brand-dark)]":"text-slate-700"}`}>{opt.label}</span>
                {opt.badge && <span className="text-xs font-bold text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">{opt.badge}</span>}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{opt.sub}</div>
            </button>))}
        </div>
      </div>
    )}

    <div className="space-y-3">
      {getValidationIssues().length > 0 && (
        <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2">
          {getValidationIssues()[0]}
        </div>
      )}
      <div className="flex justify-end">
        <button onClick={() => { if (getValidationIssues().length === 0) setStep(2); }}
          disabled={getValidationIssues().length > 0}
          style={getValidationIssues().length === 0 ? { backgroundColor: bc } : undefined}
          className={`font-semibold px-6 py-2.5 rounded-xl transition ${getValidationIssues().length === 0 ? "hover:opacity-90 text-white" : "bg-slate-100 text-slate-500 cursor-not-allowed"}`}>
          Continue →
        </button>
      </div>
    </div>
  </div>
  );
}
