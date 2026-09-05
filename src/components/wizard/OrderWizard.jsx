import { useState, useRef } from "react";
import { calcLinkedLinePrice, calcQuoteTotalsWithLinking, buildLinkedQtyMap, uid, getWizardRushDisplay, getDefaultTechnique } from "../shared/pricing";
import { supabase } from "@/api/supabaseClient";
import { uploadFile } from "@/lib/uploadFile";
import { getEffectiveCost } from "@/lib/wizard/getEffectiveCost";
import { analyzeColors } from "@/lib/colorAnalyzer";
import { notify } from "@/lib/notify";
import { brand, darken, tint } from "@/lib/branding";
import ConfigureStep from "@/components/wizard/steps/ConfigureStep";
import DetailsStep from "@/components/wizard/steps/DetailsStep";
import ReviewStep from "@/components/wizard/steps/ReviewStep";
import PriceSidebar from "@/components/wizard/steps/PriceSidebar";
import ColorPreviewModal from "@/components/wizard/steps/ColorPreviewModal";
import WizardSuccessScreen from "@/components/wizard/steps/WizardSuccessScreen";
import { buildWizardQuote, getWizardValidationIssues } from "@/components/wizard/steps/wizardQuote";

export const DEFAULT_WIZARD_STYLES = [
  // T-Shirts
  { id:"ts-staple", garment:"T-Shirts", styleNumber:"5001", brand:"AS Colour", tag:"Staple",
    hoverDescription:"Mid weight, 5.3 oz, 100% combed cotton, 70+ colours" },
  { id:"ts-classic", garment:"T-Shirts", styleNumber:"5026", brand:"AS Colour", tag:"Classic",
    hoverDescription:"Mid weight, 5.3 oz, regular fit classic tee" },
  { id:"ts-heavy", garment:"T-Shirts", styleNumber:"5080", brand:"AS Colour", tag:"Heavy",
    hoverDescription:"Heavy weight, 7.1 oz, 100% combed cotton" },
  { id:"ts-organic", garment:"T-Shirts", styleNumber:"5001G", brand:"AS Colour", tag:"Organic",
    hoverDescription:"Mid weight, 5.3 oz, 100% organic combed cotton" },
  // Long Sleeve
  { id:"ls-staple", garment:"Long Sleeve", styleNumber:"5020", brand:"AS Colour", tag:"Staple",
    hoverDescription:"Mid weight, 5.3 oz, 100% combed cotton L/S" },
  { id:"ls-ink", garment:"Long Sleeve", styleNumber:"5009", brand:"AS Colour", tag:"Ink",
    hoverDescription:"Mid weight, durable L/S tee" },
  { id:"ls-heavy", garment:"Long Sleeve", styleNumber:"5081", brand:"AS Colour", tag:"Heavy",
    hoverDescription:"Heavy weight L/S tee, 7.1 oz combed cotton" },
  { id:"ls-organic", garment:"Long Sleeve", styleNumber:"5020G", brand:"AS Colour", tag:"Organic",
    hoverDescription:"Mid weight, 100% organic combed cotton L/S" },
  // Hoodies
  { id:"hd-supply", garment:"Hoodies", styleNumber:"5101", brand:"AS Colour", tag:"Supply",
    hoverDescription:"Mid weight, cotton-rich pullover hood" },
  { id:"hd-stencil", garment:"Hoodies", styleNumber:"5102", brand:"AS Colour", tag:"Stencil",
    hoverDescription:"Mid-heavy weight, premium hood" },
  { id:"hd-heavy", garment:"Hoodies", styleNumber:"5146", brand:"AS Colour", tag:"Heavy",
    hoverDescription:"Heavy weight, 13 oz premium hood" },
  { id:"hd-relax", garment:"Hoodies", styleNumber:"5161", brand:"AS Colour", tag:"Relax",
    hoverDescription:"Relaxed fit, heavyweight hood" },
  // Crewnecks
  // NOTE: 5100S (Supply) and 5130S (United) intentionally omitted — AS
  // Colour's API returns matches for both but ships zero color/cost
  // data. Including them as platform defaults would seed every new
  // shop with two tiles that the runtime guard has to refuse to quote.
  { id:"cn-relax", garment:"Crewnecks", styleNumber:"5160", brand:"AS Colour", tag:"Relax",
    hoverDescription:"Relaxed fit, mid-weight 9.4 oz crew" },
  { id:"cn-heavy", garment:"Crewnecks", styleNumber:"5145", brand:"AS Colour", tag:"Heavy",
    hoverDescription:"Heavy weight, 13 oz crew" },
  // Tank Tops
  { id:"tk-barnard", garment:"Tank Tops", styleNumber:"5025", brand:"AS Colour", tag:"Barnard",
    hoverDescription:"Light weight, cotton singlet" },
  { id:"tk-classic", garment:"Tank Tops", styleNumber:"5073", brand:"AS Colour", tag:"Classic",
    hoverDescription:"Mid weight, 220 GSM classic tank" },
  { id:"tk-staple", garment:"Tank Tops", styleNumber:"5090", brand:"AS Colour", tag:"Staple",
    hoverDescription:"Regular fit staple tank" },
  { id:"tk-stonewash", garment:"Tank Tops", styleNumber:"5039", brand:"AS Colour", tag:"Stone Wash",
    hoverDescription:"Stone wash barnard tank" },
  // Hats
  { id:"ht-stock", garment:"Hats", styleNumber:"1100", brand:"AS Colour", tag:"Stock",
    hoverDescription:"6-panel cotton twill cap" },
  { id:"ht-trucker", garment:"Hats", styleNumber:"1102", brand:"AS Colour", tag:"Trucker",
    hoverDescription:"Faded trucker cap" },
  // 1103 (Finn 5-panel) intentionally omitted — same reason as 5100S/5130S.
  { id:"ht-cord", garment:"Hats", styleNumber:"1110", brand:"AS Colour", tag:"Cord",
    hoverDescription:"Corduroy cap" },
];

const STEPS = ["Configure","Details","Review"];

export default function OrderWizard({ onSubmit, styles: stylesProp, shopOwner, shop }) {
  const POPULAR_STYLES = Array.isArray(stylesProp) && stylesProp.length > 0 ? stylesProp : DEFAULT_WIZARD_STYLES;
  // Per-shop brand color drives all primary CTAs + active states +
  // dark-band backgrounds. Falls back to the InkTracker default teal
  // when no shop is provided or the shop hasn't set one.
  // bcDark = 30% darker for the right sidebar's dark band.
  // bcDarker = 50% darker for the sidebar's border.
  // bcTint = 8% alpha for hover/light backgrounds (replaces bg-[var(--brand-tint)]).
  const bc = brand(shop);
  const bcDark = darken(bc, 30);
  const bcDarker = darken(bc, 50);
  const bcTint = tint(bc, 0.08);
  // CSS variables let JSX use `text-[var(--brand)]` etc. via Tailwind
  // arbitrary-value classes throughout the tree without prop drilling.
  const brandStyle = {
    "--brand": bc,
    "--brand-dark": bcDark,
    "--brand-darker": bcDarker,
    "--brand-tint": bcTint,
  };
  const [step, setStep] = useState(1);
  const blankGarment = () => ({
    id: uid(), style: null, color: "", sizes: {},
  });
  const [garments, setGarments] = useState([blankGarment()]);
  const [activeIdx, setActiveIdx] = useState(0);
  // Run-level imprint / artwork / color-analysis state. Every garment in
  // the run is printed the same way, so the prints + artwork live here
  // (not on each garment). Customers who want different prints submit
  // separate quote requests — see the inline microcopy near Add Garment.
  const [imprints, setImprints] = useState([
    { id: uid(), location: "Front", colors: 1, pantones: "", technique: getDefaultTechnique(), details: "" },
  ]);
  const [artFiles, setArtFiles] = useState({});
  const [colorResults, setColorResults] = useState({});
  // Convenience aliases for the active garment
  const g = garments[activeIdx] || blankGarment();
  const style = g.style;
  const color = g.color;
  const sizes = g.sizes;
  // Setters that update the active garment in the array
  function setG(patch) {
    setGarments(prev => prev.map((gg, i) => i === activeIdx ? { ...gg, ...patch } : gg));
  }
  function setStyle(v) {
    if (typeof v === "function") {
      setGarments(prev => prev.map((gg, i) => i === activeIdx ? { ...gg, style: v(gg.style) } : gg));
    } else {
      setG({ style: v });
    }
  }
  function setColor(v) { setG({ color: v }); }
  function setSizes(fn) { setGarments(prev => prev.map((gg, i) => i === activeIdx ? { ...gg, sizes: typeof fn === "function" ? fn(gg.sizes) : fn } : gg)); }

  const [rush, setRush] = useState(false);
  const [contact, setContact] = useState({ name:"", email:"", phone:"", company:"", notes:"", dueDate:"", taxExempt:false, taxId:"" });
  const [submitted, setSubmitted] = useState(false);
  const sizesRef = useRef(null);
  const [uploading, setUploading] = useState({});
  const [ssLookupInput, setSsLookupInput] = useState("");
  const [ssLookupLoading, setSsLookupLoading] = useState(false);
  const [ssLookupError, setSsLookupError] = useState("");
  const [ssMatches, setSsMatches] = useState([]);
  const selectedGarment = g.selectedGarment || "";
  function setSelectedGarment(v) { setG({ selectedGarment: v }); }
  // setPreviewStyle is referenced by resetWizard + clear-on-garment-change
  // handlers; getter not consumed (in-card preview not implemented yet).
  const [_previewStyle, setPreviewStyle] = useState(null);
  // ── Anti-bot tripwires ────────────────────────────────────────────────
  // (1) Honeypot — a hidden text input that's invisible to a real user
  //     but will be filled by any naïve scraping bot that auto-completes
  //     every form field on a page. Server rejects the submission if
  //     this value is non-empty.
  // (2) Form-open timestamp — a captcha-lite signal. Real humans take
  //     at least a few seconds to read the page, pick a style, type
  //     contact details, etc. Bots typically submit within a fraction
  //     of a second. Server rejects submissions under ~3 seconds.
  // Both signals travel into the SECURITY DEFINER RPC and are enforced
  // there; the client-side hint in handleSubmit is for UX only.
  const [_botHoneypot, setBotHoneypot] = useState("");
  const wizardOpenedAtRef = useRef(Date.now());
  const [enrichingStyle, setEnrichingStyle] = useState(false);
  const [enrichedPreviews, setEnrichedPreviews] = useState({
    // Pre-cached AS Colour previews so style cards render instantly
    "ts-staple":    { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/182/images/10681/5001_STAPLE_TEE_BLACK__80682.1774216143.386.513.jpg?c=1", name: "AS Colour 5001", description: "Staple Tee", weight: "180 GSM" },
    "ts-classic":   { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/201/images/7079/5026_CLASSIC_TEE_BLACK__28327.1751340338.386.513.jpg?c=1", name: "AS Colour 5026", description: "Classic Tee", weight: "220 GSM" },
    "ts-heavy":     { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/497/images/4897/5080_HEAVY_TEE_BLACK__25837.1731177423.386.513.jpg?c=1", name: "AS Colour 5080", description: "Heavy Tee", weight: "280 GSM" },
    "ts-organic":   { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/185/images/1086/5001G_STAPLE_ORGANIC_TEE_BLACK__71236.1751514117.386.513.jpg?c=1", name: "AS Colour 5001G", description: "Staple Organic Tee", weight: "180 GSM" },
    "ls-staple":    { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/569/images/6036/5020_STAPLE_LS_BLACK__17085.1747803774.386.513.jpg?c=1", name: "AS Colour 5020", description: "Staple L/S Tee", weight: "180 GSM" },
    "ls-ink":       { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/193/images/1208/5009_INK_LS_TEE_BLACK__76383.1741652261.386.513.jpg?c=1", name: "AS Colour 5009", description: "Ink L/S Tee", weight: "180 GSM" },
    "ls-heavy":     { styleImage: "", name: "AS Colour 5081", description: "Heavy L/S Tee", weight: "" },
    "ls-organic":   { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/813/images/11297/5020G_STAPLE_ORGANIC_LS_TEE_BLACK__30593.1724726738.386.513.jpg?c=1", name: "AS Colour 5020G", description: "Staple Organic L/S Tee", weight: "180 GSM" },
    "hd-supply":    { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/1139/images/20408/5101_SUPPLY_HOOD_BLACK__57986.1773368382.386.513.jpg?c=1", name: "AS Colour 5101", description: "Supply Hood", weight: "290 GSM" },
    "hd-stencil":   { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/222/images/1575/5102_STENCIL_HOOD_BLACK__00726.1767564698.386.513.jpg?c=1", name: "AS Colour 5102", description: "Stencil Hood", weight: "350 GSM" },
    "hd-heavy":     { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/523/images/5244/5146_HEAVY_HOOD_BLACK__73666.1759358031.386.513.jpg?c=1", name: "AS Colour 5146", description: "Heavy Hood", weight: "400 GSM" },
    "hd-relax":     { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/593/images/22024/5161_RELAX_HOOD_BLACK__85476.1747261794.386.513.jpg?c=1", name: "AS Colour 5161", description: "Relax Hood", weight: "350 GSM" },
    "cn-supply":    { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/1335/images/25073/5100_SUPPLY_CREW_BLACK__53989.1775794150.386.513.jpg?c=1", name: "AS Colour 5100S", description: "Supply Crew", weight: "290 GSM" },
    "cn-relax":     { styleImage: "", name: "AS Colour 5160", description: "Relax Crew", weight: "" },
    "cn-united":    { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/973/images/19752/5130_UNITED_CREW_BLACK__02447.1747261794.386.513.jpg?c=1", name: "AS Colour 5130S", description: "United Crew", weight: "380 GSM" },
    "cn-heavy":     { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/522/images/5221/5145_HEAVY_CREW_BLACK__25599.1761164372.386.513.jpg?c=1", name: "AS Colour 5145", description: "Heavy Crew", weight: "400 GSM" },
    "tk-barnard":   { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/199/images/1294/5025_BARNARD_TANK_BLACK__52846.1724726963.386.513.jpg?c=1", name: "AS Colour 5025", description: "Barnard Tank", weight: "150 GSM" },
    "tk-classic":   { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/562/images/5851/5073_CLASSIC_TANK_BLACK__63099.1724726963.386.513.jpg?c=1", name: "AS Colour 5073", description: "Classic Tank", weight: "220 GSM" },
    "tk-staple":    { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/835/images/11751/5090_STAPLE_TANK_BLACK__43816.1724726963.386.513.jpg?c=1", name: "AS Colour 5090", description: "Staple Tank", weight: "180 GSM" },
    "tk-stonewash": { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/209/images/1421/5039_STONE_WASH_BARNARD_TANK_BLACK_STONE__05765.1713301808.386.513.jpg?c=1", name: "AS Colour 5039", description: "Stone Wash Barnard Tank", weight: "160 GSM" },
    "ht-stock":     { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/129/images/16217/1100_STOCK_CAP_BLACK__94465.1753757510.386.513.jpg?c=1", name: "AS Colour 1100", description: "Stock Cap", weight: "" },
    "ht-trucker":   { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/1092/images/19455/1102_STOCK_FADED_TRUCKER_FADED_BLACK__42887.1738899005.386.513.jpg?c=1", name: "AS Colour 1102", description: "Stock Faded Trucker", weight: "" },
    "ht-finn":      { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/130/images/15986/1103_FINN_FIVE_PANEL_CAP_BLACK__25992.1761001973.386.513.jpg?c=1", name: "AS Colour 1103", description: "Finn Five Panel Cap", weight: "" },
    "ht-cord":      { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/897/images/15161/1110_STOCK_CONTRAST_TRUCKER_BLACK_ECRU_FRONT__42625.1757543399.386.513.jpg?c=1", name: "AS Colour 1110", description: "Stock Contrast Trucker", weight: "" },
  });
  const [colorPreview, setColorPreview] = useState(null); // { colorName, images[] }

  async function enrichStylePreviews(stylesToEnrich) {
    const toEnrich = stylesToEnrich.filter(s => s.styleNumber && !enrichedPreviews[s.id]);
    if (toEnrich.length === 0) return;
    const results = await Promise.allSettled(
      toEnrich.map(async (s) => {
        const [ssRes, acRes] = await Promise.allSettled([
          supabase.functions.invoke("ssLookupStyle", { body: { styleNumber: s.styleNumber, shopOwner } }),
          supabase.functions.invoke("acLookupStyle", { body: { styleCode: s.styleNumber, shopOwner } }),
        ]);
        const allMatches = [
          ...(ssRes.status === "fulfilled" ? ssRes.value?.data?.matches || [] : []),
          ...(acRes.status === "fulfilled" ? acRes.value?.data?.matches || [] : []),
        ];
        const match = (s.brand
          ? allMatches.find(m => m.brandName?.toLowerCase().includes(s.brand.toLowerCase()))
          : null) || allMatches[0];
        // Grab a few color swatches for preview
        const swatches = (match?.colors || [])
          .filter(c => c.imageUrl)
          .slice(0, 5)
          .map(c => ({ name: c.colorName, img: c.imageUrl }));
        // Use whatever the supplier ships as the primary styleImage —
        // AS Colour returns "Atlantic", S&S returns the first-listed
        // color, etc. Previously this preferred the Black color variant
        // which flattened the whole category grid to a wall of black
        // tees. Black is now only a last-resort fallback.
        const blackColor = match?.colors?.find(c => c.colorName?.toLowerCase() === "black");
        return {
          id: s.id,
          styleImage: match?.styleImage || match?.colors?.[0]?.imageUrl || blackColor?.imageUrl || "",
          swatches,
          name: match ? `${match.brandName} ${match.styleNumber || match.resolvedStyleNumber || ""}`.trim() : "",
          description: match?.resolvedTitle || match?.description || "",
          weight: match?.colors?.[0]?.weight || "",
        };
      })
    );
    const updates = {};
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.styleImage) {
        updates[r.value.id] = r.value;
      }
    }
    if (Object.keys(updates).length > 0) {
      setEnrichedPreviews(prev => ({ ...prev, ...updates }));
    }
  }

  // Silent live-inventory refresh. Inventory shifts hourly — we
  // deliberately DON'T persist it on saved `wizard_styles[]` (a
  // 3-week-old "200 avail" would mislead customers). Instead, when a
  // customer picks a style, we kick off a non-blocking fetch that
  // pulls fresh per-color size counts and merges them into the
  // active garment's `inventoryMap`. The size inputs then start
  // showing "X avail / out" annotations within ~1-2s.
  //
  // Failures are silent on purpose: the wizard remains fully usable
  // without inventory hints (the customer just won't see stock
  // colors). Better than a noisy error for a progressive enhancement.
  async function refreshLiveInventory(s) {
    const nameMatch = s.name?.match?.(/(\d{3,})/);
    const styleNum = s.styleNumber || (nameMatch ? nameMatch[1] : null);
    if (!styleNum) return;
    try {
      const [ssRes, acRes] = await Promise.allSettled([
        supabase.functions.invoke("ssLookupStyle", { body: { styleNumber: styleNum, shopOwner } }),
        supabase.functions.invoke("acLookupStyle", { body: { styleCode: styleNum, shopOwner } }),
      ]);
      const matches = [
        ...(ssRes.status === "fulfilled" ? ssRes.value?.data?.matches || [] : []),
        ...(acRes.status === "fulfilled" ? acRes.value?.data?.matches || [] : []),
      ];
      const match = (s.brand
        ? matches.find(m => m.brandName?.toLowerCase().includes(s.brand.toLowerCase()))
        : null) || matches[0];
      if (match?.inventoryMap && Object.keys(match.inventoryMap).length > 0) {
        setStyle(prev => ({ ...prev, inventoryMap: match.inventoryMap }));
      }
    } catch {
      // Non-fatal — sizes still render, just without "X avail" hints.
    }
  }

  // When selecting a curated style, auto-fetch from S&S to get real per-color images
  async function selectAndEnrichStyle(s) {
    setStyle(s);
    setColor("");
    // Fast path: saved style already has visuals. Render instantly,
    // then refresh live inventory in the background so size inputs
    // pick up "X avail" hints without making the customer wait.
    if (s.colorImages && Object.keys(s.colorImages).length > 0) {
      refreshLiveInventory(s);
      return;
    }
    // Try to extract a style number from the name (e.g. "Gildan 5000" → "5000")
    const nameMatch = s.name?.match?.(/(\d{3,})/);
    const styleNum = s.styleNumber || (nameMatch ? nameMatch[1] : null);
    if (!styleNum) return;
    setEnrichingStyle(true);
    try {
      const [ssRes, acRes] = await Promise.allSettled([
        supabase.functions.invoke("ssLookupStyle", { body: { styleNumber: styleNum, shopOwner } }),
        supabase.functions.invoke("acLookupStyle", { body: { styleCode: styleNum, shopOwner } }),
      ]);
      const matches = [
        ...(ssRes.status === "fulfilled" ? ssRes.value?.data?.matches || [] : []),
        ...(acRes.status === "fulfilled" ? acRes.value?.data?.matches || [] : []),
      ];
      const match = (s.brand
        ? matches.find(m => m.brandName?.toLowerCase().includes(s.brand.toLowerCase()))
        : matches.find(m => s.name?.toLowerCase().includes(m.brandName?.toLowerCase()))
      ) || (matches.length === 1 ? matches[0] : null) || matches[0];
      if (match?.colors?.length) {
        const colorImages = {};
        const enrichedColors = [];
        const priceMap = match.priceMap || {};
        for (const c of match.colors) {
          if (c.colorName && c.imageUrl) colorImages[c.colorName] = c.imageUrl;
          if (c.colorName) enrichedColors.push(c.colorName);
          if (c.colorName && c.piecePrice && !priceMap[c.colorName]) {
            priceMap[c.colorName] = { piecePrice: c.piecePrice };
          }
        }
        const minPrice = match.piecePrice || Object.values(priceMap).reduce((min, p) => Math.min(min, p.piecePrice || 999), 999);
        const enrichedName = `${match.brandName} ${match.styleNumber || match.styleName || ""}`.trim();
        setStyle(prev => ({
          ...prev,
          name: prev.name || enrichedName,
          description: prev.description || match.description || "",
          weight: prev.weight || (match.colors?.[0]?.weight) || "",
          colorImages,
          allImages: match.images || [],
          priceMap,
          inventoryMap: match.inventoryMap || {},
          // Match the category-grid behavior — supplier's primary
          // styleImage wins (varied colors), Black is only a fallback.
          styleImage: match.styleImage || colorImages["Black"] || prev.styleImage || prev.image,
          colors: enrichedColors.length > 0 ? enrichedColors : prev.colors,
          garmentCost: minPrice < 999 ? minPrice : prev.garmentCost,
          brand: prev.brand || match.brandName || "",
          styleNumber: prev.styleNumber || match.styleNumber || "",
        }));
      }
    } catch {
      // Non-fatal — colors just won't have images
    } finally {
      setEnrichingStyle(false);
    }
  }

  async function handleSSLookup(e) {
    e?.preventDefault?.();
    const styleNumber = ssLookupInput.trim().toUpperCase();
    if (!styleNumber) return;
    setSsLookupLoading(true);
    setSsLookupError("");
    setSsMatches([]);
    try {
      // Query both S&S and AS Colour in parallel
      const [ssRes, acRes] = await Promise.allSettled([
        supabase.functions.invoke("ssLookupStyle", { body: { styleNumber, shopOwner } }),
        supabase.functions.invoke("acLookupStyle", { body: { styleCode: styleNumber, shopOwner } }),
      ]);
      const grabMatches = (r) => {
        if (r.status !== "fulfilled") return [];
        const d = r.value?.data;
        if (!d || d.error) return [];
        return d.matches || [];
      };
      const allRaw = [...grabMatches(ssRes), ...grabMatches(acRes)];
      const matches = allRaw.map((m) => ({
        id: m.id || `${m.brandName}-${m.styleNumber}`,
        brandName: m.brandName,
        styleNumber: m.styleNumber || m.resolvedStyleNumber || "",
        description: m.resolvedTitle || m.description || "",
        colors: (m.colors || []).map((c) => ({ colorName: c.colorName, imageUrl: c.imageUrl, piecePrice: c.piecePrice })).filter(c => c.colorName),
        colorNames: (m.colors || []).map((c) => c.colorName).filter(Boolean),
        garmentCost: Number(m.piecePrice) || 0,
        priceMap: m.priceMap || {},
        styleImage: m.styleImage || (m.colors?.[0]?.imageUrl) || "",
        inventoryMap: m.inventoryMap || {},
        icon: "tee",
      }));
      if (matches.length === 0) {
        setSsLookupError(`No results for "${styleNumber}". Double-check the style number.`);
      } else if (matches.length === 1) {
        pickSSMatch(matches[0]);
      } else {
        setSsMatches(matches);
      }
    } catch (err) {
      setSsLookupError(err?.message || "Lookup failed — try again.");
    } finally {
      setSsLookupLoading(false);
    }
  }

  function pickSSMatch(match) {
    const priceMap = match.priceMap || {};
    const colorImages = match.colors?.reduce?.((acc, c) => {
      if (typeof c === "object" && c.colorName && c.imageUrl) acc[c.colorName] = c.imageUrl;
      return acc;
    }, {}) || {};
    // Also build priceMap from colors array if not already provided
    if (Object.keys(priceMap).length === 0 && match.colors?.length) {
      for (const c of match.colors) {
        if (typeof c === "object" && c.colorName && c.piecePrice) {
          priceMap[c.colorName] = { piecePrice: c.piecePrice };
        }
      }
    }
    const styleObj = {
      id: `ss-${match.id}`,
      name: [match.brandName, match.styleNumber].filter(Boolean).join(" "),
      description: match.description,
      garmentCost: match.garmentCost || 6.5,
      icon: match.icon || "tee",
      colors: match.colorNames || match.colors?.map?.(c => typeof c === "string" ? c : c.colorName) || [],
      colorImages,
      styleImage: match.styleImage || "",
      inventoryMap: match.inventoryMap || {},
      priceMap,
      brand: match.brandName,
      styleNumber: match.styleNumber,
    };
    setStyle(styleObj);
    setColor("");
    setSsLookupInput("");
    setSsLookupError("");
    setSsMatches([]);
  }

  // `getEffectiveCost` is imported from the shared module. Same
  // function the contract test exercises — no inlined replica drift.

  const effectiveCost = style ? getEffectiveCost(g) : 0;
  const qty = Object.values(sizes).reduce((s,v)=>s+(parseInt(v)||0),0);
  const price = style ? calcLinkedLinePrice(
    { garmentCost: effectiveCost, sizes, imprints: imprints.length ? imprints : [{colors:1}] },
    rush ? getWizardRushDisplay().rate : 0, {}, undefined, {}
  ) : null;
  const total = price ? price.lineTotal : 0;

  // Live pricing — all garments share the same run-level imprints,
  // marked linked:true so the volume-break engine combines quantities
  // across every garment and the customer hits the tier they earned.
  const allLiveItems = garments.filter(gg => gg.style).map(gg => {
    const gQty = Object.values(gg.sizes).reduce((a,v)=>a+(parseInt(v)||0),0);
    const liveImprints = (imprints.length > 0 ? imprints : [{ id: "p1", location: "Front", colors: 1, technique: getDefaultTechnique() }])
      .map(imp => ({ ...imp, linked: true }));
    return {
      id: gg.id,
      garmentCost: getEffectiveCost(gg),
      sizes: gQty > 0 ? gg.sizes : { M: 25 },
      imprints: liveImprints,
    };
  });
  const liveQuote = allLiveItems.length > 0 ? {
    line_items: allLiveItems,
    rush_rate: rush ? getWizardRushDisplay().rate : 0,
    extras: {}, discount: 0, tax_rate: 0, deposit_pct: 0,
  } : null;
  const totalAllQty = garments.reduce((s,gg) => s + Object.values(gg.sizes).reduce((a,v)=>a+(parseInt(v)||0),0), 0);
  const liveTotals = liveQuote ? calcQuoteTotalsWithLinking(liveQuote) : null;
  const liveQty = totalAllQty > 0 ? totalAllQty : 25;
  const livePpp = liveTotals ? liveTotals.total / liveQty : 0;

  // Per-garment ppp for the side panel breakdown. Uses the same
  // linkedQtyMap calcQuoteTotalsWithLinking uses, so each garment's
  // ppp reflects the combined-tier qty (linked imprints share a
  // single volume break across the whole run). Without this the
  // breakdown would show artificial per-garment tier prices that
  // disagree with the run total above them.
  const liveLinkedQtyMap = liveQuote ? buildLinkedQtyMap(liveQuote.line_items || []) : null;
  const livePerGarmentPpp = {};
  if (liveQuote && liveLinkedQtyMap) {
    for (const item of liveQuote.line_items) {
      const r = calcLinkedLinePrice(item, liveQuote.rush_rate, liveQuote.extras, undefined, liveLinkedQtyMap);
      if (r && r.qty > 0) livePerGarmentPpp[item.id] = r.lineTotal / r.qty;
    }
  }

  function addGarment() {
    const newG = blankGarment();
    setGarments(prev => [...prev, newG]);
    setActiveIdx(garments.length);
    setStep(1);
  }

  function removeGarment(idx) {
    if (garments.length <= 1) return;
    setGarments(prev => prev.filter((_, i) => i !== idx));
    setActiveIdx(0);
  }

  function updateImprint(idx, patch) {
    setImprints(prev => prev.map((im, i) => i === idx ? { ...im, ...patch } : im));
  }

  function removeImprint(idx) {
    setImprints(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleArtUpload(idx, file) {
    if (!file) return;
    setUploading(prev => ({ ...prev, [idx]: true }));

    // Color analysis — runs client-side, doesn't need the upload to succeed
    try {
      const cResult = await analyzeColors(file);
      if (cResult) setColorResults(prev => ({ ...prev, [idx]: cResult }));
    } catch (err) {
      console.warn("[colorAnalyzer] failed:", err);
    }

    // File upload — store the URL. Also keep a LOCAL blob url for the in-wizard
    // preview (eyedropper): the wizard is anonymous and pre-quote, so it can't
    // build a proxy link, and once the artwork bucket is private (M-1) the
    // stored public url won't render. The blob is of the file the customer just
    // picked — no storage round-trip needed.
    try {
      const previewUrl = URL.createObjectURL(file);
      const { file_url } = await uploadFile(file);
      setArtFiles(prev => ({ ...prev, [idx]: { name: file.name, url: file_url, previewUrl } }));
    } catch (err) {
      // Notify so the customer knows the artwork didn't attach — otherwise
      // they see the filename + color analysis and assume the upload worked.
      notify.error("Artwork upload failed", err);
      setArtFiles(prev => ({ ...prev, [idx]: { name: file.name, url: "" } }));
    }

    setUploading(prev => ({ ...prev, [idx]: false }));
  }

  const [submittedGarments, setSubmittedGarments] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  // Surfaced to the user when submit fails. Was previously swallowed
  // by a console.error only — the customer had no idea the form didn't go.
  const [submitError, setSubmitError] = useState("");

  async function handleSubmit() {
    if (submitting) return;
    setSubmitError("");

    // Customer-email format check — the wizard is anonymous and the only
    // way the shop reaches the customer. A typo like "joe@biota" used to
    // submit cleanly and the shop would have no way to follow up.
    const emailTrim = (contact.email || "").trim();
    const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim);
    if (!emailLooksValid) {
      setSubmitError("Please enter a valid email address so we can send your quote.");
      return;
    }

    setSubmitting(true);
    // Payload build extracted verbatim to steps/wizardQuote.js (pure + tested);
    // garmentCost still flows straight from getEffectiveCost(g) as before.
    const { quote: q, validGarments: validG } = buildWizardQuote({
      garments, imprints, artFiles, contact, rush, shopOwner,
      botHoneypot: _botHoneypot, wizardOpenedAt: wizardOpenedAtRef.current,
    });
    setSubmittedGarments(validG);

    // Client-side hint — bots that bypass JS still get caught by the
    // RPC, but rejecting locally avoids an unnecessary round trip.
    if (_botHoneypot) {
      // Honeypot was filled — almost certainly a bot. Silently succeed
      // (don't tell the bot why we rejected) so it doesn't iterate
      // around the gate. Set submitted=true so the UI behaves as if
      // sent, but skip the actual network call.
      setSubmitted(true);
      setSubmitting(false);
      return;
    }
    if ((Date.now() - wizardOpenedAtRef.current) < 3000) {
      // Less than 3 seconds between page-open and submit. Real user
      // can't realistically configure a garment + contact info in
      // under 3 seconds. Same silent-success pattern.
      setSubmitted(true);
      setSubmitting(false);
      return;
    }
    try {
      await onSubmit(q);
      setSubmitted(true);
    } catch (err) {
      console.error("[Wizard] submit failed:", err);
      setSubmitError(err?.message || "Couldn't submit your request. Please try again or contact the shop directly.");
    } finally {
      setSubmitting(false);
    }
  }

  function resetWizard() {
    setSubmitted(false); setStep(1); setRush(false);
    setGarments([blankGarment()]); setActiveIdx(0);
    setImprints([{ id: uid(), location: "Front", colors: 1, pantones: "", technique: getDefaultTechnique(), details: "" }]);
    setArtFiles({}); setColorResults({});
    setContact({name:"",email:"",phone:"",company:"",notes:"",dueDate:"",taxExempt:false,taxId:""});
    setSsLookupInput(""); setSsLookupError(""); setSsMatches([]);
    setSelectedGarment(""); setPreviewStyle(null);
  }

  const validGarments = garments.filter(gg => gg.style && gg.color);
  const totalQtyAll = garments.reduce((s, gg) => s + Object.values(gg.sizes).reduce((a,v) => a + (parseInt(v) || 0), 0), 0);


  // Validation helper — returns list of issues preventing Continue.
  // Logic lives in steps/wizardQuote.js (pure + tested); thin closure here
  // so call sites stay `getValidationIssues()`.
  const getValidationIssues = () => getWizardValidationIssues(garments);

  // Surface a hard "unpriceable" signal to the live-price summary so the
  // side panel + bottom bar suppress the partial (print-only) total
  // instead of flashing a misleading number while validation blocks the
  // button.
  const hasUnpriceableGarment = garments.some(
    (gg) => gg.style && gg.color && getEffectiveCost(gg) === 0
  );

  if (submitted) {
    return (
      <WizardSuccessScreen
        submittedGarments={submittedGarments}
        validGarments={validGarments}
        imprints={imprints}
        rush={rush}
        liveTotals={liveTotals}
        total={total}
        bc={bc}
        onReset={resetWizard}
      />
    );
  }

  // Render-time helper for the live pricing summary. The same data set
  // feeds both the desktop side panel and the mobile bottom bar so the
  // numbers can't drift between the two surfaces.
  //
  // While `enrichingStyle` is true the active garment is still resolving
  // its supplier data (colors, color images, garmentCost, priceMap).
  // Showing Per piece / Run Total during that window would either flash
  // $0 (no priceMap loaded yet) or flash an incomplete subtotal that
  // only includes imprint costs — both confuse customers. Treat
  // enriching as "not ready to price yet" and fall back to the empty
  // state ("Add quantities to see pricing") until enrichment finishes.
  const showPriceSummary = liveTotals && garments.some(gg => gg.style) && !enrichingStyle && !hasUnpriceableGarment;

  return (
    <div style={brandStyle} className="max-w-6xl mx-auto md:grid md:grid-cols-[minmax(0,1fr)_300px] md:gap-6">
      {/* Honeypot — invisible to real users (off-screen + aria-hidden +
          tabIndex -1 so keyboard navigation skips it). Naïve bots that
          auto-fill every input on the page will tick this box; server
          rejects the submission. Hidden via CSS, not display:none, so
          the input is still in the DOM and scrapers find it. The field
          name "company_website" is deliberately plausible — bots use
          field names as fill hints. */}
      <label
        aria-hidden="true"
        tabIndex={-1}
        style={{ position: "absolute", left: "-9999px", top: "auto", width: "1px", height: "1px", overflow: "hidden" }}
      >
        Company website (leave blank)
        <input
          type="text"
          name="company_website"
          autoComplete="off"
          tabIndex={-1}
          value={_botHoneypot}
          onChange={(e) => setBotHoneypot(e.target.value)}
        />
      </label>

      {/* LEFT COLUMN — the entire scrollable wizard. Bottom padding on
          mobile so the fixed pricing bar at the viewport bottom doesn't
          cover the last input. */}
      <div className="space-y-6 min-w-0 pb-24 md:pb-0">
      {/* Intro — show before any garment is configured */}
      {step === 1 && !garments.some(gg => gg.style) && (
        <div className="space-y-5">
          <div className="text-center space-y-1">
            <h2 className="text-2xl font-bold text-slate-900">Request a Quote</h2>
            <p className="text-sm text-slate-500">No commitment required</p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { num: "1", title: "Build your order", sub: "Select garments, styles & quantities" },
              { num: "2", title: "Get a quote", sub: "We'll send a detailed quote by email" },
              { num: "3", title: "Approve & we print", sub: "Approve when you're ready" },
            ].map(s => (
              <div key={s.num} className="bg-white rounded-xl border border-slate-100 p-4">
                <div style={{ backgroundColor: bc }} className="w-7 h-7 rounded-full text-white text-xs font-bold flex items-center justify-center mx-auto mb-2">{s.num}</div>
                <div className="text-xs font-bold text-slate-800">{s.title}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{s.sub}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step progress */}
      <div className="flex items-center gap-0">
        {STEPS.map((s,i)=>{
          const num = i+1;
          const done = step > num;
          const active = step === num;
          return (
            <div key={s} className="flex items-center flex-1 last:flex-none">
              <button onClick={()=>{ if(done) setStep(num); }}
                className={`flex items-center gap-2 text-xs font-semibold transition ${done?"cursor-pointer":""}`}>
                <div
                  style={active ? { backgroundColor: bc } : undefined}
                  className={`w-3 h-3 rounded-full flex-shrink-0 transition ${active?"":done?"bg-emerald-500":"bg-slate-200"}`} />
                <span className={`hidden sm:block ${active?"text-[var(--brand)] font-bold":done?"text-emerald-600":"text-slate-500"}`}>{s}</span>
              </button>
              {i < STEPS.length-1 && <div className={`flex-1 h-0.5 mx-2 ${done?"bg-emerald-300":"bg-slate-100"}`} />}
            </div>
          );
        })}
      </div>

      {/* (Live pricing bar moved out of flow — see the desktop side
          panel + mobile bottom bar below. Single source of truth so
          the numbers stay in lockstep across surfaces.) */}

      {/* STEP 1: Configure — style + color + sizes + prints all on one page */}
      {step === 1 && (
        <ConfigureStep
          POPULAR_STYLES={POPULAR_STYLES}
          bc={bc} bcDark={bcDark} bcDarker={bcDarker}
          garments={garments} activeIdx={activeIdx} setActiveIdx={setActiveIdx}
          style={style} color={color} sizes={sizes}
          setG={setG} setStyle={setStyle} setColor={setColor} setSizes={setSizes}
          selectedGarment={selectedGarment} setSelectedGarment={setSelectedGarment}
          setPreviewStyle={setPreviewStyle}
          enrichedPreviews={enrichedPreviews} enrichStylePreviews={enrichStylePreviews} selectAndEnrichStyle={selectAndEnrichStyle}
          enrichingStyle={enrichingStyle}
          ssLookupInput={ssLookupInput} setSsLookupInput={setSsLookupInput} ssLookupLoading={ssLookupLoading} ssLookupError={ssLookupError} handleSSLookup={handleSSLookup}
          ssMatches={ssMatches} setSsMatches={setSsMatches} pickSSMatch={pickSSMatch}
          uid={uid}
          setColorPreview={setColorPreview}
          imprints={imprints} updateImprint={updateImprint} removeImprint={removeImprint} setImprints={setImprints}
          artFiles={artFiles} setArtFiles={setArtFiles} colorResults={colorResults} setColorResults={setColorResults}
          uploading={uploading} handleArtUpload={handleArtUpload}
          rush={rush} setRush={setRush}
          sizesRef={sizesRef}
          qty={qty}
          addGarment={addGarment} removeGarment={removeGarment}
          getValidationIssues={getValidationIssues}
          setStep={setStep}
        />
      )}

      {/* STEP 2: Contact Details */}
      {step === 2 && (
        <DetailsStep bc={bc} contact={contact} setContact={setContact} setStep={setStep} />
      )}

      {/* STEP 3: Review & Submit */}
      {step === 3 && (
        <ReviewStep
          bc={bc} bcDark={bcDark}
          validGarments={validGarments}
          imprints={imprints}
          artFiles={artFiles}
          rush={rush}
          contact={contact}
          liveTotals={liveTotals}
          total={total}
          totalQtyAll={totalQtyAll}
          livePpp={livePpp}
          livePerGarmentPpp={livePerGarmentPpp}
          submitError={submitError}
          submitting={submitting}
          handleSubmit={handleSubmit}
          setStep={setStep}
        />
      )}
      </div>

      <PriceSidebar
        bcDark={bcDark} bcDarker={bcDarker}
        showPriceSummary={showPriceSummary}
        garments={garments}
        imprints={imprints}
        totalAllQty={totalAllQty}
        liveTotals={liveTotals}
        livePerGarmentPpp={livePerGarmentPpp}
        livePpp={livePpp}
        rush={rush}
        enrichingStyle={enrichingStyle}
      />

      {/* Color photo preview modal */}
      <ColorPreviewModal colorPreview={colorPreview} setColorPreview={setColorPreview} bc={bc} />

    </div>
  );
}