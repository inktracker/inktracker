import { useState, useEffect } from "react";

// Shared presentational helpers + constants for the public OrderWizard,
// extracted verbatim from OrderWizard.jsx as part of a pure structural
// decomposition (zero behavior change). Nothing here touches pricing /
// cost math — these are display-only helpers and static option lists.

export const LOCATIONS = ["Front","Back","Left Chest","Right Chest","Left Sleeve","Right Sleeve","Pocket","Hood"];
export const COLOR_COUNTS = [1,2,3,4,5,6,7,8];

// Short helper descriptions for the category-picker grid. Used to give
// each card a one-liner so the customer can pick the right family
// without scanning a flat list of garment-type strings. Keys match
// CATEGORIES in WizardConfigEditor; anything not in the map gets no
// subtitle (still renders, just bare label).
export const CATEGORY_BLURBS = {
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
export function StepBadge({ n, title, subtitle }) {
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
export function summarizeImprint(imp) {
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
export function summarizeImprints(imprints) {
  if (!Array.isArray(imprints)) return "";
  return imprints
    .map(summarizeImprint)
    .filter(Boolean)
    .join(", ");
}

export const COLOR_HEX_MAP = {
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

export function colorNameToHex(name) {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  if (COLOR_HEX_MAP[lower]) return COLOR_HEX_MAP[lower];
  for (const [key, hex] of Object.entries(COLOR_HEX_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return hex;
  }
  return null;
}

const tintCache = {};
export function TintedImage({ baseImg, colorName, className }) {
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
