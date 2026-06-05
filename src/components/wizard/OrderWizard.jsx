import { useState, useEffect, useRef } from "react";
import { calcLinkedLinePrice, calcQuoteTotalsWithLinking, buildLinkedQtyMap, BIG_SIZES, SIZES, fmtMoney, fmtDate, uid, getEnabledTechniques, getMinOrderQty } from "../shared/pricing";
import Icon from "../shared/Icon";
import { supabase } from "@/api/supabaseClient";
import { uploadFile } from "@/lib/uploadFile";
import { getEffectiveCost } from "@/lib/wizard/getEffectiveCost";
import { analyzeColors } from "@/lib/colorAnalyzer";
import ColorAnalysisResult from "../shared/ColorAnalysisResult";
import { notify } from "@/lib/notify";
import { todayInShopTz } from "@/lib/shopTimezone";
import { brand, darken, tint } from "@/lib/branding";

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
  { id:"ls-base", garment:"Long Sleeve", styleNumber:"5029", brand:"AS Colour", tag:"Base",
    hoverDescription:"Mid weight, versatile long sleeve" },
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
  { id:"cn-supply", garment:"Crewnecks", styleNumber:"5100S", brand:"AS Colour", tag:"Supply",
    hoverDescription:"Mid weight, cotton-rich crew" },
  { id:"cn-stencil", garment:"Crewnecks", styleNumber:"5103", brand:"AS Colour", tag:"Stencil",
    hoverDescription:"Mid-heavy weight, premium crew" },
  { id:"cn-united", garment:"Crewnecks", styleNumber:"5130S", brand:"AS Colour", tag:"United",
    hoverDescription:"Heavy weight, premium crew" },
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
  { id:"ht-finn", garment:"Hats", styleNumber:"1103", brand:"AS Colour", tag:"Finn",
    hoverDescription:"5-panel cap" },
  { id:"ht-cord", garment:"Hats", styleNumber:"1110", brand:"AS Colour", tag:"Cord",
    hoverDescription:"Corduroy cap" },
];

const STEPS = ["Configure","Details","Review"];
const LOCATIONS = ["Front","Back","Left Chest","Right Chest","Left Sleeve","Right Sleeve","Pocket","Hood"];
const COLOR_COUNTS = [1,2,3,4,5,6,7,8];

// Short helper descriptions for the category-picker grid. Used to give
// each card a one-liner so the customer can pick the right family
// without scanning a flat list of garment-type strings. Keys match
// CATEGORIES in WizardConfigEditor; anything not in the map gets no
// subtitle (still renders, just bare label).
const CATEGORY_BLURBS = {
  "T-Shirts":    "Classic short-sleeve tees & basics.",
  "Long Sleeve": "Long-sleeve tees & layering.",
  "Hoodies":     "Pullover & zip hoodies.",
  "Crewnecks":   "Crewneck sweatshirts.",
  "Tank Tops":   "Tanks & sleeveless.",
  "Polos":       "Polos & button-down sport shirts.",
  "Hats":        "Hats, caps, beanies — print, embroidery, or patches.",
  "Other":       "Bags, totes & accessories.",
};

// Small reusable section-header badge — numbered circle + uppercase
// title + optional one-line subtitle. Used on every micro-step inside
// the active garment card so each block reads as "1. CATEGORY → 2.
// STYLE → 3. COLOR → 4. SIZES → 5. PRINT" the way the reference does.
function StepBadge({ n, title, subtitle }) {
  return (
    <div className="flex items-start gap-3 mb-3">
      <span
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
        style={{ background: "var(--brand-dark)" }}
      >
        {n}
      </span>
      <div>
        <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wide leading-tight">{title}</h4>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5 leading-snug">{subtitle}</p>}
      </div>
    </div>
  );
}

// Compact, human-readable summary of an imprint for the side panel
// preview. Examples:
//   { location: "Front", colors: 2, technique: "Screen Print" } → "2-color front"
//   { location: "Back",  colors: 1, technique: "Screen Print" } → "1-color back"
//   { location: "Left Chest", technique: "Embroidery" }         → "embroidered left chest"
//   { location: "Front", technique: "DTG" }                     → "DTG front"
function summarizeImprint(imp) {
  if (!imp) return "";
  const location = (imp.location || "").trim().toLowerCase();
  if (!location) return "";
  const tech = (imp.technique || "Screen Print").trim();
  const colors = parseInt(imp.colors, 10) || 1;
  if (tech === "Embroidery") return `embroidered ${location}`;
  if (tech === "Screen Print" || tech === "DTF" || tech === "Heat Transfer") {
    return `${colors}-color ${location}`;
  }
  // DTG, Sublimation, etc — full-color, no count.
  return `${tech.toLowerCase()} ${location}`;
}

// Join an array of imprints into a single comma-separated phrase suitable
// for the side panel preview. Filters out blanks so a garment with only
// one configured imprint reads cleanly.
function summarizeImprints(imprints) {
  if (!Array.isArray(imprints)) return "";
  return imprints
    .map(summarizeImprint)
    .filter(Boolean)
    .join(", ");
}

const COLOR_HEX_MAP = {
  // Neutrals
  white:"#ffffff",black:"#222222",charcoal:"#3d3d3d","dark charcoal":"#2d2d2d",
  grey:"#9ca3af",gray:"#9ca3af","dark grey":"#4b5563","dark gray":"#4b5563",
  "light grey":"#d1d5db","light gray":"#d1d5db","sport grey":"#b0b3b8",
  heather:"#b0b3b8","heather grey":"#b0b3b8","heather gray":"#b0b3b8",
  "dark heather":"#5a5a5a","athletic heather":"#b8b8b8",ash:"#c8c8c8",
  natural:"#f5f0e1",ivory:"#f5f0e1",cream:"#f5ecd7",bone:"#e8dcc8",
  sand:"#d4c5a9",khaki:"#bfb68a",tan:"#c8b88a",stone:"#bab7a4",
  pepper:"#5a5a5a","vintage black":"#2d2d2d","smoke":"#6e6e6e",
  // Blues
  navy:"#1b2a4a","true navy":"#1a2744","dark navy":"#141f33",royal:"#2d5da1",
  blue:"#3b6eba","light blue":"#a8d5e2","carolina blue":"#7bafd4",
  "ice blue":"#c5dde8","powder blue":"#b8d4e3",sky:"#7ec8e3",
  "heather navy":"#3b4f6e","blue jean":"#7e9ab8",chambray:"#8fa7c4",
  indigo:"#3f3c8a","steel blue":"#4682b4",denim:"#5b7eaa",
  "classic navy":"#1e3050","faded blue":"#8faabe",cobalt:"#2e4e8e",
  "blue spruce":"#3a6b6e","slate blue":"#5a7a9a",
  // Reds & Pinks
  red:"#cc2936",maroon:"#6b1c23",burgundy:"#6b1c32",wine:"#6b2037",
  cardinal:"#9b1b30",berry:"#8b2252",crimson:"#a82035",brick:"#8b3a3a",
  pink:"#e8a0b4","hot pink":"#e84393","light pink":"#f5c6d0",
  coral:"#e8735a",salmon:"#e8886a","heather red":"#c06070",
  "dusty rose":"#c4878e",rose:"#cc7a8a",blush:"#e8b0b0",magenta:"#b82060",
  "red pepper":"#c83a2a","brick red":"#a03020",
  // Oranges & Yellows
  orange:"#e8651a","burnt orange":"#c45a20",rust:"#b04a2a",
  gold:"#d4a017",yellow:"#f0c040",banana:"#f0d878",
  yam:"#c96e3a",amber:"#d49520",mustard:"#c8a030",sunset:"#e87a3a",
  peach:"#f0b890","bright orange":"#f06820",citrus:"#e8a020",
  // Greens
  green:"#3a6b35","forest green":"#2d5a27",forest:"#2d5a27",
  olive:"#6b7328",army:"#5a5e3a",moss:"#6b7d46",sage:"#9caf88",
  mint:"#98d4bb",seafoam:"#8ec9b1",teal:"#2a8a7a",
  lime:"#7cb518","kelly green":"#2d8a4e","hunter green":"#2a5a2a",
  "alpine green":"#3a6b4a",jade:"#4a9a6a",
  emerald:"#3a8a5a",pine:"#2a5a3a","military green":"#5a6a3a",
  camo:"#5a5e3a","army camo":"#5a5e3a","tree camo":"#5a6a3a",
  "darkwood tree camo":"#3a4a2a",fern:"#5a8a4a",clover:"#3a7a3a",
  // Purples
  purple:"#5b2c83",violet:"#7b50a0",lavender:"#b395c3",plum:"#5e3a6e",
  "heather purple":"#7a5a8a",lilac:"#c0a0d0",grape:"#5a2a6a",
  eggplant:"#4a2050","royal purple":"#4a2a7a",orchid:"#9a5aaa",
  // Browns
  brown:"#6b4226","dark brown":"#4a2a1a","light brown":"#9a7a5a",
  chocolate:"#4a2a1a",espresso:"#3a2010",mocha:"#6a4a3a",
  "coyote brown":"#8a6a4a",copper:"#b06a3a",camel:"#c0a070",
  // Specialty
  aqua:"#5bc0be",cyan:"#3ab0b0",turquoise:"#3aa0a0",
  "neon green":"#5ae030","neon orange":"#f06020","neon pink":"#f03080","neon yellow":"#e8e020",
  "safety green":"#6ae030","safety orange":"#f06020",
  // Comfort Colors specific
  "flo blue":"#5aa0d0","lagoon blue":"#3a8aaa",
  "island reef":"#5abab0","chalky mint":"#a0d0c0",
  "blossom":"#e8b0c0","watermelon":"#e85a6a","neon blue":"#4090e0",
  "bay":"#9aaa90","granite":"#8a8a8a","grey comfort":"#9a9a9a",
  "graphite":"#4a4a4a","true red":"#cc2020","bright salmon":"#f08070",
  "island green":"#4aaa7a","hemp":"#b0a080",
  "terra cotta":"#c07050","washed denim":"#7a9ab0","vineyard":"#5a3050",
};

function colorNameToHex(name) {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  if (COLOR_HEX_MAP[lower]) return COLOR_HEX_MAP[lower];
  for (const [key, hex] of Object.entries(COLOR_HEX_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return hex;
  }
  return null;
}

const tintCache = {};
function TintedImage({ baseImg, colorName, className }) {
  const hex = colorNameToHex(colorName);
  const cacheKey = `${baseImg}|${hex}`;
  const [dataUrl, setDataUrl] = useState(tintCache[cacheKey] || null);

  useEffect(() => {
    if (!hex || !baseImg || tintCache[cacheKey]) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const size = 400;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");

      // Draw garment on white background at high res
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
      const scale = Math.min(size / img.width, size / img.height) * 0.9;
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);

      // Build mask: flood-fill white background from edges
      const imageData = ctx.getImageData(0, 0, size, size);
      const d = imageData.data;
      const visited = new Uint8Array(size * size);
      const queue = [];
      const threshold = 12;

      // Seed from all edge pixels
      for (let x = 0; x < size; x++) { queue.push(x); queue.push(x + (size - 1) * size); }
      for (let y = 1; y < size - 1; y++) { queue.push(y * size); queue.push(y * size + size - 1); }

      while (queue.length > 0) {
        const idx = queue.pop();
        if (idx < 0 || idx >= size * size || visited[idx]) continue;
        const pi = idx * 4;
        if (d[pi] < 255 - threshold || d[pi+1] < 255 - threshold || d[pi+2] < 255 - threshold) continue;
        visited[idx] = 1;
        const x = idx % size, y = (idx - x) / size;
        if (x > 0) queue.push(idx - 1);
        if (x < size - 1) queue.push(idx + 1);
        if (y > 0) queue.push(idx - size);
        if (y < size - 1) queue.push(idx + size);
      }

      // Tint garment pixels — use inverted luminosity (dark base = full color, highlights = lighter)
      const tr = parseInt(hex.slice(1, 3), 16);
      const tg = parseInt(hex.slice(3, 5), 16);
      const tb = parseInt(hex.slice(5, 7), 16);

      for (let i = 0; i < size * size; i++) {
        if (visited[i]) continue; // background — leave white
        const pi = i * 4;
        const lum = (d[pi] * 0.299 + d[pi+1] * 0.587 + d[pi+2] * 0.114) / 255;
        // Dark pixel on black garment → full target color; lighter areas → brighter tint
        const shade = 0.65 + lum * 0.35;
        d[pi]   = Math.min(255, Math.round(tr * shade));
        d[pi+1] = Math.min(255, Math.round(tg * shade));
        d[pi+2] = Math.min(255, Math.round(tb * shade));
      }

      ctx.putImageData(imageData, 0, 0);
      const url = canvas.toDataURL();
      tintCache[cacheKey] = url;
      setDataUrl(url);
    };
    img.src = baseImg;
  }, [baseImg, hex, cacheKey]);

  if (!hex) return null;
  if (!dataUrl) return <div className={`${className} rounded-lg bg-slate-100 animate-pulse`} />;
  return <img src={dataUrl} alt={colorName} className={`${className} rounded-lg object-contain bg-white`} />;
}

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
    { id: uid(), location: "Front", colors: 1, pantones: "", technique: "Screen Print", details: "" },
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
    "ls-base":      { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/204/images/2112/5029_BASE_LS_TEE_BLACK__65265.1775794150.386.513.jpg?c=1", name: "AS Colour 5029", description: "Base L/S Tee", weight: "200 GSM" },
    "ls-organic":   { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/813/images/11297/5020G_STAPLE_ORGANIC_LS_TEE_BLACK__30593.1724726738.386.513.jpg?c=1", name: "AS Colour 5020G", description: "Staple Organic L/S Tee", weight: "180 GSM" },
    "hd-supply":    { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/1139/images/20408/5101_SUPPLY_HOOD_BLACK__57986.1773368382.386.513.jpg?c=1", name: "AS Colour 5101", description: "Supply Hood", weight: "290 GSM" },
    "hd-stencil":   { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/222/images/1575/5102_STENCIL_HOOD_BLACK__00726.1767564698.386.513.jpg?c=1", name: "AS Colour 5102", description: "Stencil Hood", weight: "350 GSM" },
    "hd-heavy":     { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/523/images/5244/5146_HEAVY_HOOD_BLACK__73666.1759358031.386.513.jpg?c=1", name: "AS Colour 5146", description: "Heavy Hood", weight: "400 GSM" },
    "hd-relax":     { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/593/images/22024/5161_RELAX_HOOD_BLACK__85476.1747261794.386.513.jpg?c=1", name: "AS Colour 5161", description: "Relax Hood", weight: "350 GSM" },
    "cn-supply":    { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/1335/images/25073/5100_SUPPLY_CREW_BLACK__53989.1775794150.386.513.jpg?c=1", name: "AS Colour 5100S", description: "Supply Crew", weight: "290 GSM" },
    "cn-stencil":   { styleImage: "https://cdn11.bigcommerce.com/s-hsi95a83fz/products/1098/images/18712/5103_STENCIL_CREW_BLACK__72031.1736128748.386.513.jpg?c=1", name: "AS Colour 5103", description: "Stencil Crew", weight: "350 GSM" },
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
    rush ? 0.20 : 0, {}, undefined, {}
  ) : null;
  const total = price ? price.lineTotal : 0;

  // Live pricing — all garments share the same run-level imprints,
  // marked linked:true so the volume-break engine combines quantities
  // across every garment and the customer hits the tier they earned.
  const allLiveItems = garments.filter(gg => gg.style).map(gg => {
    const gQty = Object.values(gg.sizes).reduce((a,v)=>a+(parseInt(v)||0),0);
    const liveImprints = (imprints.length > 0 ? imprints : [{ id: "p1", location: "Front", colors: 1, technique: "Screen Print" }])
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
    rush_rate: rush ? 0.20 : 0,
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

    // File upload — store the URL
    try {
      const { file_url } = await uploadFile(file);
      setArtFiles(prev => ({ ...prev, [idx]: { name: file.name, url: file_url } }));
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
    const validG = garments.filter(g => g.style && g.color);
    setSubmittedGarments(validG);

    const allArtwork = [];
    // Run-level imprints + artwork apply to every garment in the run.
    // linked:true tells calcLinkedLinePrice to combine quantities across
    // all garments when picking the volume break.
    const sharedImprints = imprints.map((imp, idx) => {
      const art = artFiles?.[idx];
      if (art?.url) {
        allArtwork.push({ id: art.url, name: art.name, url: art.url });
      }
      return {
        ...imp,
        linked: true,
        artwork_url: art?.url || "",
        artwork_name: art?.name || "",
        artwork_id: art?.url || "",
        mockup_url: "",
      };
    });
    const line_items = validG.map(g => ({
      id: uid(),
      style: g.style.name || `${g.style.brand || ""} ${g.style.styleNumber || ""}`.trim(),
      garmentCost: getEffectiveCost(g),
      garmentColor: g.color,
      sizes: g.sizes,
      imprints: sharedImprints.map(imp => ({ ...imp })),
      category: g.style.garment || "",
    }));
    const q = {
      shop_owner: shopOwner || "",
      customer_name: contact.name,
      customer_email: contact.email,
      phone: contact.phone,
      company: contact.company,
      // Shop-tz, not UTC. Falls through to the customer's browser tz
      // when no shop tz is loaded (the anonymous wizard path), which
      // is the right behavior for a customer submitting from their
      // own location.
      date: todayInShopTz(),
      due_date: contact.dueDate || null,
      status: "Pending",
      notes: contact.notes,
      rush_rate: rush ? 0.20 : 0,
      extras: { colorMatch:false, difficultPrint:false, waterbased:false, tags:false },
      line_items,
      selected_artwork: allArtwork,
      tax_exempt: contact.taxExempt,
      tax_id: contact.taxId,
      discount: 0, tax_rate: 0, deposit_pct: 0, deposit_paid: false,
      // 5 chars of base36 from a millisecond timestamp ≈ 60M combinations
      // per year, matching the rest of the codebase's quote_id generators.
      // The previous random-3-digit-number scheme had only 900 combinations
      // per year — collisions guaranteed at any volume.
      quote_id: `Q-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-5)}`,
      // Anti-bot signals — server enforces. Underscored to mark them
      // as private/internal metadata, not user-set quote fields.
      _bot_honeypot: _botHoneypot,
      _bot_dwell_ms: Date.now() - (wizardOpenedAtRef.current || Date.now()),
    };
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
    setImprints([{ id: uid(), location: "Front", colors: 1, pantones: "", technique: "Screen Print", details: "" }]);
    setArtFiles({}); setColorResults({});
    setContact({name:"",email:"",phone:"",company:"",notes:"",dueDate:"",taxExempt:false,taxId:""});
    setSsLookupInput(""); setSsLookupError(""); setSsMatches([]);
    setSelectedGarment(""); setPreviewStyle(null);
  }

  const validGarments = garments.filter(gg => gg.style && gg.color);
  const totalQtyAll = garments.reduce((s, gg) => s + Object.values(gg.sizes).reduce((a,v) => a + (parseInt(v) || 0), 0), 0);


  // Validation helper — returns list of issues preventing Continue
  function getValidationIssues() {
    const issues = [];
    if (!garments.some(gg => gg.style)) issues.push("Select a garment style");
    else if (!garments.some(gg => gg.style && gg.color)) issues.push("Choose a garment color");
    else {
      const minQty = getMinOrderQty();
      const hasEnoughQty = garments.some(gg => {
        const gQ = Object.values(gg.sizes).reduce((a,v) => a + (parseInt(v) || 0), 0);
        return gg.style && gg.color && gQ >= minQty;
      });
      if (!hasEnoughQty) issues.push(`Minimum ${minQty} pieces required per garment`);
    }
    return issues;
  }

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16 space-y-6">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
          <Icon name="check" className="w-8 h-8 text-emerald-600" />
        </div>
        <h2 className="text-3xl font-bold text-slate-900">Order Request Submitted</h2>
        <p className="text-slate-500 text-lg">We've received your request and will be in touch within 1 business day with a final quote and next steps.</p>
        <div className="bg-slate-50 rounded-2xl border border-slate-200 p-6 text-left space-y-3 text-sm">
          {(submittedGarments.length > 0 ? submittedGarments : validGarments).map((gg, idx) => {
            const gQty = Object.values(gg.sizes).reduce((a,v) => a + (parseInt(v) || 0), 0);
            const showGarments = submittedGarments.length > 0 ? submittedGarments : validGarments;
            return (
              <div key={gg.id} className={idx > 0 ? "border-t border-slate-200 pt-3" : ""}>
                <div className="flex justify-between"><span className="text-slate-400">Garment{showGarments.length > 1 ? ` ${idx+1}` : ""}</span><span className="font-semibold">{gg.style.name || `${gg.style.brand || ""} ${gg.style.styleNumber || ""}`.trim() || "Item"} · {gg.color}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Quantity</span><span className="font-semibold">{gQty} pcs</span></div>
              </div>
            );
          })}
          <div className="flex justify-between"><span className="text-slate-400">Print</span><span className="font-semibold">{imprints.map(i => `${i.location} (${i.colors}c)`).join(", ")}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Turnaround</span><span className="font-semibold">{rush ? "Rush — 7 days" : "Standard — 14 days"}</span></div>
          <div className="border-t border-slate-200 pt-2 flex justify-between font-bold text-base"><span>Estimated Total</span><span className="text-[var(--brand)]">{fmtMoney(liveTotals?.total || total)}</span></div>
        </div>
        <button onClick={resetWizard} style={{ backgroundColor: bc }} className="hover:opacity-90 text-white font-semibold px-6 py-3 rounded-xl transition">
          Start Another Order
        </button>
      </div>
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
  const showPriceSummary = liveTotals && garments.some(gg => gg.style) && !enrichingStyle;

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
            <p className="text-sm text-slate-400">No commitment required</p>
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
                <div className="text-[10px] text-slate-400 mt-0.5">{s.sub}</div>
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
                <span className={`hidden sm:block ${active?"text-[var(--brand)] font-bold":done?"text-emerald-600":"text-slate-400"}`}>{s}</span>
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
      {step === 1 && (() => {
        const garmentTypes = [...new Set(POPULAR_STYLES.map(s => s.garment))];
        const styleOptions = selectedGarment
          ? POPULAR_STYLES.filter(s => s.garment === selectedGarment)
          : [];

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
                      return <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0"><Icon name="tee" className="w-5 h-5 text-slate-400" /></div>;
                    })()}
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {hasStyle ? `${gg.style.name}${gg.color ? ` · ${gg.color}` : ""}` : "New garment"}
                      </div>
                      <div className="text-xs text-slate-400">
                        {gQty > 0 ? `${gQty} pcs` : "no sizes"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-[var(--brand)] font-semibold">Edit</span>
                    {garments.length > 1 && (
                      <span onClick={(e) => { e.stopPropagation(); removeGarment(idx); }}
                        className="text-xs text-red-400 hover:text-red-600">Remove</span>
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
                      {!hasStyle && garments.length <= 1 && <span className="text-slate-400 dark:text-slate-500">Select a style below</span>}
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
              {/* Category picker — 3-column card grid at lg+ (was 2). Now that
                  QuoteRequest.jsx wraps the wizard in max-w-6xl, the left
                  column has room for a 3-up layout, which kills the
                  negative space the 2-up grid left empty on the right. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {garmentTypes.map(gt => {
                  const active = selectedGarment === gt;
                  return (
                    <button
                      key={gt}
                      type="button"
                      onClick={() => {
                        setSelectedGarment(gt);
                        setPreviewStyle(null);
                        enrichStylePreviews(POPULAR_STYLES.filter(s => s.garment === gt));
                      }}
                      className={`text-left px-4 py-3 border-2 rounded-xl transition ${
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
                  );
                })}
              </div>

              {/* Style # search — moved below the category grid so it
                  reads as a secondary path ("can't find it? search by
                  style number"). Same width as the grid. */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Or search by style #</label>
                <form onSubmit={handleSSLookup} className="flex gap-1.5">
                  <input value={ssLookupInput} onChange={(e) => setSsLookupInput(e.target.value)} placeholder="e.g. 5001"
                    className="flex-1 text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]" disabled={ssLookupLoading} />
                    <button type="submit" disabled={ssLookupLoading||!ssLookupInput.trim()}
                      className="text-sm font-semibold text-[var(--brand)] border border-[var(--brand-tint)] px-3 py-2 rounded-xl hover:bg-[var(--brand-tint)] disabled:opacity-50">
                      {ssLookupLoading ? "…" : "Go"}</button>
                  </form>
                {ssLookupError && <div className="text-xs text-red-500 mt-1">{ssLookupError}</div>}
              </div>
              {styleOptions.length > 0 && (
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 mb-1">
                  These are just our top picks. For more options, browse{' '}
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
              )}
              {styleOptions.length > 0 && <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                      <div className="text-xs text-slate-400">{displayWeight}{s.tag ? (displayWeight ? " · " : "") + s.tag : ""}</div></div>
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
                      <div className="text-xs text-slate-400 truncate">{m.description}</div></div>
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
              {enrichingStyle && <div className="text-center text-sm text-slate-400 py-4">Loading colors…</div>}
              {!enrichingStyle && style.colors?.length > 0 ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                  {(() => {
                    const baseImg = style.colorImages?.["Black"] || style.styleImage || Object.values(style.colorImages || {})[0] || "";
                    return style.colors.filter(c => style.colorImages?.[c] || colorNameToHex(c)).map(c => {
                      const colorImg = style.colorImages?.[c];
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
                          {colorImg ? <img src={colorImg} alt={c} className="w-full aspect-square rounded-lg object-contain bg-white mb-2" />
                            : <TintedImage baseImg={baseImg} colorName={c} className="w-full aspect-square mb-2" />}
                          <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">{c}</div>
                          {isSelected && <div className="text-[10px] text-[var(--brand)] mt-0.5">Tap to preview</div>}
                        </button>);
                    });
                  })()}
                </div>
              ) : !enrichingStyle ? (
                <input value={color} onChange={e=>setColor(e.target.value)} placeholder="e.g. Black, Navy, Heather Grey"
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
                        <input type="number" min="0" value={sizes[sz]||""} onChange={e=>setSizes(prev=>({...prev,[sz]:parseInt(e.target.value)||0}))}
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
                    <div><label className="block text-[11px] text-slate-400 mb-1">Placement</label>
                      <select value={imp.location} onChange={e=>updateImprint(idx,{location:e.target.value})}
                        className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]">
                        {LOCATIONS.map(l=><option key={l} value={l}>{l}</option>)}</select></div>
                    <div><label className="block text-[11px] text-slate-400 mb-1">Technique</label>
                      <select value={imp.technique} onChange={e=>updateImprint(idx,{technique:e.target.value})}
                        className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]">
                        {getEnabledTechniques().map(t=><option key={t}>{t}</option>)}</select></div>
                  </div>
                  <div><label className="block text-[11px] text-slate-400 mb-1.5">Colors</label>
                    <div className="flex gap-1.5">{COLOR_COUNTS.map(n=>(
                      <button key={n} onClick={()=>updateImprint(idx,{colors:n})}
                        style={imp.colors===n ? { backgroundColor: bc } : undefined}
                        className={`w-9 h-9 rounded-lg text-sm font-bold transition ${imp.colors===n?"text-white":"bg-white border border-slate-200 text-slate-600 hover:border-[var(--brand)]"}`}>{n}</button>
                    ))}</div></div>
                  <div><label className="block text-[11px] text-slate-400 mb-1">Artwork <span className="text-slate-300">(optional)</span></label>
                    {artFiles[idx] ? (
                      <div>
                        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs">
                          <span className="text-emerald-600 font-semibold truncate flex-1">✓ {artFiles[idx].name}</span>
                          <button onClick={()=>{setArtFiles(prev=>{const n={...prev};delete n[idx];return n;}); setColorResults(prev=>{const n={...prev};delete n[idx];return n;});}} className="text-slate-400 hover:text-red-500 text-xs">Remove</button>
                        </div>
                        <ColorAnalysisResult result={colorResults[idx]} imageUrl={artFiles[idx]?.url}
                          onApplyCount={(count, pantones) => updateImprint(idx, { colors: Math.min(8, Math.max(1, count)), ...(pantones ? { pantones } : {}) })} />
                      </div>
                    ) : (
                      <label className={`flex items-center gap-2 border-2 border-dashed rounded-lg px-3 py-2.5 cursor-pointer transition text-xs ${uploading[idx]?"border-[var(--brand)] bg-[var(--brand-tint)]":"border-slate-200 hover:border-[var(--brand)] hover:bg-slate-50"}`}>
                        <input type="file" accept=".ai,.eps,.pdf,.png,.jpg,.jpeg,.svg,.psd" className="hidden"
                          onChange={e=>e.target.files[0]&&handleArtUpload(idx,e.target.files[0])} />
                        {uploading[idx] ? <span className="text-[var(--brand)]">Uploading…</span> : <span className="text-slate-400">Upload artwork</span>}
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
                subtitle="Standard ships in ~14 business days. Rush ships in ~7 business days for a 20% surcharge."
              />
              <div className="flex gap-3">
                {[{val:false,label:"Standard",sub:"14 business days"},{val:true,label:"Rush",sub:"7 business days",badge:"+20%"}].map(opt=>(
                  <button key={String(opt.val)} onClick={()=>setRush(opt.val)}
                    className={`flex-1 rounded-xl border-2 px-4 py-3 text-left transition ${rush===opt.val?"border-[var(--brand)] bg-[var(--brand-tint)]":"border-slate-200 hover:border-slate-300"}`}>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-bold ${rush===opt.val?"text-[var(--brand-dark)]":"text-slate-700"}`}>{opt.label}</span>
                      {opt.badge && <span className="text-xs font-bold text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">{opt.badge}</span>}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">{opt.sub}</div>
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
                className={`font-semibold px-6 py-2.5 rounded-xl transition ${getValidationIssues().length === 0 ? "hover:opacity-90 text-white" : "bg-slate-100 text-slate-400 cursor-not-allowed"}`}>
                Continue →
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* STEP 2: Contact Details */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button onClick={()=>setStep(1)} className="text-slate-400 hover:text-slate-700 text-sm">← Back</button>
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">Your details</h3>
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                {key:"name",label:"Full Name *",placeholder:"Jane Smith",type:"text"},
                {key:"company",label:"Company / Organization",placeholder:"School or business name",type:"text"},
                {key:"email",label:"Email *",placeholder:"jane@example.com",type:"email"},
                {key:"phone",label:"Phone",placeholder:"(775) 555-0000",type:"tel"},
              ].map(f=>(
                <div key={f.key}>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{f.label}</label>
                  <input type={f.type} value={contact[f.key]} onChange={e=>setContact(c=>({...c,[f.key]:e.target.value}))}
                    placeholder={f.placeholder}
                    className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">In-Hands Date</label>
                <input type="date" value={contact.dueDate} onChange={e=>setContact(c=>({...c,dueDate:e.target.value}))}
                  className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Art / Special Notes</label>
                <textarea rows={3} value={contact.notes} onChange={e=>setContact(c=>({...c,notes:e.target.value}))}
                  placeholder="File format, special instructions, Pantone refs…"
                  className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[var(--brand)] resize-none" />
              </div>
            </div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={contact.taxExempt} onChange={e => setContact(c => ({ ...c, taxExempt: e.target.checked, taxId: e.target.checked ? c.taxId : "" }))}
                className="w-4 h-4 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]" />
              <span className="text-sm font-semibold text-slate-600">Tax Exempt</span>
            </label>
            {contact.taxExempt && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Resale / Tax Exempt Certificate #</label>
                <input type="text" value={contact.taxId} onChange={e => setContact(c => ({ ...c, taxId: e.target.value }))}
                  placeholder="e.g. NV-12345678"
                  className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]" />
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <button
              onClick={()=>contact.name.trim()&&contact.email.trim()&&setStep(3)}
              disabled={!contact.name.trim() || !contact.email.trim()}
              style={contact.name.trim() && contact.email.trim() ? { backgroundColor: bc } : undefined}
              className={`font-semibold px-6 py-2.5 rounded-xl transition ${contact.name.trim() && contact.email.trim() ? "hover:opacity-90 text-white" : "bg-slate-100 text-slate-400 cursor-not-allowed"}`}
            >
              Review Order →
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Review & Submit */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button onClick={()=>setStep(2)} className="text-slate-400 hover:text-slate-700 text-sm">← Back</button>
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
                    <div className="flex justify-between text-sm"><span className="text-slate-400">Style</span><span className="font-semibold">{gg.style.name}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-slate-400">Color</span><span className="font-semibold">{gg.color}</span></div>
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
                  <span className="text-slate-400">Locations</span>
                  <span className="font-semibold text-right">{imprints.map(i => `${i.location} (${i.colors}c ${i.technique})`).join(", ")}</span>
                </div>
                {Object.keys(artFiles || {}).length > 0 && (
                  <div className="border-t border-slate-100 pt-2">
                    <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">Artwork</div>
                    {Object.entries(artFiles).map(([idx, f]) => (
                      <div key={idx} className="flex items-center gap-1.5 text-xs text-slate-600">
                        <span className="text-emerald-500">✓</span>
                        <span className="text-slate-400">{imprints[idx]?.location}:</span>
                        <span className="font-medium truncate">{f.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-between text-sm bg-white rounded-2xl border border-slate-100 p-5">
                <span className="text-slate-400">Turnaround</span>
                <span className={`font-semibold ${rush ? "text-orange-600" : ""}`}>{rush ? "Rush — 7 days" : "Standard — 14 days"}</span>
              </div>

              {/* Contact */}
              <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-1.5 text-sm">
                <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Contact</div>
                <div className="flex justify-between"><span className="text-slate-400">Name</span><span className="font-semibold">{contact.name}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Email</span><span className="font-semibold">{contact.email}</span></div>
                {contact.phone && <div className="flex justify-between"><span className="text-slate-400">Phone</span><span className="font-semibold">{contact.phone}</span></div>}
                {contact.company && <div className="flex justify-between"><span className="text-slate-400">Company</span><span className="font-semibold">{contact.company}</span></div>}
                {contact.dueDate && <div className="flex justify-between"><span className="text-slate-400">In-Hands</span><span className="font-semibold">{fmtDate(contact.dueDate)}</span></div>}
              </div>
            </div>

            {/* Pricing total */}
            <div className="bg-slate-900 rounded-2xl overflow-hidden">
              <div className="bg-slate-800 px-5 py-3 border-b border-slate-700">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Pricing Summary</div>
              </div>
              <div className="p-5 space-y-0">
                {validGarments.map((gg) => {
                  const gQty = Object.values(gg.sizes).reduce((a,v) => a + (parseInt(v) || 0), 0);
                  return (
                    <div key={gg.id} className="flex justify-between py-2 border-b border-slate-800 text-xs">
                      <span className="text-slate-400">{gg.style.name} · {gg.color} ({gQty} pcs)</span>
                      <span className="text-white font-semibold">
                        {(() => {
                          const gPrice = calcLinkedLinePrice(
                            { garmentCost: gg.style.garmentCost, sizes: gg.sizes, imprints: imprints.length ? imprints : [{colors:1}] },
                            rush ? 0.20 : 0, {}, undefined, {}
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
                  <div className="mb-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
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
      )}
      </div>

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

      {/* Color photo preview modal */}
      {colorPreview && (() => {
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
              <button onClick={() => setColorPreview(null)} className="text-slate-400 hover:text-slate-600 text-lg font-bold px-2">✕</button>
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
                <div className="text-center text-slate-400 py-8 text-sm">No photos available</div>
              )}
            </div>
          </div>
        </div>
        );
      })()}

    </div>
  );
}