import { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { RotateCcw, FlipHorizontal, FlipVertical, Crosshair, Wand2 } from "lucide-react";

// Print areas sized to 13x19 portrait max (ratio ~0.684:1)
const PRINT_AREAS = {
  Front: { x: 0.24, y: 0.25, w: 0.52, h: 0.52 },
  Back: { x: 0.24, y: 0.23, w: 0.52, h: 0.52 },
  "Left Sleeve": { x: 0.10, y: 0.28, w: 0.16, h: 0.18 },
  "Right Sleeve": { x: 0.74, y: 0.28, w: 0.16, h: 0.18 },
  "Left Chest": { x: 0.48, y: 0.30, w: 0.17, h: 0.14 },
};

export { PRINT_AREAS };

// Convert image to single ink color with hard threshold (no shades)
function makeOneColor(imgSrc, hexColor, threshold = 128) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      const r = parseInt(hexColor.slice(1,3), 16);
      const g = parseInt(hexColor.slice(3,5), 16);
      const b = parseInt(hexColor.slice(5,7), 16);
      for (let i = 0; i < d.data.length; i += 4) {
        if (d.data[i+3] < 10) continue;
        const lum = d.data[i] * 0.299 + d.data[i+1] * 0.587 + d.data[i+2] * 0.114;
        if (lum < threshold) {
          // Dark enough → ink
          d.data[i] = r; d.data[i+1] = g; d.data[i+2] = b;
          d.data[i+3] = 255;
        } else {
          // Light → transparent (no ink)
          d.data[i+3] = 0;
        }
      }
      ctx.putImageData(d, 0, 0);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => resolve(imgSrc);
    img.src = imgSrc;
  });
}

// Remove all pixels matching the clicked color (global, not just flood fill)
// This catches enclosed areas inside letters that flood fill can't reach
function floodFillRemove(imgSrc, clickX, clickY, tolerance) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, c.width, c.height);
      const data = imageData.data;
      const px = Math.floor(clickX * c.width), py = Math.floor(clickY * c.height);
      const idx = (py * c.width + px) * 4;
      const tr = data[idx], tg = data[idx+1], tb = data[idx+2];
      const tol = tolerance * tolerance * 3;
      // Global pass: remove every pixel matching the target color
      for (let i = 0; i < data.length; i += 4) {
        if (data[i+3] < 10) continue;
        const dr = data[i] - tr, dg = data[i+1] - tg, db = data[i+2] - tb;
        if (dr*dr + dg*dg + db*db <= tol) {
          data[i+3] = 0;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => resolve(imgSrc);
    img.src = imgSrc;
  });
}

const MockupCanvas = forwardRef(function MockupCanvas({
  garmentImageUrl,
  artworkUrl: artworkUrlProp,
  initialPosition,
  location = "Front",
  onPositionChange,
  onArtworkChange,
  compact = false,
  showTools = true,
  label,
}, ref) {
  const area = PRINT_AREAS[location] || PRINT_AREAS.Front;
  const [artworkPos, setArtworkPos] = useState(
    initialPosition || { x: area.x, y: area.y, w: area.w, h: area.h * 0.7 }
  );
  const [artworkSize, setArtworkSize] = useState(null);
  const [processedArtwork, setProcessedArtwork] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [resizing, setResizing] = useState(null);
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [oneColor, setOneColor] = useState(false);
  const [inkColor, setInkColor] = useState("#000000");
  const [inkThreshold, setInkThreshold] = useState(128);
  const [contrast, setContrast] = useState(100);
  const [wandMode, setWandMode] = useState(false);
  const [wandTolerance, setWandTolerance] = useState(30);
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const originalArtRef = useRef(null);

  const artworkUrl = processedArtwork || artworkUrlProp;

  // Store original for reset
  useEffect(() => {
    if (artworkUrlProp) originalArtRef.current = artworkUrlProp;
  }, [artworkUrlProp]);

  // Load artwork dimensions
  useEffect(() => {
    if (!artworkUrlProp) { setProcessedArtwork(null); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      setArtworkSize({ width: img.width, height: img.height });
      const aspect = img.width / img.height;
      const w = area.w;
      const h = Math.min(w / aspect, area.h);
      setArtworkPos(prev => initialPosition || { x: area.x, y: area.y, w, h });
    };
    img.src = artworkUrlProp;
  }, [artworkUrlProp]);

  // Apply one-color conversion
  useEffect(() => {
    if (!oneColor || !originalArtRef.current) { if (!oneColor) setProcessedArtwork(null); return; }
    makeOneColor(originalArtRef.current, inkColor, inkThreshold).then(setProcessedArtwork).catch(() => {});
  }, [oneColor, inkColor, inkThreshold]);

  // Wand click handler
  async function handleWandClick(e) {
    if (!wandMode || !artworkUrl) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;
    if (mx < artworkPos.x || mx > artworkPos.x + artworkPos.w ||
        my < artworkPos.y || my > artworkPos.y + artworkPos.h) return;
    const localX = (mx - artworkPos.x) / artworkPos.w;
    const localY = (my - artworkPos.y) / artworkPos.h;
    const newSrc = await floodFillRemove(artworkUrl, localX, localY, wandTolerance);
    setProcessedArtwork(newSrc);
    onArtworkChange?.(newSrc);
  }

  // Expose exportPng via ref
  useImperativeHandle(ref, () => ({
    exportPng: () => {
      return new Promise((resolve) => {
        const canvas = canvasRef.current || document.createElement("canvas");
        const size = 1200;
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!garmentImageUrl) { resolve(null); return; }
        const gImg = new Image();
        gImg.crossOrigin = "anonymous";
        gImg.onload = () => {
          // Maintain aspect ratio — center the garment in the square
          const aspect = gImg.width / gImg.height;
          let dw = size, dh = size, dx = 0, dy = 0;
          if (aspect > 1) { dh = size / aspect; dy = (size - dh) / 2; }
          else if (aspect < 1) { dw = size * aspect; dx = (size - dw) / 2; }
          ctx.fillStyle = "#f8fafc";
          ctx.fillRect(0, 0, size, size);
          ctx.drawImage(gImg, dx, dy, dw, dh);
          if (artworkUrl) {
            const aImg = new Image();
            aImg.crossOrigin = "anonymous";
            aImg.onload = () => {
              const ax = artworkPos.x * size, ay = artworkPos.y * size;
              const aw = artworkPos.w * size, ah = artworkPos.h * size;
              ctx.save();
              ctx.translate(ax + aw/2, ay + ah/2);
              ctx.rotate(rotation * Math.PI / 180);
              ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
              ctx.filter = `contrast(${contrast}%)`;
              ctx.drawImage(aImg, -aw/2, -ah/2, aw, ah);
              ctx.restore();
              canvas.toBlob(blob => resolve(blob), "image/png");
            };
            aImg.onerror = () => canvas.toBlob(blob => resolve(blob), "image/png");
            aImg.src = artworkUrl;
          } else {
            canvas.toBlob(blob => resolve(blob), "image/png");
          }
        };
        gImg.onerror = () => resolve(null);
        gImg.src = garmentImageUrl;
      });
    },
    getPosition: () => artworkPos,
  }));

  const handleMouseDown = useCallback((e) => {
    if (wandMode) { handleWandClick(e); return; }
    const container = containerRef.current;
    if (!container || !artworkUrl) return;
    const rect = container.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;

    // Check resize handle (bottom-right corner)
    const handleSize = 0.03;
    const hx = artworkPos.x + artworkPos.w;
    const hy = artworkPos.y + artworkPos.h;
    if (Math.abs(mx - hx) < handleSize && Math.abs(my - hy) < handleSize) {
      e.preventDefault();
      setResizing({ startX: mx, startY: my, startW: artworkPos.w, startH: artworkPos.h });
      return;
    }

    if (mx >= artworkPos.x && mx <= artworkPos.x + artworkPos.w &&
        my >= artworkPos.y && my <= artworkPos.y + artworkPos.h) {
      e.preventDefault();
      setDragging({ startX: mx - artworkPos.x, startY: my - artworkPos.y });
    }
  }, [artworkUrl, artworkPos, wandMode]);

  const handleMouseMove = useCallback((e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;

    if (resizing) {
      const dw = mx - resizing.startX;
      const newW = Math.max(0.05, Math.min(0.9, resizing.startW + dw));
      const aspect = artworkSize ? artworkSize.width / artworkSize.height : 1;
      const newH = newW / aspect;
      setArtworkPos(prev => ({ ...prev, w: newW, h: newH }));
      return;
    }

    if (dragging) {
      const newPos = {
        ...artworkPos,
        x: Math.max(0, Math.min(1 - artworkPos.w, mx - dragging.startX)),
        y: Math.max(0, Math.min(1 - artworkPos.h, my - dragging.startY)),
      };
      setArtworkPos(newPos);
      onPositionChange?.(newPos);
    }
  }, [dragging, resizing, artworkPos, artworkSize]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
    setResizing(null);
  }, []);

  useEffect(() => {
    if (dragging || resizing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [dragging, resizing, handleMouseMove, handleMouseUp]);

  function centerArtwork() {
    setArtworkPos(prev => ({
      ...prev,
      x: (1 - prev.w) / 2,
      y: area.y + (area.h - prev.h) / 2,
    }));
  }

  function resetAll() {
    setProcessedArtwork(null);
    setRotation(0); setFlipH(false); setFlipV(false);
    setOneColor(false); setInkThreshold(128); setContrast(100); setWandMode(false);
    if (artworkSize) {
      const aspect = artworkSize.width / artworkSize.height;
      const w = area.w;
      const h = Math.min(w / aspect, area.h);
      setArtworkPos({ x: area.x, y: area.y, w, h });
    }
  }

  const maxW = compact ? 400 : 600;
  const transforms = [
    rotation ? `rotate(${rotation}deg)` : "",
    flipH ? "scaleX(-1)" : "",
    flipV ? "scaleY(-1)" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className="space-y-3">
      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative mx-auto bg-slate-50 rounded-xl overflow-hidden select-none"
        style={{ maxWidth: maxW, aspectRatio: "1/1", cursor: wandMode ? "crosshair" : "default" }}
        onMouseDown={handleMouseDown}
      >
        {garmentImageUrl ? (
          <img src={garmentImageUrl} alt="Garment" className="w-full h-full object-contain" crossOrigin="anonymous" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-300 text-sm">
            No garment image
          </div>
        )}


        {/* Artwork overlay */}
        {artworkUrl && garmentImageUrl && (
          <div
            className={`absolute ${wandMode ? "" : dragging ? "cursor-grabbing" : "cursor-grab"}`}
            style={{
              left: `${artworkPos.x * 100}%`, top: `${artworkPos.y * 100}%`,
              width: `${artworkPos.w * 100}%`, height: `${artworkPos.h * 100}%`,
            }}
          >
            <img src={artworkUrl} alt="Artwork" className="w-full h-full object-contain" draggable={false}
              style={{ transform: transforms, filter: contrast !== 100 ? `contrast(${contrast}%)` : undefined }} />
            {/* Resize handle */}
            {!wandMode && (
              <div className="absolute -bottom-1.5 -right-1.5 w-4 h-4 bg-white border-2 border-indigo-500 rounded-sm cursor-nwse-resize" />
            )}
            {/* Remove button */}
            {!wandMode && onArtworkChange && (
              <button onClick={(e) => { e.stopPropagation(); onArtworkChange(null); setProcessedArtwork(null); }}
                className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600 shadow">
                ✕
              </button>
            )}
          </div>
        )}
      </div>

      {label && <div className="text-center text-xs text-slate-500">{label}</div>}

      {/* Toolbar */}
      {showTools && artworkUrl && garmentImageUrl && (
        <div className="bg-slate-50 rounded-xl border border-slate-200 p-3 space-y-3">
          {/* Quick actions row */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button onClick={centerArtwork} title="Center"
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-white transition text-slate-500">
              <Crosshair className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setFlipH(v => !v)} title="Flip horizontal"
              className={`p-1.5 rounded-lg border transition ${flipH ? "bg-indigo-100 border-indigo-300 text-indigo-600" : "border-slate-200 hover:bg-white text-slate-500"}`}>
              <FlipHorizontal className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setFlipV(v => !v)} title="Flip vertical"
              className={`p-1.5 rounded-lg border transition ${flipV ? "bg-indigo-100 border-indigo-300 text-indigo-600" : "border-slate-200 hover:bg-white text-slate-500"}`}>
              <FlipVertical className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setRotation(r => (r + 90) % 360)} title="Rotate 90"
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-white transition text-slate-500">
              <RotateCcw className="w-3.5 h-3.5" style={{ transform: "scaleX(-1)" }} />
            </button>
            <div className="w-px h-5 bg-slate-200 mx-1" />
            <button onClick={() => setWandMode(v => !v)} title="Remove background"
              className={`p-1.5 rounded-lg border transition ${wandMode ? "bg-violet-100 border-violet-300 text-violet-600" : "border-slate-200 hover:bg-white text-slate-500"}`}>
              <Wand2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={resetAll} title="Reset to original"
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-white transition text-slate-500 ml-auto">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Wand tolerance */}
          {wandMode && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 font-semibold w-16">Tolerance</span>
              <input type="range" min="5" max="80" value={wandTolerance}
                onChange={e => setWandTolerance(parseInt(e.target.value))}
                className="flex-1 h-1.5" />
              <span className="text-[10px] text-slate-400 w-6 text-right">{wandTolerance}</span>
            </div>
          )}

          {/* Make One Color */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button onClick={() => setOneColor(v => !v)}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition ${oneColor ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-200 text-slate-600 hover:bg-white"}`}>
                {oneColor ? "One Color ON" : "Make One Color"}
              </button>
              {oneColor && (
                <input type="color" value={inkColor} onChange={e => setInkColor(e.target.value)}
                  className="w-7 h-7 rounded border border-slate-200 cursor-pointer p-0" title="Ink color" />
              )}
            </div>
            {oneColor && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500 font-semibold w-16">Threshold</span>
                <input type="range" min="30" max="230" value={inkThreshold}
                  onChange={e => setInkThreshold(parseInt(e.target.value))}
                  className="flex-1 h-1.5" />
                <span className="text-[10px] text-slate-400 w-6 text-right">{inkThreshold}</span>
              </div>
            )}
          </div>

          {/* Contrast */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 font-semibold w-16">Contrast</span>
            <input type="range" min="50" max="200" value={contrast}
              onChange={e => setContrast(parseInt(e.target.value))}
              className="flex-1 h-1.5" />
            <span className="text-[10px] text-slate-400 w-8 text-right">{contrast}%</span>
          </div>

          {/* Rotation */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 font-semibold w-16">Rotation</span>
            <input type="range" min="0" max="359" value={rotation}
              onChange={e => setRotation(parseInt(e.target.value))}
              className="flex-1 h-1.5" />
            <span className="text-[10px] text-slate-400 w-8 text-right">{rotation}°</span>
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
});

export default MockupCanvas;
