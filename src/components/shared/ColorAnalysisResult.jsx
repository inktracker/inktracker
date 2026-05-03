import { useState, useRef, useCallback } from "react";
import { PANTONE_TABLE } from "@/lib/pantoneColors";

function rgbDistance(a, b) {
  return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
}
function rgbToHex(r, g, b) {
  return "#" + [r,g,b].map(c => c.toString(16).padStart(2,"0")).join("");
}
function hexToRgb(hex) {
  const m = hex.replace("#","").match(/.{2}/g);
  return m ? m.map(c => parseInt(c, 16)) : [0,0,0];
}
function nearestPantone(rgb) {
  let best = null, bestD = Infinity;
  for (const [name, pms] of PANTONE_TABLE) {
    const d = rgbDistance(rgb, [pms.r, pms.g, pms.b]);
    if (d < bestD) { bestD = d; best = { name, hex: rgbToHex(pms.r, pms.g, pms.b) }; }
  }
  return best;
}

function EyedropperPicker({ imageUrl, onPick }) {
  const canvasRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [pickedColor, setPickedColor] = useState(null);
  const [pickedPantone, setPickedPantone] = useState(null);

  const handleImageLoad = useCallback((e) => {
    const img = e.target;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const maxW = 300;
    const scale = Math.min(maxW / img.naturalWidth, 1);
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    setLoaded(true);
  }, []);

  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) * (canvas.width / rect.width));
    const y = Math.round((e.clientY - rect.top) * (canvas.height / rect.height));
    const ctx = canvas.getContext("2d");
    const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
    const hex = rgbToHex(r, g, b);
    const pms = nearestPantone([r, g, b]);
    setPickedColor(hex);
    setPickedPantone(pms);
    onPick?.({ hex, rgb: [r,g,b], pantone: pms });
  };

  return (
    <div className="space-y-2">
      <img
        src={imageUrl}
        alt=""
        onLoad={handleImageLoad}
        className="hidden"
        crossOrigin="anonymous"
      />
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        className={`rounded-lg border border-slate-200 cursor-crosshair max-w-full ${loaded ? "" : "hidden"}`}
      />
      {!loaded && <div className="text-xs text-slate-400">Loading image…</div>}
      {pickedColor && pickedPantone && (
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2">
          <div className="w-6 h-6 rounded-md border border-slate-300" style={{ backgroundColor: pickedColor }} />
          <span className="text-xs font-semibold text-slate-700">{pickedPantone.name}</span>
          <div className="w-4 h-4 rounded-sm border border-slate-200" style={{ backgroundColor: pickedPantone.hex }} title="Pantone ref" />
          <span className="text-[10px] text-slate-400">{pickedColor}</span>
        </div>
      )}
    </div>
  );
}

function ManualColorInput({ onPick }) {
  const [hex, setHex] = useState("#000000");
  const rgb = hexToRgb(hex);
  const pms = nearestPantone(rgb);

  function addColor() {
    if (hex.length === 7) {
      onPick?.({ hex, rgb: hexToRgb(hex), pantone: nearestPantone(hexToRgb(hex)) });
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={hex}
        onChange={(e) => setHex(e.target.value)}
        className="w-8 h-8 rounded-md border border-slate-200 cursor-pointer p-0"
      />
      <input
        value={hex}
        onChange={(e) => { const v = e.target.value; if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setHex(v); }}
        className="w-20 text-xs border border-slate-200 rounded-lg px-2 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300"
        placeholder="#000000"
      />
      {pms && (
        <>
          <div className="w-4 h-4 rounded-sm border border-slate-200" style={{ backgroundColor: pms.hex }} />
          <span className="text-xs font-semibold text-slate-700">{pms.name}</span>
        </>
      )}
      <button
        onClick={addColor}
        className="text-[11px] font-semibold text-indigo-600 border border-indigo-200 px-2 py-1 rounded-lg hover:bg-indigo-50"
      >
        + Add
      </button>
    </div>
  );
}

export default function ColorAnalysisResult({ result, onApplyCount, imageUrl }) {
  const [showEyedropper, setShowEyedropper] = useState(false);
  const [manualColors, setManualColors] = useState([]);
  const [adjustedColors, setAdjustedColors] = useState({}); // idx → {hex, pantone}
  const [removedSpots, setRemovedSpots] = useState(new Set());

  function handlePickedColor(picked) {
    setManualColors(prev => {
      const exists = prev.find(c => c.hex === picked.hex);
      if (exists) return prev;
      return [...prev, picked];
    });
  }

  function removeManual(idx) {
    setManualColors(prev => prev.filter((_, i) => i !== idx));
  }

  if (!result) return null;

  if (result.unsupported) {
    return (
      <div className="text-xs text-slate-400 italic mt-1">{result.message}</div>
    );
  }

  const allSpotColors = (result.spotColors || result.colors || []).filter(c => !c.isBackground);
  const spotColors = allSpotColors.filter((_, i) => !removedSpots.has(i));
  const totalColors = spotColors.length + manualColors.length;

  return (
    <div className="mt-2 bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-700">
          {result.suggestion}
        </div>
        {onApplyCount && totalColors > 0 && (
          <button
            onClick={() => {
              const allPantones = [
                ...allSpotColors.map((c, origIdx) => {
                  if (removedSpots.has(origIdx)) return null;
                  const adjusted = adjustedColors[origIdx];
                  return adjusted?.pantone || c.pantone;
                }).filter(Boolean),
                ...manualColors.map(c => c.pantone).filter(Boolean),
              ];
              onApplyCount(Math.min(8, totalColors), allPantones.join(", "));
            }}
            className="text-[11px] font-semibold text-indigo-600 border border-indigo-200 px-2 py-0.5 rounded-lg hover:bg-indigo-50"
          >
            Use {Math.min(8, totalColors)} color{totalColors !== 1 ? "s" : ""}
          </button>
        )}
        {result.isPhoto && onApplyCount && (
          <button
            onClick={() => onApplyCount(4, "")}
            className="text-[11px] font-semibold text-indigo-600 border border-indigo-200 px-2 py-0.5 rounded-lg hover:bg-indigo-50"
          >
            Use 4-color process
          </button>
        )}
      </div>

      {/* Auto-detected spot colors — each is adjustable and removable */}
      {spotColors.length > 0 && (
        <div className="space-y-1.5">
          {allSpotColors.slice(0, 8).map((c, origIdx) => {
            if (removedSpots.has(origIdx)) return null;
            const adj = adjustedColors[origIdx];
            const displayHex = adj?.hex || c.hex;
            const displayPantone = adj?.pantone || c.pantone;
            return (
              <div key={origIdx} className="flex items-center gap-2">
                <input
                  type="color"
                  value={displayHex}
                  onChange={(e) => {
                    const newHex = e.target.value;
                    const newRgb = hexToRgb(newHex);
                    const newPms = nearestPantone(newRgb);
                    setAdjustedColors(prev => ({ ...prev, [origIdx]: { hex: newHex, pantone: newPms } }));
                  }}
                  className="w-6 h-6 rounded-md border border-slate-300 flex-shrink-0 cursor-pointer p-0"
                  title="Click to adjust this color"
                />
                {displayPantone ? (
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-xs font-semibold text-slate-700">{displayPantone.name}</span>
                    <div className="w-3 h-3 rounded-sm border border-slate-200 flex-shrink-0" style={{ backgroundColor: displayPantone.hex }} />
                    {adj && (
                      <button
                        onClick={() => setAdjustedColors(prev => { const n = {...prev}; delete n[origIdx]; return n; })}
                        className="text-[10px] text-slate-400 hover:text-red-500"
                      >
                        reset
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-slate-500 flex-1">{displayHex} · {c.percentage}%</span>
                )}
                <button
                  onClick={() => setRemovedSpots(prev => new Set([...prev, origIdx]))}
                  className="text-[10px] text-red-400 hover:text-red-600 flex-shrink-0"
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Manually picked colors */}
      {manualColors.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Manually selected</div>
          {manualColors.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md border border-slate-300 flex-shrink-0" style={{ backgroundColor: c.hex }} />
              {c.pantone && <span className="text-xs font-semibold text-slate-700">{c.pantone.name}</span>}
              {c.pantone && <div className="w-3 h-3 rounded-sm border border-slate-200 flex-shrink-0" style={{ backgroundColor: c.pantone.hex }} />}
              <span className="text-[10px] text-slate-400">{c.hex}</span>
              <button onClick={() => removeManual(i)} className="text-[10px] text-red-400 hover:text-red-600 ml-auto">Remove</button>
            </div>
          ))}
        </div>
      )}

      {/* Eyedropper + manual color tools */}
      <div className="border-t border-slate-200 pt-2 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {imageUrl && (
            <button
              onClick={() => setShowEyedropper(!showEyedropper)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition ${showEyedropper ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "border-slate-200 text-slate-600 hover:bg-slate-100"}`}
            >
              {showEyedropper ? "Hide eyedropper" : "Pick from image"}
            </button>
          )}
          <ManualColorInput onPick={handlePickedColor} />
        </div>

        {showEyedropper && imageUrl && (
          <EyedropperPicker imageUrl={imageUrl} onPick={handlePickedColor} />
        )}
      </div>
    </div>
  );
}
