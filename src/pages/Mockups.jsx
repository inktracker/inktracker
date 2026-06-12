import { useState, useEffect, useRef, useMemo } from "react";
import { Search, Download, Upload, RotateCcw, Loader2, FileText, Link2 } from "lucide-react";
import MockupCanvas from "../components/mockups/MockupCanvas";
import { base44 } from "@/api/supabaseClient";
import { uploadFile } from "@/lib/uploadFile";
import { notify } from "@/lib/notify";
import { getShopPricingConfig } from "../components/shared/pricing";
import { shopScope } from "@/lib/shopScope";
// jspdf loaded on demand inside generateProofPDF below

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

  // Active orders + quotes the user can link a proof to. Loaded once on
  // mount; selection auto-fills customer/quantity/dates from the picked
  // record. Orders limited to non-completed jobs; quotes exclude
  // terminal states (Converted to Order is already in `orders`,
  // Declined/Voided don't need proofs).
  const [orders, setOrders] = useState([]);
  const [quotes, setQuotes] = useState([]);
  // Composite selection key: "order:<uuid>" or "quote:<uuid>". Empty
  // string = standalone (no link).
  const [selectedTargetKey, setSelectedTargetKey] = useState("");
  const [linking, setLinking] = useState(false);
  // Shop identity used by the Art Proof PDF header (logo + name) and
  // footer (website). Falls back to the proof rendering without those
  // accents when the load fails.
  const [user, setUser] = useState(null);
  const [shop, setShop] = useState(null);

  // Color slot count is driven by the shop's pricing config (set on
  // /Account → Pricing → Max Colors). Defaults to 8 when the config
  // hasn't loaded yet so the UI never collapses to zero slots.
  // useMemo so the slice in the render is stable across renders even
  // though `getShopPricingConfig()` itself reads a module-level var.
  const maxColors = useMemo(
    () => Number(getShopPricingConfig()?.maxColors) || 8,
    [user] // re-resolves once the user load also hydrates _pc
  );

  // Per-view custom garment uploads. Catalog garments swap images by
  // view via getGarmentImageForView; custom uploads need their own
  // store since they aren't tied to a supplier API response.
  const [customGarmentImages, setCustomGarmentImages] = useState({ Front: "", Back: "" });

  // Pulls the latest orders/quotes for the picker. Promoted out of the
  // mount-effect so it can be re-run on tab focus and on the dropdown's
  // own focus event — otherwise quotes/orders deleted in another tab
  // keep appearing here until the page is reloaded.
  const loadTargetsRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    async function loadTargets() {
      try {
        const me = await base44.auth.me();
        if (!me?.email || cancelled) return;
        setUser(me);
        const [ordersRes, quotesRes, shopsRes] = await Promise.all([
          base44.entities.Order.filter({ shop_owner: shopScope(me) }, "-created_date", 200),
          base44.entities.Quote.filter({ shop_owner: shopScope(me) }, "-created_date", 200),
          base44.entities.Shop.filter({ owner_email: me.email }),
        ]);
        if (cancelled) return;
        setOrders((ordersRes || []).filter(o => o.status !== "Completed"));
        const TERMINAL_QUOTE_STATUSES = new Set(["Converted to Order", "Declined", "Voided"]);
        setQuotes((quotesRes || []).filter(q => !TERMINAL_QUOTE_STATUSES.has(q.status)));
        setShop((shopsRes || [])[0] || null);
      } catch {
        // Best-effort — the rest of the page still works without the picker.
      }
    }
    loadTargetsRef.current = loadTargets;
    loadTargets();
    function onVisible() {
      if (document.visibilityState === "visible") loadTargets();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

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
    // Sized to cover any realistic shop max (typical maxColors is 6–10).
    // The visible slot count is driven by the shop's pricing config in
    // the render — see `maxColors` below.
    frontColors: Array(16).fill(""),
    backColors: Array(16).fill(""),
    neckLabels: false,
    foldBagLabel: false,
    colorChange: false,
    specialtyInk: false,
    notes: "",
  });

  function updateProof(patch) {
    setProofDetails(prev => ({ ...prev, ...patch }));
  }

  // Resolve a composite "type:id" key back to { type, record } from
  // whichever list (orders/quotes) holds it. Returns null if not found.
  function resolveTarget(key) {
    if (!key) return null;
    const [type, id] = String(key).split(":");
    if (type === "order") {
      const record = orders.find(o => o.id === id);
      return record ? { type, record } : null;
    }
    if (type === "quote") {
      const record = quotes.find(q => q.id === id);
      return record ? { type, record } : null;
    }
    return null;
  }

  // Picking a target: hydrate the proof fields from the order or quote
  // so the user doesn't have to retype customer/quote#/quantity/due-date.
  // Doesn't touch design fields (print sizes, colors, notes) — those
  // belong to the proof itself, not the underlying job.
  function pickTargetToLink(key) {
    setSelectedTargetKey(key);
    const target = resolveTarget(key);
    if (!target) return;
    const r = target.record;
    const qty = (r.line_items || []).reduce((sum, li) => {
      const sizes = li.sizes || {};
      return sum + Object.values(sizes).reduce((s, v) => s + (parseInt(v, 10) || 0), 0);
    }, 0);
    setProofDetails(prev => ({
      ...prev,
      customerName: r.customer_name || prev.customerName,
      quoteNumber:  r.quote_id || r.order_id || prev.quoteNumber,
      dueDate:      r.due_date || prev.dueDate,
      dateOrdered:  r.date || prev.dateOrdered,
      quantity:     qty ? String(qty) : prev.quantity,
    }));
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
        base44.functions.invoke("ssLookupStyle", { styleNumber: code }),
        base44.functions.invoke("acLookupStyle", { styleCode: code }),
      ]);
      // Distinguish "neither supplier had this style" from "we couldn't
      // reach either supplier" — they produce the same empty array but
      // mean very different things to the user.
      const ssReached = ssRes.status === "fulfilled" && !ssRes.value.error && !ssRes.value.data?.error;
      const acReached = acRes.status === "fulfilled" && !acRes.value.error && !acRes.value.data?.error;
      const allMatches = [
        ...(ssReached ? ssRes.value.data?.matches || [] : []),
        ...(acReached ? acRes.value.data?.matches || [] : []),
      ];
      if (!allMatches.length) {
        // Prefer the supplier's own error message when one is set —
        // distinguishes "no API credentials" from "supplier had no rows".
        const supplierError =
          (ssRes.status === "fulfilled" && ssRes.value.data?.error) ||
          (acRes.status === "fulfilled" && acRes.value.data?.error) ||
          (ssRes.status === "fulfilled" && ssRes.value.error?.message) ||
          (acRes.status === "fulfilled" && acRes.value.error?.message);
        if (!ssReached && !acReached) {
          notify.error(supplierError || "Couldn't reach S&S or AS Colour. Check your supplier API credentials in Account settings.");
        } else if (supplierError && !ssReached) {
          // S&S errored (likely auth) and AS Colour just had nothing —
          // surface the S&S problem since that's the one the user can fix.
          notify.error(supplierError);
        } else {
          notify.info("Style not found");
        }
        return;
      }
      if (allMatches.length === 1) {
        pickMatch(allMatches[0]);
      } else {
        setBrandMatches(allMatches);
      }
    } catch (err) {
      notify.error("Search failed", err);
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
    if (garment?.isCustomUpload) {
      // Fall back to the Front photo if the user hasn't uploaded a
      // Back photo yet — better than showing an empty canvas.
      return customGarmentImages[v] || customGarmentImages.Front || garmentImg;
    }
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

  // Accepts an optional `mode`:
  //   "download" (default) — triggers a local download via doc.save
  //   "blob"               — returns the PDF as a Blob so the caller can
  //                          upload + attach it to an order instead
  async function generateProofPDF(mode = "download") {
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

      // Shop identity block — logo (left) + shop name (under or beside)
      // — fills the previously-blank space under the ART PROOF header.
      // Loaded via the page's `user` / `shop` state on mount. Best-effort:
      // a failed logo fetch falls through to text-only without aborting
      // the PDF.
      const shopName = (user?.shop_name || user?.full_name || shop?.shop_name || "").trim();
      const logoUrl = (user?.logo_url || shop?.logo_url || "").trim();
      const identityY = 60;
      let identityTextX = m;
      if (logoUrl) {
        try {
          // Embed the logo at its full source resolution and let jsPDF
          // scale it down to fit ~36pt tall on the page. The PDF viewer
          // keeps the original pixel data, so zooming stays crisp.
          // Previously we rasterized to an 80px canvas first, which
          // baked in pixelation that print/zoom couldn't recover from.
          const logo = await new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
              const canvas = document.createElement("canvas");
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
              canvas.getContext("2d").drawImage(img, 0, 0);
              resolve({ url: canvas.toDataURL("image/png"), w: img.naturalWidth, h: img.naturalHeight });
            };
            img.onerror = reject;
            img.src = logoUrl;
          });
          const targetH = 36; // pt
          const displayH = Math.min(targetH, logo.h);
          const displayW = logo.w * (displayH / logo.h);
          doc.addImage(logo.url, "PNG", m, identityY - 14, displayW, displayH);
          identityTextX = m + displayW + 8;
        } catch {
          // Logo unreachable — fall back to shop-name-only on the left.
        }
      }
      if (shopName) {
        doc.setFontSize(14);
        doc.setFont(undefined, "bold");
        doc.setTextColor(0, 0, 0);
        doc.text(shopName, identityTextX, identityY + 4);
      }

      // Quote # and customer (right column)
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
        for (let ci = 0; ci < maxColors; ci++) {
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
      // Footer reads from the shop's own website field. Falls back to
      // the shop name when no website is set, and to a generic
      // "InkTracker" string when neither is available — never the
      // platform's own biotamfg.com.
      const footerText = (
        (user?.website || shop?.website || "").trim() ||
        shopName ||
        "InkTracker"
      ).replace(/^https?:\/\//, "");
      doc.text(footerText, pw / 2, ph - 9, { align: "center" });

      const filename = `Art-Proof-${proofDetails.quoteNumber || proofDetails.customerName || "proof"}.pdf`;
      if (mode === "blob") return { blob: doc.output("blob"), filename };
      doc.save(filename);
      return null;
    } finally {
      setGeneratingProof(false);
    }
  }

  // Generates the proof PDF, uploads it, and appends it to the selected
  // order's selected_artwork so it shows up in the order's artwork panel
  // during production. Doesn't replace previous proofs on the same order
  // — additional proofs stack (the shop can manually remove old ones).
  async function saveAndLinkProof() {
    const target = resolveTarget(selectedTargetKey);
    if (!target) {
      notify.error("Pick an order or quote to link the proof to first.");
      return;
    }
    setLinking(true);
    try {
      const result = await generateProofPDF("blob");
      if (!result?.blob) throw new Error("Couldn't generate the proof PDF.");
      const file = new File([result.blob], result.filename, { type: "application/pdf" });
      const { path, file_url } = await uploadFile(file);
      const r = target.record;
      const next = [
        ...(r.selected_artwork || []),
        {
          id: `proof-${Date.now()}`,
          name: result.filename,
          // Store BOTH the storage path (canonical, lets us re-sign on
          // every view) and the legacy public URL (backward compat for
          // anonymous/customer-facing reads while the bucket is still
          // public). Once the bucket flips private, the path is the
          // load-bearing field; file_url becomes stale.
          path,
          url: file_url,
          file_url,
          type: "proof",
          uploaded_at: new Date().toISOString(),
        },
      ];
      const Entity = target.type === "order" ? base44.entities.Order : base44.entities.Quote;
      const updated = await Entity.update(r.id, { selected_artwork: next });
      if (target.type === "order") {
        setOrders(prev => prev.map(o => (o.id === updated.id ? updated : o)));
      } else {
        setQuotes(prev => prev.map(q => (q.id === updated.id ? updated : q)));
      }
      const label = r.order_id || r.quote_id || target.type;
      notify.success(`Proof linked to ${label}.`);
    } catch (err) {
      notify.error("Couldn't link the proof", err);
    } finally {
      setLinking(false);
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
                className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300" />
              <button onClick={searchStyle} disabled={searching}
                className="px-3 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition disabled:opacity-50">
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </button>
            </div>

            {/* Custom garment upload — for shops using InkTracker just for
                proofs, or with garments not in the S&S / AS Colour APIs.
                The uploaded image becomes the canvas background; no
                catalog lookup, no color picker. Reading as a data URL
                keeps it local to the session — the proof PDF embeds it,
                so nothing is lost when the page is refreshed. */}
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-400">
              <div className="flex-1 h-px bg-slate-100" />
              <span>or</span>
              <div className="flex-1 h-px bg-slate-100" />
            </div>
            {/* Per-view custom uploads. The label changes with the
                current view (Front / Back), matching the existing
                artwork upload pattern further down the page. Either
                view can be uploaded first; the canvas swap follows the
                view toggle in the preview panel. */}
            <label className="w-full flex items-center justify-center gap-2 bg-slate-50 hover:bg-slate-100 border-2 border-dashed border-slate-200 rounded-xl py-2.5 text-xs text-slate-500 cursor-pointer transition">
              <Upload className="w-3.5 h-3.5" />
              {customGarmentImages[view]
                ? `Change Custom ${view} Garment Photo`
                : `Upload Custom ${view} Garment Photo`}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    const dataUrl = reader.result;
                    const isFirstUpload = !garment?.isCustomUpload;
                    if (isFirstUpload) {
                      setGarment({
                        brandName: "Custom",
                        styleNumber: file.name.replace(/\.[^.]+$/, ""),
                        isCustomUpload: true,
                      });
                      setColors([]);
                      setSelectedColor(null);
                      setBrandMatches([]);
                    }
                    setCustomGarmentImages(prev => ({ ...prev, [view]: dataUrl }));
                    // Keep `garmentImg` in sync with the Front photo so
                    // all the `disabled={!garmentImg}` gates further
                    // down still let the user generate / link proofs.
                    if (view === "Front" || isFirstUpload) {
                      setGarmentImg(dataUrl);
                    }
                  };
                  reader.readAsDataURL(file);
                  e.target.value = ""; // allow re-selecting the same file
                }}
              />
            </label>
            {garment?.isCustomUpload && (
              <div className="text-[11px] text-slate-400 flex items-center gap-2">
                <span>Custom:</span>
                <span className={customGarmentImages.Front ? "text-emerald-600 font-semibold" : ""}>
                  Front {customGarmentImages.Front ? "✓" : "—"}
                </span>
                <span>·</span>
                <span className={customGarmentImages.Back ? "text-emerald-600 font-semibold" : ""}>
                  Back {customGarmentImages.Back ? "✓" : "—"}
                </span>
              </div>
            )}

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
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-200 hover:border-teal-300 hover:bg-teal-50 transition text-left text-sm">
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
                    className={`text-xs px-2.5 py-1 rounded-full border transition ${selectedColor?.colorName === c.colorName ? "bg-teal-600 text-white border-teal-600" : "bg-white border-slate-200 text-slate-600 hover:border-teal-300"}`}>
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

            {/* Link to existing order or quote — auto-populates the
                fields below and enables "Save & Link" so the proof
                shows up on the linked record. Orders and quotes are
                grouped so the user can pick either. */}
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5 flex items-center gap-1">
                <Link2 className="w-3 h-3" /> Link to Order or Quote
              </label>
              <select
                value={selectedTargetKey}
                onChange={e => pickTargetToLink(e.target.value)}
                onFocus={() => loadTargetsRef.current?.()}
                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300 bg-white"
              >
                <option value="">— Standalone proof (no link) —</option>
                {orders.length > 0 && (
                  <optgroup label="Orders">
                    {orders.map(o => (
                      <option key={o.id} value={`order:${o.id}`}>
                        {(o.order_id || o.quote_id || o.id.slice(0, 8))} · {o.customer_name || "Unknown"}
                        {o.status ? ` · ${o.status}` : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
                {quotes.length > 0 && (
                  <optgroup label="Quotes">
                    {quotes.map(q => (
                      <option key={q.id} value={`quote:${q.id}`}>
                        {(q.quote_id || q.id.slice(0, 8))} · {q.customer_name || "Unknown"}
                        {q.status ? ` · ${q.status}` : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Customer</label>
                <input value={proofDetails.customerName} onChange={e => updateProof({ customerName: e.target.value })}
                  placeholder="Customer name" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Quote / Order #</label>
                <input value={proofDetails.quoteNumber} onChange={e => updateProof({ quoteNumber: e.target.value })}
                  placeholder="Q-2026-XXX" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Date</label>
                <input type="date" value={proofDetails.dateOrdered} onChange={e => updateProof({ dateOrdered: e.target.value })}
                  className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Due Date</label>
                <input type="date" value={proofDetails.dueDate} onChange={e => updateProof({ dueDate: e.target.value })}
                  className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Quantity</label>
                <input value={proofDetails.quantity} onChange={e => updateProof({ quantity: e.target.value })}
                  placeholder="100" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300" />
              </div>
            </div>

            {/* Print dimensions */}
            <div className="border-t border-slate-100 pt-3 space-y-2">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Front Print Size (inches)</label>
                <div className="flex gap-2">
                  <input value={proofDetails.frontPrintW} onChange={e => updateProof({ frontPrintW: e.target.value })}
                    placeholder="W" className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-300" />
                  <span className="text-xs text-slate-400 self-center">x</span>
                  <input value={proofDetails.frontPrintH} onChange={e => updateProof({ frontPrintH: e.target.value })}
                    placeholder="H" className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-300" />
                </div>
              </div>
              {backArtwork && (
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Back Print Size (inches)</label>
                  <div className="flex gap-2">
                    <input value={proofDetails.backPrintW} onChange={e => updateProof({ backPrintW: e.target.value })}
                      placeholder="W" className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-300" />
                    <span className="text-xs text-slate-400 self-center">x</span>
                    <input value={proofDetails.backPrintH} onChange={e => updateProof({ backPrintH: e.target.value })}
                      placeholder="H" className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-300" />
                  </div>
                </div>
              )}
            </div>

            {/* Print colors */}
            <div className={`grid ${backArtwork ? "grid-cols-2" : "grid-cols-1"} gap-3 border-t border-slate-100 pt-3`}>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Front Colors</label>
                {proofDetails.frontColors.slice(0, maxColors).map((c, i) => (
                  <input key={i} value={c} onChange={e => updateFrontColor(i, e.target.value)}
                    placeholder={`Color ${i + 1}`} className="w-full text-xs border border-slate-200 rounded px-2 py-1 mb-1 focus:outline-none focus:ring-1 focus:ring-teal-300" />
                ))}
              </div>
              {backArtwork && (
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Back Colors</label>
                  {proofDetails.backColors.slice(0, maxColors).map((c, i) => (
                    <input key={i} value={c} onChange={e => updateBackColor(i, e.target.value)}
                      placeholder={`Color ${i + 1}`} className="w-full text-xs border border-slate-200 rounded px-2 py-1 mb-1 focus:outline-none focus:ring-1 focus:ring-teal-300" />
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
                    className="w-3.5 h-3.5 rounded border-slate-300 text-teal-600" />
                  {label}
                </label>
              ))}
            </div>

            {/* Notes */}
            <div className="border-t border-slate-100 pt-3">
              <label className="text-[10px] text-slate-400 block mb-0.5">Notes</label>
              <textarea value={proofDetails.notes} onChange={e => updateProof({ notes: e.target.value })}
                rows={2} placeholder="Special instructions..."
                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-teal-300" />
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
            <button onClick={() => generateProofPDF("download")} disabled={!garmentImg || generatingProof || linking}
              className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold py-2.5 rounded-xl transition disabled:opacity-40">
              <FileText className="w-4 h-4" /> {generatingProof && !linking ? "Generating..." : "Generate Art Proof PDF"}
            </button>
            <button
              onClick={saveAndLinkProof}
              disabled={!garmentImg || !selectedTargetKey || generatingProof || linking}
              title={!selectedTargetKey ? "Pick an order or quote above to enable linking" : "Generate proof PDF and attach it to the linked record"}
              className="w-full flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold py-2.5 rounded-xl transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {linking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              {linking ? "Linking..." : "Save & Link"}
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
                      className={`text-xs font-semibold px-4 py-1.5 rounded-lg transition ${view === v ? "bg-teal-600 text-white" : "border border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
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
