import { useState, useRef } from "react";
import { Search, Download, Upload, RotateCcw, Loader2, FileText } from "lucide-react";
import MockupCanvas from "../components/mockups/MockupCanvas";
// jspdf loaded on demand inside generateProofPDF below

const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

export default function Mockups() {
  const [styleQuery, setStyleQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [garment, setGarment] = useState(null);
  const [colors, setColors] = useState([]);
  const [selectedColor, setSelectedColor] = useState(null);
  const [garmentImg, setGarmentImg] = useState("");
  const [frontArtwork, setFrontArtwork] = useState(null);
  const [backArtwork, setBackArtwork] = useState(null);
  const [brandMatches, setBrandMatches] = useState([]);
  const [view, setView] = useState("Front");
  const [generatingProof, setGeneratingProof] = useState(false);
  const frontRef = useRef(null);
  const backRef = useRef(null);
  const fileRef = useRef(null);

  // Proof detail fields
  const [proofDetails, setProofDetails] = useState({
    customerName: "",
    quoteNumber: "",
    dateOrdered: new Date().toISOString().split("T")[0],
    dueDate: "",
    quantity: "",
    frontPrintW: "13",
    frontPrintH: "19",
    backPrintW: "13",
    backPrintH: "19",
    frontColors: ["", "", "", "", "", "", "", ""],
    backColors: ["", "", "", "", "", "", "", ""],
    neckLabels: false,
    foldBagLabel: false,
    colorChange: false,
    specialtyInk: false,
    notes: "",
  });

  function updateProof(patch) {
    setProofDetails(prev => ({ ...prev, ...patch }));
  }

  function updateFrontColor(idx, val) {
    setProofDetails(prev => {
      const c = [...prev.frontColors];
      c[idx] = val;
      return { ...prev, frontColors: c };
    });
  }

  function updateBackColor(idx, val) {
    setProofDetails(prev => {
      const c = [...prev.backColors];
      c[idx] = val;
      return { ...prev, backColors: c };
    });
  }

  function pickMatch(product) {
    setGarment(product);
    setBrandMatches([]);
    const colorsArr = (product.colors || []).filter(c => c.colorName);
    setColors(colorsArr);
    if (colorsArr.length) {
      setSelectedColor(colorsArr[0]);
      setGarmentImg(colorsArr[0].imageUrl || "");
    }
  }

  async function searchStyle() {
    if (!styleQuery.trim()) return;
    setSearching(true);
    setBrandMatches([]);
    try {
      const code = styleQuery.trim();
      const [ssRes, acRes] = await Promise.allSettled([
        fetch(`${SUPABASE_FUNC_URL}/functions/v1/ssLookupStyle`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ styleNumber: code }),
        }).then(r => r.json()),
        fetch(`${SUPABASE_FUNC_URL}/functions/v1/acLookupStyle`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ styleCode: code }),
        }).then(r => r.json()),
      ]);
      const allMatches = [
        ...(ssRes.status === "fulfilled" && !ssRes.value.error ? ssRes.value.matches || [] : []),
        ...(acRes.status === "fulfilled" && !acRes.value.error ? acRes.value.matches || [] : []),
      ];
      if (!allMatches.length) { alert("Style not found"); return; }
      if (allMatches.length === 1) {
        pickMatch(allMatches[0]);
      } else {
        setBrandMatches(allMatches);
      }
    } catch (err) {
      alert("Search failed: " + err.message);
    } finally {
      setSearching(false);
    }
  }

  function selectColor(color) {
    setSelectedColor(color);
    setView("Front");
    setGarmentImg(color.imageUrl || "");
  }

  function getGarmentImageForView(v) {
    if (!selectedColor || !garment) return garmentImg;
    const colorUpper = (selectedColor.colorName || "").toUpperCase();
    const allImgs = garment.images || [];
    if (v === "Back") {
      const backImg = allImgs.find(img => {
        const t = (img.colour || img.type || "").toUpperCase();
        return t === colorUpper + " - BACK" || t === colorUpper + " BACK";
      });
      if (backImg?.url) return backImg.url;
    }
    return selectedColor.imageUrl || garmentImg;
  }

  function handleArtworkUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (view === "Back") setBackArtwork({ src: ev.target.result });
      else setFrontArtwork({ src: ev.target.result });
    };
    reader.readAsDataURL(file);
  }

  async function exportPNG() {
    const ref = view === "Back" ? backRef.current : frontRef.current;
    if (!ref) return;
    const blob = await ref.exportPng();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `mockup-${garment?.styleNumber || "design"}-${selectedColor?.colorName || ""}-${view}.png`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function generateProofPDF() {
    setGeneratingProof(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      const m = 36; // margin
      const cw = pw - m * 2; // content width
      const brandColor = [45, 80, 45];

      // ── Header bar ──
      doc.setFillColor(...brandColor);
      doc.rect(0, 0, pw, 40, "F");
      doc.setFontSize(10);
      doc.setTextColor(255, 255, 255);
      doc.text("ART PROOF", m, 26);

      // Quote # and customer
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      let y = 60;
      doc.setFont(undefined, "bold");
      doc.text(`Quote Number:`, pw - m - 200, y);
      doc.setFont(undefined, "normal");
      doc.text(proofDetails.quoteNumber || "—", pw - m - 80, y);
      y += 18;
      doc.setFont(undefined, "bold");
      doc.text(`Customer:`, pw - m - 200, y);
      doc.setFont(undefined, "normal");
      doc.text(proofDetails.customerName || "—", pw - m - 80, y);

      // ── Green divider ──
      y += 20;
      doc.setFillColor(...brandColor);
      doc.rect(0, y, pw, 6, "F");
      y += 16;

      // ── Info grid ──
      const garmentName = garment ? `${garment.brandName || ""} ${garment.styleNumber || garment.resolvedStyleNumber || ""}`.trim() : "—";
      const colorName = selectedColor?.colorName || "—";

      // Left column — order details
      doc.setFontSize(9);
      const infoRows = [
        ["Date Ordered:", proofDetails.dateOrdered || "—"],
        ["Due Date:", proofDetails.dueDate || "—"],
        ["Quantity:", proofDetails.quantity || "—"],
        ["Garment:", garmentName],
        ["Color:", colorName],
      ];
      for (const [label, val] of infoRows) {
        doc.setFont(undefined, "bold");
        doc.text(label, m, y);
        doc.setFont(undefined, "normal");
        doc.text(val, m + 80, y);
        y += 14;
      }

      // Right column — services checklist
      const servicesX = pw - m - 180;
      let sy = y - 14 * 5;
      doc.setFont(undefined, "bold");
      doc.setFontSize(9);
      doc.setFillColor(...brandColor);
      doc.setTextColor(255, 255, 255);
      doc.rect(servicesX - 4, sy - 10, 184, 14, "F");
      doc.text("Additional Services", servicesX, sy);
      doc.setTextColor(0, 0, 0);
      sy += 14;
      const services = [
        ["Screen Printed Neck Labels", proofDetails.neckLabels],
        ["Fold, Bag, Label", proofDetails.foldBagLabel],
        ["Color Change", proofDetails.colorChange],
        ["Specialty Ink", proofDetails.specialtyInk],
      ];
      doc.setFont(undefined, "normal");
      for (const [name, checked] of services) {
        doc.text(name, servicesX, sy);
        doc.rect(servicesX + 155, sy - 8, 10, 10);
        if (checked) {
          doc.setFont(undefined, "bold");
          doc.text("X", servicesX + 157.5, sy);
          doc.setFont(undefined, "normal");
        }
        sy += 14;
      }

      y += 10;

      // ── Mockup images ──
      const hasBack = !!backArtwork;
      const mockupSize = hasBack ? (cw - 20) / 2 : cw * 0.6;
      const mockupX = hasBack ? m : m + (cw - mockupSize) / 2;
      const mockupY = y;

      // Render front mockup
      if (frontRef.current) {
        const blob = await frontRef.current.exportPng();
        if (blob) {
          const dataUrl = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(blob); });
          doc.addImage(dataUrl, "PNG", mockupX, mockupY, mockupSize, mockupSize);
          doc.setFontSize(8);
          doc.setFont(undefined, "bold");
          doc.text("FRONT", mockupX + mockupSize / 2, mockupY + mockupSize + 12, { align: "center" });
        }
      }

      // Render back mockup only if back artwork was added
      if (hasBack && backRef.current) {
        const blob = await backRef.current.exportPng();
        if (blob) {
          const dataUrl = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(blob); });
          doc.addImage(dataUrl, "PNG", m + mockupSize + 20, mockupY, mockupSize, mockupSize);
          doc.setFontSize(8);
          doc.setFont(undefined, "bold");
          doc.text("BACK", m + mockupSize + 20 + mockupSize / 2, mockupY + mockupSize + 12, { align: "center" });
        }
      }

      y = mockupY + mockupSize + 28;

      // ── Print sizes ──
      const numCols = hasBack ? 3 : 2;
      const colW = (cw - (numCols - 1) * 10) / numCols;
      doc.setFontSize(8);
      const printSections = [
        { label: "Print Size - Front", w: proofDetails.frontPrintW, h: proofDetails.frontPrintH },
      ];
      if (hasBack) printSections.push({ label: "Print Size - Back", w: proofDetails.backPrintW, h: proofDetails.backPrintH });
      printSections.forEach((sec, i) => {
        const sx = m + i * (colW + 10);
        doc.setFillColor(...brandColor);
        doc.setTextColor(255, 255, 255);
        doc.rect(sx, y, colW, 12, "F");
        doc.setFont(undefined, "bold");
        doc.text(sec.label, sx + 4, y + 9);
        doc.setTextColor(0, 0, 0);
        doc.setFont(undefined, "normal");
        doc.text(`Width: ${sec.w || "—"}"`, sx + 4, y + 24);
        doc.text(`Height: ${sec.h || "—"}"`, sx + colW / 2, y + 24);
        doc.rect(sx, y, colW, 30);
      });

      y += 40;

      // ── Print colors ──
      const colorSections = [
        { label: "Print Colors - Front", colors: proofDetails.frontColors },
      ];
      if (hasBack) colorSections.push({ label: "Print Colors - Back", colors: proofDetails.backColors });
      colorSections.forEach((sec, i) => {
        const sx = m + i * (colW + 10);
        doc.setFillColor(...brandColor);
        doc.setTextColor(255, 255, 255);
        doc.rect(sx, y, colW, 12, "F");
        doc.setFont(undefined, "bold");
        doc.text(sec.label, sx + 4, y + 9);
        doc.setTextColor(0, 0, 0);
        doc.setFont(undefined, "normal");
        for (let ci = 0; ci < 8; ci++) {
          const cy = y + 14 + ci * 13;
          doc.text(`${ci + 1}.`, sx + 4, cy + 9);
          doc.text(sec.colors[ci] || "", sx + 20, cy + 9);
          doc.rect(sx, cy, colW, 13);
        }
      });

      // Pre-press checklist in last column
      const checkX = m + colorSections.length * (colW + 10);
      doc.setFillColor(...brandColor);
      doc.setTextColor(255, 255, 255);
      doc.rect(checkX, y, colW, 12, "F");
      doc.setFont(undefined, "bold");
      doc.text("Pre-press Checklist", checkX + 4, y + 9);
      doc.setTextColor(0, 0, 0);
      doc.setFont(undefined, "normal");
      const checklist = ["Check Spelling", "Spot Color Check", "Check Placement", "Registration", "Tape Registration Marks"];
      checklist.forEach((item, ci) => {
        const cy = y + 14 + ci * 13;
        doc.text(item, checkX + 4, cy + 9);
        doc.rect(checkX + colW - 16, cy + 1, 10, 10);
        doc.rect(checkX, cy, colW, 13);
      });

      // Customer signature
      const sigY = y + 14 + checklist.length * 13 + 10;
      doc.setFont(undefined, "bold");
      doc.text("Customer Signature:", checkX + 4, sigY);
      doc.setFont(undefined, "normal");
      doc.line(checkX + 4, sigY + 20, checkX + colW - 4, sigY + 20);
      doc.text("x.", checkX + 4, sigY + 18);

      // Notes
      if (proofDetails.notes) {
        const notesY = y + 14 + 8 * 13 + 10;
        doc.setFontSize(8);
        doc.setFont(undefined, "bold");
        doc.text("Notes:", m, notesY);
        doc.setFont(undefined, "normal");
        doc.text(proofDetails.notes, m, notesY + 12, { maxWidth: colW * 2 });
      }

      // ── Footer ──
      doc.setFillColor(...brandColor);
      doc.rect(0, ph - 24, pw, 24, "F");
      doc.setFontSize(9);
      doc.setTextColor(255, 255, 255);
      doc.text("www.biotamfg.com", pw / 2, ph - 9, { align: "center" });

      doc.save(`Art-Proof-${proofDetails.quoteNumber || proofDetails.customerName || "proof"}.pdf`);
    } finally {
      setGeneratingProof(false);
    }
  }

  const currentArtwork = view === "Back" ? backArtwork : frontArtwork;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Mockup Designer</h2>
          <p className="text-sm text-slate-400 mt-0.5">Create print mockups and art proofs</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left panel - Controls */}
        <div className="space-y-4">
          {/* Style search */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Garment</div>
            <div className="flex gap-2">
              <input value={styleQuery} onChange={e => setStyleQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && searchStyle()}
                placeholder="Style # (e.g. 5001, 1717)"
                className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              <button onClick={searchStyle} disabled={searching}
                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition disabled:opacity-50">
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </button>
            </div>
            {garment && (
              <div className="text-sm font-semibold text-emerald-600">
                {garment.brandName} {garment.styleNumber || garment.resolvedStyleNumber}
              </div>
            )}
            {brandMatches.length > 1 && (
              <div className="space-y-1.5">
                <div className="text-xs text-slate-500">Multiple brands found — select one:</div>
                {brandMatches.map((m, i) => (
                  <button key={i} onClick={() => pickMatch(m)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 transition text-left text-sm">
                    {(m.styleImage || m.colors?.[0]?.imageUrl) && (
                      <img src={m.styleImage || m.colors[0].imageUrl} alt="" className="w-8 h-8 rounded object-contain bg-slate-50" />
                    )}
                    <div>
                      <div className="font-semibold text-slate-800">{m.brandName} {m.styleNumber || m.resolvedStyleNumber}</div>
                      <div className="text-xs text-slate-400">{m.resolvedTitle || m.description || ""}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Color picker */}
          {colors.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Color</div>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                {colors.map(c => (
                  <button key={c.colorName} onClick={() => selectColor(c)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition ${selectedColor?.colorName === c.colorName ? "bg-indigo-600 text-white border-indigo-600" : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300"}`}>
                    {c.colorName}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Artwork upload */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Artwork</div>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleArtworkUpload} className="hidden" />
            <button onClick={() => fileRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 bg-slate-50 hover:bg-slate-100 border-2 border-dashed border-slate-200 rounded-xl py-4 text-sm text-slate-500 transition">
              <Upload className="w-4 h-4" /> {currentArtwork ? `Change ${view} Artwork` : `Upload ${view} Artwork`}
            </button>
            {currentArtwork && (
              <div className="text-xs text-slate-400">Tools appear below the preview</div>
            )}
          </div>

          {/* Proof Details */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Proof Details</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Customer</label>
                <input value={proofDetails.customerName} onChange={e => updateProof({ customerName: e.target.value })}
                  placeholder="Customer name" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Quote #</label>
                <input value={proofDetails.quoteNumber} onChange={e => updateProof({ quoteNumber: e.target.value })}
                  placeholder="Q-2026-XXX" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Date</label>
                <input type="date" value={proofDetails.dateOrdered} onChange={e => updateProof({ dateOrdered: e.target.value })}
                  className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Due Date</label>
                <input type="date" value={proofDetails.dueDate} onChange={e => updateProof({ dueDate: e.target.value })}
                  className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Quantity</label>
                <input value={proofDetails.quantity} onChange={e => updateProof({ quantity: e.target.value })}
                  placeholder="100" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
            </div>

            {/* Print dimensions */}
            <div className="border-t border-slate-100 pt-3 space-y-2">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Front Print Size (inches)</label>
                <div className="flex gap-2">
                  <input value={proofDetails.frontPrintW} onChange={e => updateProof({ frontPrintW: e.target.value })}
                    placeholder="W" className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                  <span className="text-xs text-slate-400 self-center">x</span>
                  <input value={proofDetails.frontPrintH} onChange={e => updateProof({ frontPrintH: e.target.value })}
                    placeholder="H" className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                </div>
              </div>
              {backArtwork && (
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Back Print Size (inches)</label>
                  <div className="flex gap-2">
                    <input value={proofDetails.backPrintW} onChange={e => updateProof({ backPrintW: e.target.value })}
                      placeholder="W" className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                    <span className="text-xs text-slate-400 self-center">x</span>
                    <input value={proofDetails.backPrintH} onChange={e => updateProof({ backPrintH: e.target.value })}
                      placeholder="H" className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                  </div>
                </div>
              )}
            </div>

            {/* Print colors */}
            <div className={`grid ${backArtwork ? "grid-cols-2" : "grid-cols-1"} gap-3 border-t border-slate-100 pt-3`}>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Front Colors</label>
                {proofDetails.frontColors.slice(0, 4).map((c, i) => (
                  <input key={i} value={c} onChange={e => updateFrontColor(i, e.target.value)}
                    placeholder={`Color ${i + 1}`} className="w-full text-xs border border-slate-200 rounded px-2 py-1 mb-1 focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                ))}
              </div>
              {backArtwork && (
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Back Colors</label>
                  {proofDetails.backColors.slice(0, 4).map((c, i) => (
                    <input key={i} value={c} onChange={e => updateBackColor(i, e.target.value)}
                      placeholder={`Color ${i + 1}`} className="w-full text-xs border border-slate-200 rounded px-2 py-1 mb-1 focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                  ))}
                </div>
              )}
            </div>

            {/* Services */}
            <div className="border-t border-slate-100 pt-3 space-y-1.5">
              <label className="text-[10px] text-slate-400 block">Services</label>
              {[
                ["neckLabels", "Screen Printed Neck Labels"],
                ["foldBagLabel", "Fold, Bag, Label"],
                ["colorChange", "Color Change"],
                ["specialtyInk", "Specialty Ink"],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={proofDetails[key]} onChange={e => updateProof({ [key]: e.target.checked })}
                    className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600" />
                  {label}
                </label>
              ))}
            </div>

            {/* Notes */}
            <div className="border-t border-slate-100 pt-3">
              <label className="text-[10px] text-slate-400 block mb-0.5">Notes</label>
              <textarea value={proofDetails.notes} onChange={e => updateProof({ notes: e.target.value })}
                rows={2} placeholder="Special instructions..."
                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <button onClick={exportPNG} disabled={!garmentImg}
                className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold py-2.5 rounded-xl transition disabled:opacity-40">
                <Download className="w-4 h-4" /> Download PNG
              </button>
              <button onClick={() => { if (view === "Back") setBackArtwork(null); else setFrontArtwork(null); }}
                className="px-3 py-2.5 bg-white border border-slate-200 text-slate-500 rounded-xl hover:bg-slate-50 transition"
                title={`Clear ${view} artwork`}>
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
            <button onClick={generateProofPDF} disabled={!garmentImg || generatingProof}
              className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold py-2.5 rounded-xl transition disabled:opacity-40">
              <FileText className="w-4 h-4" /> {generatingProof ? "Generating..." : "Generate Art Proof PDF"}
            </button>
          </div>
        </div>

        {/* Right panel - Preview */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-2xl border border-slate-100 p-6">
            {garment && selectedColor && (
              <div className="flex justify-center gap-1 mb-4">
                {["Front", "Back"].map(v => {
                  const hasArt = v === "Back" ? !!backArtwork : !!frontArtwork;
                  return (
                    <button key={v} onClick={() => setView(v)}
                      className={`text-xs font-semibold px-4 py-1.5 rounded-lg transition ${view === v ? "bg-indigo-600 text-white" : "border border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                      {v} {hasArt && <span className="ml-1 text-emerald-400">*</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <div className={view === "Front" ? "" : "hidden"}>
              <MockupCanvas
                ref={frontRef}
                garmentImageUrl={getGarmentImageForView("Front")}
                artworkUrl={frontArtwork?.src || null}
                location="Front"
                label={selectedColor ? `${garment?.brandName} ${garment?.styleNumber} — ${selectedColor.colorName} · Front` : null}
              />
            </div>
            <div className={view === "Back" ? "" : "hidden"}>
              <MockupCanvas
                ref={backRef}
                garmentImageUrl={getGarmentImageForView("Back")}
                artworkUrl={backArtwork?.src || null}
                location="Back"
                label={selectedColor ? `${garment?.brandName} ${garment?.styleNumber} — ${selectedColor.colorName} · Back` : null}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
