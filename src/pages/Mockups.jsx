import { useState, useEffect, useRef, useMemo } from "react";
import { Search, Download, Upload, RotateCcw, Loader2, FileText, Link2 } from "lucide-react";
import MockupCanvas from "../components/mockups/MockupCanvas";
import PlacementSelect from "../components/shared/PlacementSelect";
import { base44 } from "@/api/supabaseClient";
import { uploadFile } from "@/lib/uploadFile";
import { notify } from "@/lib/notify";
import { getShopPricingConfig, getDisplayName, getEnabledTechniques } from "../components/shared/pricing";
import { shopScope } from "@/lib/shopScope";
// jspdf loaded on demand inside generateProofPDF below

// Print-location options for the mockup. `value` MUST match a PRINT_AREAS
// key in MockupCanvas so the selection drives where the art snaps; `label`
// is what shows in the UI and gets baked onto the final mockup.
const PRINT_LOCATION_OPTIONS = [
  { value: "Front", label: "Full Front" },
  { value: "Left Chest", label: "Left Chest" },
  { value: "Left Sleeve", label: "Left Sleeve" },
  { value: "Right Sleeve", label: "Right Sleeve" },
  { value: "Back", label: "Full Back" },
];
function printLocationLabel(value) {
  return PRINT_LOCATION_OPTIONS.find(o => o.value === value)?.label || value;
}

// Distinct accent color per print location so the active location is
// visually obvious — drives the location selector's color, the on-screen
// caption, and the caption baked onto the exported mockup.
const LOCATION_COLORS = {
  "Front": "#0d9488",        // teal
  "Back": "#4f46e5",         // indigo
  "Left Chest": "#d97706",   // amber
  "Left Sleeve": "#db2777",  // pink
  "Right Sleeve": "#7c3aed", // violet
};
function locationColor(value) {
  return LOCATION_COLORS[value] || "#0f172a";
}

export default function Mockups() {
  const [styleQuery, setStyleQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [garment, setGarment] = useState(null);
  const [colors, setColors] = useState([]);
  const [selectedColor, setSelectedColor] = useState(null);
  const [garmentImg, setGarmentImg] = useState("");
  const [brandMatches, setBrandMatches] = useState([]);
  // Views are the mockup angles. Front + Back are the built-in pair
  // (catalog garments carry images for them); shops can add MORE views
  // (sleeves, etc.) via "+ More" — those require a custom garment photo.
  // Each id keys into the per-view maps below. Extra-view ids are unique.
  const [views, setViews] = useState(["Front", "Back"]);
  const [view, setView] = useState("Front");
  // Per-view artwork ({ src }), keyed by view id.
  const [artworks, setArtworks] = useState({});
  // Per-view print location (drives the baked mockup caption + color).
  // Defaults: Front → Full Front, Back → Full Back.
  const [printLocations, setPrintLocations] = useState({ Front: "Front", Back: "Back" });
  // Per-view decoration type (e.g. Screen Print, Embroidery, DTF). Empty
  // until set; falls back to the shop's first enabled technique via
  // decorationFor(). Each view can differ.
  const [decorationTypes, setDecorationTypes] = useState({ Front: "", Back: "" });
  const [generatingProof, setGeneratingProof] = useState(false);
  // Canvas refs keyed by view id (assigned in the preview map) — replaces
  // the old fixed frontRef/backRef so any number of views can export.
  const canvasRefs = useRef({});
  const fileRef = useRef(null);

  // Active orders + quotes the user can link a proof to. Loaded once on
  // mount; selection auto-fills customer/quantity/dates from the picked
  // record. Orders limited to non-completed jobs; quotes exclude
  // terminal states (Converted to Order is already in `orders`,
  // Declined/Voided don't need proofs).
  const [orders, setOrders] = useState([]);
  const [quotes, setQuotes] = useState([]);
  // id → customer, so the picker can show COMPANY first (orders carry no
  // denormalized company; we resolve it from the customer record).
  const [customersById, setCustomersById] = useState({});
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

  // Decoration types the shop actually has enabled (Screen Print always,
  // plus Embroidery / any custom techniques). Re-resolves once _pc
  // hydrates after the user loads, same pattern as maxColors above.
  const techniques = useMemo(
    () => getEnabledTechniques(getShopPricingConfig()),
    [user]
  );
  // Effective decoration for a view — the explicit pick, else the shop's
  // first enabled technique, else a hard fallback.
  const decorationFor = (v) => decorationTypes[v] || techniques[0] || "Screen Print";

  // Front/Back are the built-in pair; any other id is a user-added view.
  const isPrimaryView = (id) => id === "Front" || id === "Back";
  // Tab/label for a view: Front/Back stay literal; extra views are named
  // by their print location (e.g. "Left Sleeve", or a custom placement).
  const viewLabel = (id) =>
    isPrimaryView(id) ? id : (printLocationLabel(printLocations[id]) || "Placement");

  // Add an extra view (sleeve, custom angle…). Defaults to Left Sleeve;
  // it has no catalog image, so the user uploads a custom garment photo.
  function addView() {
    const id = `v${Date.now()}`;
    setViews((prev) => [...prev, id]);
    setPrintLocations((prev) => ({ ...prev, [id]: "Left Sleeve" }));
    setDecorationTypes((prev) => ({ ...prev, [id]: "" }));
    setViewSpecs((prev) => ({ ...prev, [id]: blankSpec() }));
    setView(id);
  }

  // Remove an extra view and clean up its per-view state. Front/Back can't
  // be removed.
  function removeView(id) {
    if (isPrimaryView(id)) return;
    const drop = (obj) => {
      const next = { ...obj };
      delete next[id];
      return next;
    };
    setViews((prev) => prev.filter((v) => v !== id));
    setArtworks(drop);
    setCustomGarmentImages(drop);
    setPrintLocations(drop);
    setDecorationTypes(drop);
    setViewSpecs(drop);
    setView((cur) => (cur === id ? "Front" : cur));
  }

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
        const [ordersRes, quotesRes, shopsRes, customersRes] = await Promise.all([
          base44.entities.Order.filter({ shop_owner: shopScope(me) }, "-created_date", 200),
          base44.entities.Quote.filter({ shop_owner: shopScope(me) }, "-created_date", 200),
          base44.entities.Shop.filter({ owner_email: me.email }),
          base44.entities.Customer.filter({ shop_owner: shopScope(me) }, "", 1000),
        ]);
        if (cancelled) return;
        setOrders((ordersRes || []).filter(o => o.status !== "Completed"));
        const TERMINAL_QUOTE_STATUSES = new Set(["Converted to Order", "Declined", "Voided"]);
        setQuotes((quotesRes || []).filter(q => !TERMINAL_QUOTE_STATUSES.has(q.status)));
        setShop((shopsRes || [])[0] || null);
        setCustomersById(Object.fromEntries((customersRes || []).map((c) => [c.id, c])));
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
    // Per-view print size + colors now live in `viewSpecs` (keyed by view
    // id) so sleeves and other added views get their own spec, not just
    // Front/Back.
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

  // Per-view print spec (size + colors), keyed by view id. Front/Back seed
  // the common 13×19 default; added views start blank. 16 color slots — the
  // visible count is driven by maxColors.
  const blankSpec = () => ({ w: "", h: "", colors: Array(16).fill("") });
  const [viewSpecs, setViewSpecs] = useState({
    Front: { w: "13", h: "19", colors: Array(16).fill("") },
    Back: { w: "13", h: "19", colors: Array(16).fill("") },
  });
  const specFor = (v) => viewSpecs[v] || blankSpec();
  function updateSpec(v, patch) {
    setViewSpecs(prev => ({ ...prev, [v]: { ...(prev[v] || blankSpec()), ...patch } }));
  }
  function updateSpecColor(v, idx, val) {
    setViewSpecs(prev => {
      const cur = prev[v] || blankSpec();
      const colors = [...cur.colors];
      colors[idx] = val;
      return { ...prev, [v]: { ...cur, colors } };
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
    // A custom photo uploaded for THIS view always wins — sleeves, custom
    // angles, or a manual override of the catalog front/back.
    if (customGarmentImages[v]) return customGarmentImages[v];
    // Extra (non Front/Back) views have no catalog image — show nothing
    // until the user uploads one, so they're prompted to.
    if (!isPrimaryView(v)) return "";
    if (garment?.isCustomUpload) {
      // Fall back to the Front photo if the user hasn't uploaded a
      // Back photo yet — better than showing an empty canvas.
      return customGarmentImages.Front || garmentImg;
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
      setArtworks((prev) => ({ ...prev, [view]: { src: ev.target.result } }));
    };
    reader.readAsDataURL(file);
    e.target.value = ""; // allow re-selecting the same file
  }

  async function exportPNG() {
    const ref = canvasRefs.current[view];
    if (!ref) return;
    const blob = await ref.exportPng();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `mockup-${garment?.styleNumber || "design"}-${selectedColor?.colorName || ""}-${viewLabel(view)}.png`;
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

      // ── Mockup images (every view that has artwork) ──
      // A single view renders large + centered; two or more tile two per
      // row (Front, Back, then any extra views like sleeves) with their
      // label underneath. The decoration · location caption is already
      // baked into each image by MockupCanvas.
      const proofViewIds = views.filter(
        (v) => artworks[v]?.src && canvasRefs.current[v] && getGarmentImageForView(v),
      );
      const single = proofViewIds.length === 1;
      const imgGap = 20;
      const imgSize = single ? cw * 0.6 : (cw - imgGap) / 2;
      const rowH = imgSize + 24;
      const mockupTop = y;
      let col = 0;
      let lastRow = 0;
      for (const v of proofViewIds) {
        const blob = await canvasRefs.current[v].exportPng();
        if (!blob) continue;
        const dataUrl = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(blob); });
        const row = Math.floor(col / 2);
        const ix = single ? m + (cw - imgSize) / 2 : m + (col % 2) * (imgSize + imgGap);
        const iy = mockupTop + row * rowH;
        doc.addImage(dataUrl, "PNG", ix, iy, imgSize, imgSize);
        doc.setFontSize(8);
        doc.setFont(undefined, "bold");
        doc.text(viewLabel(v).toUpperCase(), ix + imgSize / 2, iy + imgSize + 12, { align: "center" });
        lastRow = row;
        col++;
      }
      y = mockupTop + (proofViewIds.length ? (lastRow + 1) * rowH : 0) + 8;

      // ── Per-view print specs (size + colors) ──
      // One card per view that has artwork, headed "<decoration> —
      // <placement>" so it reflects what's actually being decorated and
      // where — no more hardcoded "Print"/"Front". Two cards per row,
      // wrapping for added views (sleeves, etc.).
      const specCols = 2;
      const specGap = 10;
      const specCardW = (cw - specGap) / specCols;
      const colorRows = maxColors;
      const sizeRowH = 16;
      const colorRowH = 12;
      const cardH = 12 + sizeRowH + colorRows * colorRowH;

      // Page-break guard so added views don't silently clip off the page.
      const estSpecH = Math.ceil(proofViewIds.length / specCols) * (cardH + 10);
      if (proofViewIds.length && y + estSpecH > ph - 40) { doc.addPage(); y = 40; }

      const specTop = y;
      doc.setFontSize(8);
      proofViewIds.forEach((v, i) => {
        const gx = i % specCols;
        const gyRow = Math.floor(i / specCols);
        const sx = m + gx * (specCardW + specGap);
        let cy = specTop + gyRow * (cardH + 10);
        const spec = specFor(v);
        // header — decoration + placement
        doc.setFillColor(...brandColor);
        doc.setTextColor(255, 255, 255);
        doc.rect(sx, cy, specCardW, 12, "F");
        doc.setFont(undefined, "bold");
        doc.text(`${decorationFor(v)} — ${viewLabel(v)}`.toUpperCase(), sx + 4, cy + 9);
        doc.setTextColor(0, 0, 0);
        doc.setFont(undefined, "normal");
        cy += 12;
        // size
        doc.rect(sx, cy, specCardW, sizeRowH);
        doc.setFont(undefined, "bold");
        doc.text("Size:", sx + 4, cy + 11);
        doc.setFont(undefined, "normal");
        doc.text(`${spec.w || "—"}" × ${spec.h || "—"}"`, sx + 40, cy + 11);
        cy += sizeRowH;
        // colors
        for (let ci = 0; ci < colorRows; ci++) {
          doc.rect(sx, cy, specCardW, colorRowH);
          doc.text(`${ci + 1}.`, sx + 4, cy + 9);
          doc.text(spec.colors[ci] || "", sx + 20, cy + 9);
          cy += colorRowH;
        }
      });
      const specRows = Math.ceil(proofViewIds.length / specCols);
      y = specTop + (specRows ? specRows * (cardH + 10) : 0) + 6;

      // ── Pre-press checklist + customer approval (per proof) ──
      const checklist = ["Check Spelling", "Spot Color Check", "Check Placement", "Registration", "Tape Registration Marks"];
      const halfW = (cw - specGap) / 2;
      const blockH = 14 + checklist.length * 13;
      if (y + blockH + 20 > ph - 30) { doc.addPage(); y = 40; }

      // checklist (left)
      doc.setFillColor(...brandColor);
      doc.setTextColor(255, 255, 255);
      doc.rect(m, y, halfW, 12, "F");
      doc.setFont(undefined, "bold");
      doc.text("Pre-press Checklist", m + 4, y + 9);
      doc.setTextColor(0, 0, 0);
      doc.setFont(undefined, "normal");
      checklist.forEach((item, ci) => {
        const cy = y + 14 + ci * 13;
        doc.text(item, m + 4, cy + 9);
        doc.rect(m + halfW - 16, cy + 1, 10, 10);
        doc.rect(m, cy, halfW, 13);
      });

      // customer approval (right)
      const sigX = m + halfW + specGap;
      doc.setFillColor(...brandColor);
      doc.setTextColor(255, 255, 255);
      doc.rect(sigX, y, halfW, 12, "F");
      doc.setFont(undefined, "bold");
      doc.text("Customer Approval", sigX + 4, y + 9);
      doc.setTextColor(0, 0, 0);
      doc.setFont(undefined, "normal");
      doc.text("Signature:", sigX + 4, y + 32);
      doc.line(sigX + 50, y + 32, sigX + halfW - 4, y + 32);
      doc.text("Date:", sigX + 4, y + 56);
      doc.line(sigX + 50, y + 56, sigX + halfW - 4, y + 56);

      y += blockH + 12;

      // Notes
      if (proofDetails.notes) {
        if (y + 30 > ph - 30) { doc.addPage(); y = 40; }
        doc.setFontSize(8);
        doc.setFont(undefined, "bold");
        doc.text("Notes:", m, y);
        doc.setFont(undefined, "normal");
        doc.text(proofDetails.notes, m, y + 12, { maxWidth: cw });
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

  const currentArtwork = artworks[view] || null;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Mockup Designer</h2>
          <p className="text-sm text-slate-500 mt-0.5">Create print mockups and art proofs</p>
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
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500">
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
                ? `Change Custom ${viewLabel(view)} Garment Photo`
                : `Upload Custom ${viewLabel(view)} Garment Photo`}
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
                    // Only bootstrap a "Custom" garment when NOTHING is
                    // loaded. With a catalog garment loaded, a custom photo
                    // just augments this view (e.g. a sleeve shot) without
                    // wiping the catalog selection.
                    const isFirstUpload = !garment;
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
            {(garment?.isCustomUpload || views.length > 2) && (
              <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>Photos:</span>
                {views.map((v, i) => (
                  <span key={v} className="flex items-center gap-2">
                    {i > 0 && <span className="text-slate-300">·</span>}
                    <span className={customGarmentImages[v] ? "text-emerald-600 font-semibold" : ""}>
                      {viewLabel(v)} {customGarmentImages[v] ? "✓" : "—"}
                    </span>
                  </span>
                ))}
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
                      <div className="text-xs text-slate-500">{m.resolvedTitle || m.description || ""}</div>
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
              <Upload className="w-4 h-4" /> {currentArtwork ? `Change ${viewLabel(view)} Artwork` : `Upload ${viewLabel(view)} Artwork`}
            </button>
            {currentArtwork && (
              <div className="text-xs text-slate-500">Tools appear below the preview</div>
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
              <label className="text-[10px] text-slate-500 block mb-0.5 flex items-center gap-1">
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
                        {(o.order_id || o.quote_id || o.id.slice(0, 8))} · {(customersById[o.customer_id] ? getDisplayName(customersById[o.customer_id]) : (o.company || o.customer_name)) || "Unknown"}
                        {o.status ? ` · ${o.status}` : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
                {quotes.length > 0 && (
                  <optgroup label="Quotes">
                    {quotes.map(q => (
                      <option key={q.id} value={`quote:${q.id}`}>
                        {(q.quote_id || q.id.slice(0, 8))} · {(customersById[q.customer_id] ? getDisplayName(customersById[q.customer_id]) : (q.company || q.customer_name)) || "Unknown"}
                        {q.status ? ` · ${q.status}` : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-500 block mb-0.5">Customer</label>
                <input value={proofDetails.customerName} onChange={e => updateProof({ customerName: e.target.value })}
                  placeholder="Customer name" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300" />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 block mb-0.5">Quote / Order #</label>
                <input value={proofDetails.quoteNumber} onChange={e => updateProof({ quoteNumber: e.target.value })}
                  placeholder="Q-2026-XXX" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300" />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 block mb-0.5">Date</label>
                <input type="date" value={proofDetails.dateOrdered} onChange={e => updateProof({ dateOrdered: e.target.value })}
                  className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300" />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 block mb-0.5">Due Date</label>
                <input type="date" value={proofDetails.dueDate} onChange={e => updateProof({ dueDate: e.target.value })}
                  className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300" />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 block mb-0.5">Quantity</label>
                <input value={proofDetails.quantity} onChange={e => updateProof({ quantity: e.target.value })}
                  placeholder="100" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300" />
              </div>
            </div>

            {/* Print spec for the ACTIVE view — labeled with the decoration
                + placement so it reflects what's decorated and where. Switch
                views (Front / Back / sleeves…) to edit each one's spec. */}
            <div className="border-t border-slate-100 pt-3 space-y-2">
              <label className="text-[10px] text-slate-500 block mb-1">
                {decorationFor(view)} Size — {viewLabel(view)} (inches)
              </label>
              <div className="flex gap-2">
                <input value={specFor(view).w} onChange={e => updateSpec(view, { w: e.target.value })}
                  placeholder="W" className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-300" />
                <span className="text-xs text-slate-500 self-center">x</span>
                <input value={specFor(view).h} onChange={e => updateSpec(view, { h: e.target.value })}
                  placeholder="H" className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-300" />
              </div>
            </div>

            {/* Colors for the active view */}
            <div className="border-t border-slate-100 pt-3">
              <label className="text-[10px] text-slate-500 block mb-1">
                {decorationFor(view)} Colors — {viewLabel(view)}
              </label>
              {specFor(view).colors.slice(0, maxColors).map((c, i) => (
                <input key={i} value={c} onChange={e => updateSpecColor(view, i, e.target.value)}
                  placeholder={`Color ${i + 1}`} className="w-full text-xs border border-slate-200 rounded px-2 py-1 mb-1 focus:outline-none focus:ring-1 focus:ring-teal-300" />
              ))}
            </div>

            {/* Services */}
            <div className="border-t border-slate-100 pt-3 space-y-1.5">
              <label className="text-[10px] text-slate-500 block">Services</label>
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
              <label className="text-[10px] text-slate-500 block mb-0.5">Notes</label>
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
              <button onClick={() => setArtworks(prev => { const n = { ...prev }; delete n[view]; return n; })}
                className="px-3 py-2.5 bg-white border border-slate-200 text-slate-500 rounded-xl hover:bg-slate-50 transition"
                title={`Clear ${viewLabel(view)} artwork`}>
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
            {/* Gate on `garment` only — NOT `selectedColor`. Custom
                uploads clear selectedColor, which used to hide these
                tabs and trap the user on Front; gating on garment keeps
                Front/Back switchable so both views can be uploaded. */}
            {garment && (
              <div className="flex flex-col items-center gap-2 mb-4">
                <div className="flex flex-wrap justify-center items-center gap-1">
                  {views.map(v => {
                    const hasArt = !!artworks[v];
                    const active = view === v;
                    return (
                      <span key={v} className="inline-flex items-center">
                        <button onClick={() => setView(v)}
                          className={`text-xs font-semibold px-4 py-1.5 rounded-lg transition ${active ? "bg-teal-600 text-white" : "border border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                          {viewLabel(v)} {hasArt && <span className="ml-1 text-emerald-400">*</span>}
                        </button>
                        {!isPrimaryView(v) && active && (
                          <button onClick={() => removeView(v)} title="Remove this view"
                            className="ml-0.5 text-slate-400 hover:text-rose-500 text-xs px-1">✕</button>
                        )}
                      </span>
                    );
                  })}
                  <button onClick={addView} title="Add a view (sleeve, etc.)"
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50 transition">
                    + More
                  </button>
                </div>
                {/* Decoration + print-location cells. Decoration options
                    come from the shop's enabled techniques; the location
                    selector is tinted to that location's color so the
                    active location is obvious. Both feed the caption baked
                    onto the final mockup PNG / Art Proof PDF, per view. */}
                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Decoration</span>
                    <select
                      value={decorationFor(view)}
                      onChange={e => setDecorationTypes(prev => ({ ...prev, [view]: e.target.value }))}
                      className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-teal-300"
                    >
                      {techniques.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Print Location</span>
                    <PlacementSelect
                      value={printLocations[view]}
                      onChange={val => setPrintLocations(prev => ({ ...prev, [view]: val }))}
                      options={PRINT_LOCATION_OPTIONS}
                      selectStyle={{ color: locationColor(printLocations[view]), borderColor: locationColor(printLocations[view]) }}
                      selectClassName="text-xs font-semibold border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-offset-1"
                      inputClassName="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-teal-300"
                      customPlaceholder="e.g. Nape, Hem, Pocket"
                    />
                  </div>
                </div>
              </div>
            )}
            {views.map(v => (
              <div key={v} className={view === v ? "" : "hidden"}>
                <MockupCanvas
                  ref={(el) => { canvasRefs.current[v] = el; }}
                  garmentImageUrl={getGarmentImageForView(v)}
                  artworkUrl={artworks[v]?.src || null}
                  location={printLocations[v]}
                  caption={`${decorationFor(v)} · ${printLocationLabel(printLocations[v]) || "Placement"}`}
                  captionColor={locationColor(printLocations[v])}
                  label={garment ? `${garment.brandName || ""} ${garment.styleNumber || garment.resolvedStyleNumber || ""}${selectedColor ? ` — ${selectedColor.colorName}` : ""}`.trim() : null}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
