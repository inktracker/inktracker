import { useState } from "react";
import { calcGroupPrice, calcQuoteTotals, getAdminMarkup, BIG_SIZES, SIZES, getTier, fmtMoney, fmtDate, uid, ADDL_PRINT } from "../shared/pricing";
import Icon from "../shared/Icon";
import { supabase } from "@/api/supabaseClient";
import { uploadFile } from "@/lib/uploadFile";
import { analyzeColors } from "@/lib/colorAnalyzer";
import ColorAnalysisResult from "../shared/ColorAnalysisResult";

export const DEFAULT_WIZARD_STYLES = [
  { id:"g5000", category:"Shirts", garment:"T-Shirts", name:"Gildan 5000", tag:"Best Value",
    description:"Unisex Heavy Cotton T-Shirt", weight:"5.3 oz", garmentCost:2.82,
    image:"https://www.ssactivewear.com/Images/Color/33476_f_fm.jpg",
    colors:["Black","White","Navy","Sport Grey","Red","Royal","Forest Green","Maroon"] },
  { id:"cc1717", category:"Shirts", garment:"T-Shirts", name:"Comfort Colors 1717", tag:"Shop Pick",
    description:"Premium vintage-style heavyweight tee", weight:"6.1 oz", garmentCost:5.22,
    image:"https://www.ssactivewear.com/Images/Color/47183_f_fm.jpg",
    colors:["Black","White","Blue Jean","Ivory","Moss","Pepper","Seafoam","Chambray"] },
  { id:"bc3001", category:"Shirts", garment:"T-Shirts", name:"Bella+Canvas 3001", tag:"Retail Fit",
    description:"Unisex Jersey Short Sleeve Tee", weight:"4.2 oz", garmentCost:3.68,
    image:"https://www.ssactivewear.com/Images/Color/27498_f_fm.jpg",
    colors:["Black","White","Athletic Heather","Heather Navy","Navy","Red","True Royal"] },
  { id:"g5400", category:"Shirts", garment:"Long Sleeve", name:"Gildan 5400", tag:"Best Value",
    description:"Unisex Heavy Cotton Long Sleeve T-Shirt", weight:"5.3 oz", garmentCost:4.48,
    image:"https://www.ssactivewear.com/Images/Color/17502_f_fm.jpg",
    colors:["Black","White","Navy","Sport Grey","Red"] },
  { id:"g18500", category:"Fleece", garment:"Hoodies", name:"Gildan 18500", tag:"Best Value",
    description:"Unisex Heavy Blend Hooded Sweatshirt", weight:"8.0 oz", garmentCost:13.14,
    image:"https://www.ssactivewear.com/Images/Color/33306_f_fm.jpg",
    colors:["Black","White","Navy","Sport Grey","Maroon","Forest Green","Red"] },
  { id:"ind4000", category:"Fleece", garment:"Hoodies", name:"Independent IND4000", tag:"Shop Pick",
    description:"Heavyweight Hooded Sweatshirt", weight:"10.0 oz", garmentCost:18.50,
    image:"https://www.ssactivewear.com/Images/Color/26296_f_fm.jpg",
    colors:["Black","Alpine Green","Army","Bone","Burgundy","Classic Navy","Slate Blue"] },
  { id:"g18000", category:"Fleece", garment:"Crewnecks", name:"Gildan 18000", tag:"Best Value",
    description:"Unisex Heavy Blend Crewneck Sweatshirt", weight:"8.0 oz", garmentCost:7.30,
    image:"https://www.ssactivewear.com/Images/Color/33297_f_fm.jpg",
    colors:["Black","White","Navy","Sport Grey","Maroon"] },
];

export const DEFAULT_WIZARD_SETUPS = [
  { id:"setup1", name:"Front Only",
    imprints:[{location:"Front",colors:1,pantones:"",technique:"Screen Print",details:""}],
    icon:"front" },
  { id:"setup2", name:"Front + Back",
    imprints:[
      {location:"Front",colors:1,pantones:"",technique:"Screen Print",details:""},
      {location:"Back",colors:1,pantones:"",technique:"Screen Print",details:""},
    ],
    icon:"frontback" },
  { id:"setup3", name:"Left Chest + Back",
    imprints:[
      {location:"Left Chest",colors:1,pantones:"",technique:"Screen Print",details:""},
      {location:"Back",colors:1,pantones:"",technique:"Screen Print",details:""},
    ],
    icon:"chestback" },
];

const STEPS = ["Configure","Details","Review"];
const LOCATIONS = ["Front","Back","Left Chest","Right Chest","Left Sleeve","Right Sleeve","Pocket","Hood"];
const COLOR_COUNTS = [1,2,3,4,5,6,7,8];

const SWATCHES = {
  "White":"bg-white border-2 border-slate-300","Black":"bg-slate-900","Navy":"bg-blue-900",
  "Ash":"bg-slate-200","Red":"bg-red-600","Royal":"bg-blue-600","Dark Heather":"bg-slate-500",
  "Forest Green":"bg-green-800","Maroon":"bg-red-900","Purple":"bg-purple-700",
  "Heather":"bg-slate-300","Vintage Black":"bg-slate-800","Natural":"bg-amber-50 border-2 border-amber-200",
  "Sport Grey":"bg-slate-300","Carolina Blue":"bg-sky-400","Grey":"bg-slate-400",
  "Heather Grey":"bg-slate-300","Heather Navy":"bg-blue-800","Heather Red":"bg-red-400",
  "Desert Camo":"bg-amber-700","Dark Grey":"bg-slate-600","Forest":"bg-green-700",
};

export default function OrderWizard({ onSubmit, styles: stylesProp, setups: setupsProp, shopOwner }) {
  const POPULAR_STYLES = Array.isArray(stylesProp) && stylesProp.length > 0 ? stylesProp : DEFAULT_WIZARD_STYLES;
  const POPULAR_SETUPS = Array.isArray(setupsProp) && setupsProp.length > 0 ? setupsProp : DEFAULT_WIZARD_SETUPS;
  const [step, setStep] = useState(1);
  const blankGarment = () => ({
    id: uid(), style: null, color: "", sizes: {},
    imprints: [{id:uid(),location:"Front",colors:1,pantones:"",technique:"Screen Print",details:""}],
    artFiles: {}, colorResults: {},
  });
  const [garments, setGarments] = useState([blankGarment()]);
  const [activeIdx, setActiveIdx] = useState(0);
  // Convenience aliases for the active garment
  const g = garments[activeIdx] || blankGarment();
  const style = g.style;
  const color = g.color;
  const sizes = g.sizes;
  const imprints = g.imprints;
  const artFiles = g.artFiles;
  const colorResults = g.colorResults;
  // Setters that update the active garment in the array
  function setG(patch) {
    setGarments(prev => prev.map((gg, i) => i === activeIdx ? { ...gg, ...patch } : gg));
  }
  function setStyle(v) { setG({ style: v }); }
  function setColor(v) { setG({ color: v }); }
  function setSizes(fn) { setGarments(prev => prev.map((gg, i) => i === activeIdx ? { ...gg, sizes: typeof fn === "function" ? fn(gg.sizes) : fn } : gg)); }
  function setImprints(fn) { setGarments(prev => prev.map((gg, i) => i === activeIdx ? { ...gg, imprints: typeof fn === "function" ? fn(gg.imprints) : fn } : gg)); }
  function setArtFiles(fn) { setGarments(prev => prev.map((gg, i) => i === activeIdx ? { ...gg, artFiles: typeof fn === "function" ? fn(gg.artFiles) : fn } : gg)); }
  function setColorResults(fn) { setGarments(prev => prev.map((gg, i) => i === activeIdx ? { ...gg, colorResults: typeof fn === "function" ? fn(gg.colorResults) : fn } : gg)); }

  const [setup, setSetup] = useState(null);
  const [rush, setRush] = useState(false);
  const [contact, setContact] = useState({ name:"", email:"", phone:"", company:"", notes:"", dueDate:"" });
  const [submitted, setSubmitted] = useState(false);
  const [uploading, setUploading] = useState({});
  const [openSection, setOpenSection] = useState("style"); // style | color | sizes | print | turnaround
  const [ssLookupInput, setSsLookupInput] = useState("");
  const [ssLookupLoading, setSsLookupLoading] = useState(false);
  const [ssLookupError, setSsLookupError] = useState("");
  const [ssMatches, setSsMatches] = useState([]);
  const [selectedGarment, setSelectedGarment] = useState("");
  const [previewStyle, setPreviewStyle] = useState(null);
  const [enrichingStyle, setEnrichingStyle] = useState(false);

  // When selecting a curated style, auto-fetch from S&S to get real per-color images
  async function selectAndEnrichStyle(s) {
    setStyle(s);
    setColor("");
    // If already has colorImages (from S&S search), skip
    if (s.colorImages && Object.keys(s.colorImages).length > 0) return;
    // Try to extract a style number from the name (e.g. "Gildan 5000" → "5000")
    const nameMatch = s.name?.match?.(/(\d{3,})/);
    const styleNum = s.styleNumber || (nameMatch ? nameMatch[1] : null);
    if (!styleNum) return;
    setEnrichingStyle(true);
    try {
      const { data } = await supabase.functions.invoke("ssLookupStyle", {
        body: { styleNumber: styleNum },
      });
      const match = (data?.matches || []).find(m =>
        s.name?.toLowerCase().includes(m.brandName?.toLowerCase()) || (data.matches.length === 1)
      ) || data?.matches?.[0];
      if (match?.colors?.length) {
        const colorImages = {};
        const enrichedColors = [];
        for (const c of match.colors) {
          if (c.colorName && c.imageUrl) colorImages[c.colorName] = c.imageUrl;
          if (c.colorName) enrichedColors.push(c.colorName);
        }
        setStyle(prev => ({
          ...prev,
          colorImages,
          inventoryMap: match.inventoryMap || {},
          styleImage: match.styleImage || prev.styleImage || prev.image,
          colors: enrichedColors.length > 0 ? enrichedColors : prev.colors,
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
      const { data, error } = await supabase.functions.invoke("ssLookupStyle", {
        body: { styleNumber },
      });
      if (error) throw error;
      const matches = (data?.matches || []).map((m) => ({
        id: m.id || `${m.brandName}-${m.styleNumber}`,
        brandName: m.brandName,
        styleNumber: m.styleNumber,
        description: m.description || m.resolvedTitle || "",
        colors: (m.colors || []).map((c) => ({ colorName: c.colorName, imageUrl: c.imageUrl })).filter(c => c.colorName),
        colorNames: (m.colors || []).map((c) => c.colorName).filter(Boolean),
        garmentCost: Number(m.piecePrice) || 0,
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
    const styleObj = {
      id: `ss-${match.id}`,
      name: [match.brandName, match.styleNumber].filter(Boolean).join(" "),
      description: match.description,
      garmentCost: match.garmentCost || 6.5,
      icon: match.icon || "tee",
      colors: match.colorNames || match.colors?.map?.(c => typeof c === "string" ? c : c.colorName) || [],
      colorImages: match.colors?.reduce?.((acc, c) => {
        if (typeof c === "object" && c.colorName && c.imageUrl) acc[c.colorName] = c.imageUrl;
        return acc;
      }, {}) || {},
      styleImage: match.styleImage || "",
      inventoryMap: match.inventoryMap || {},
      brand: match.brandName,
      styleNumber: match.styleNumber,
    };
    setStyle(styleObj);
    setColor("");
    setSsLookupInput("");
    setSsLookupError("");
    setSsMatches([]);
  }

  const qty = Object.values(sizes).reduce((s,v)=>s+(parseInt(v)||0),0);
  const twoXL = BIG_SIZES.reduce((s,sz)=>s+(parseInt(sizes[sz])||0),0);
  const price = style ? calcGroupPrice(style.garmentCost, qty, imprints.length ? imprints : [{colors:1}], rush?0.20:0, {}) : null;
  const total = price ? price.sub + twoXL*2 : 0;
  const ppp = qty > 0 ? total / qty : 0;

  // Live pricing — all garments
  const allLiveItems = garments.filter(gg => gg.style).map(gg => {
    const gQty = Object.values(gg.sizes).reduce((a,v)=>a+(parseInt(v)||0),0);
    return {
      id: gg.id,
      garmentCost: gg.style.garmentCost,
      sizes: gQty > 0 ? gg.sizes : { M: 50 },
      imprints: gg.imprints.length > 0 ? gg.imprints : [{ id: "p1", location: "Front", colors: 1, technique: "Screen Print" }],
    };
  });
  const liveQuote = allLiveItems.length > 0 ? {
    line_items: allLiveItems,
    rush_rate: rush ? 0.20 : 0,
    extras: {}, discount: 0, tax_rate: 0, deposit_pct: 0,
  } : null;
  const totalAllQty = garments.reduce((s,gg) => s + Object.values(gg.sizes).reduce((a,v)=>a+(parseInt(v)||0),0), 0);
  const liveTotals = liveQuote ? calcQuoteTotals(liveQuote) : null;
  const liveQty = totalAllQty > 0 ? totalAllQty : 50;
  const livePpp = liveTotals ? liveTotals.total / liveQty : 0;
  const liveIsEstimate = totalAllQty === 0;

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

  function applySetup(s) {
    setSetup(s);
    setImprints(s.imprints.map(i=>({...i, id:uid()})));
  }

  function updateImprint(idx, patch) {
    setImprints(prev => prev.map((im,i)=>i===idx?{...im,...patch}:im));
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
      console.error("[artUpload] upload failed:", err);
      // Still show the file name even if upload fails so user sees the color analysis
      setArtFiles(prev => ({ ...prev, [idx]: { name: file.name, url: "" } }));
    }

    setUploading(prev => ({ ...prev, [idx]: false }));
  }

  function handleSubmit() {
    const line_items = garments.filter(g => g.style && g.color).map(g => ({
      id: uid(),
      style: g.style.name,
      garmentCost: g.style.garmentCost,
      garmentColor: g.color,
      sizes: g.sizes,
      imprints: g.imprints,
      category: g.style.garment || "",
    }));
    const q = {
      shop_owner: shopOwner || "",
      customer_name: contact.name,
      customer_email: contact.email,
      date: new Date().toISOString().split("T")[0],
      due_date: contact.dueDate || null,
      status: "Pending",
      notes: contact.notes,
      rush_rate: rush ? 0.20 : 0,
      extras: { colorMatch:false, difficultPrint:false, waterbased:false, tags:false },
      line_items,
      discount: 0, tax_rate: 0, deposit_pct: 0, deposit_paid: false,
      quote_id: `Q-${new Date().getFullYear()}-${String(Math.floor(Math.random()*900)+100)}`,
    };
    onSubmit(q);
    setSubmitted(true);
  }

  function resetWizard() {
    setSubmitted(false); setStep(1); setSetup(null); setRush(false);
    setGarments([blankGarment()]); setActiveIdx(0);
    setContact({name:"",email:"",phone:"",company:"",notes:"",dueDate:""});
    setArtFiles({}); setUploading({}); setColorResults({});
    setSsLookupInput(""); setSsLookupError(""); setSsMatches([]);
    setSelectedGarment(""); setPreviewStyle(null);
  }

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16 space-y-6">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
          <Icon name="check" className="w-8 h-8 text-emerald-600" />
        </div>
        <h2 className="text-3xl font-bold text-slate-900">Order Request Submitted</h2>
        <p className="text-slate-500 text-lg">We've received your request and will be in touch within 1 business day with a final quote and next steps.</p>
        <div className="bg-slate-50 rounded-2xl border border-slate-200 p-6 text-left space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-400">Garment</span><span className="font-semibold">{style?.name} · {color}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Quantity</span><span className="font-semibold">{qty} pcs</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Print Setup</span><span className="font-semibold">{setup?.name}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Turnaround</span><span className="font-semibold">{rush?"Rush — 7 days":"Standard — 14 days"}</span></div>
          <div className="border-t border-slate-200 pt-2 flex justify-between font-bold text-base"><span>Estimated Total</span><span className="text-indigo-600">{fmtMoney(liveTotals?.total || total)}</span></div>
        </div>
        <button onClick={resetWizard} className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-xl transition">
          Start Another Order
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
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
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition ${active?"bg-indigo-600 text-white":done?"bg-emerald-500 text-white":"bg-slate-100 text-slate-400"}`}>
                  {done ? "✓" : num}
                </div>
                <span className={`hidden sm:block ${active?"text-indigo-600 font-bold":done?"text-emerald-600":"text-slate-400"}`}>{s}</span>
              </button>
              {i < STEPS.length-1 && <div className={`flex-1 h-0.5 mx-2 ${done?"bg-emerald-300":"bg-slate-100"}`} />}
            </div>
          );
        })}
      </div>

      {/* Live pricing bar — visible whenever any garment has a style */}
      {liveTotals && garments.some(gg => gg.style) && (
        <div className="bg-slate-900 rounded-2xl px-6 py-4 flex items-center justify-between sticky top-2 z-10 shadow-lg">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div>
              <span className="text-slate-500 text-[10px] uppercase tracking-wide block">Items</span>
              <span className="text-white font-semibold text-xs">
                {garments.filter(gg=>gg.style).map(gg => gg.style.name + (gg.color ? ` · ${gg.color}` : "")).join(" + ") || "—"}
              </span>
            </div>
            <div>
              <span className="text-slate-500 text-[10px] uppercase tracking-wide block">Total Qty</span>
              <span className="text-white font-semibold text-xs">
                {totalAllQty > 0 ? `${totalAllQty} pcs` : "50 pcs (est.)"}
              </span>
            </div>
            <div>
              <span className="text-slate-500 text-[10px] uppercase tracking-wide block">Avg Per Piece</span>
              <span className="text-white font-semibold text-xs">{fmtMoney(livePpp)}</span>
            </div>
            {rush && (
              <div>
                <span className="text-slate-500 text-[10px] uppercase tracking-wide block">Rush</span>
                <span className="text-orange-400 font-semibold text-xs">+20%</span>
              </div>
            )}
          </div>
          <div className="text-right flex-shrink-0 ml-4">
            <div className="text-[10px] text-slate-500 uppercase tracking-wide">
              {liveIsEstimate ? "Est. Total (50 pcs)" : "Total"}
            </div>
            <div className="text-2xl font-bold text-white">{fmtMoney(liveTotals.total)}</div>
          </div>
        </div>
      )}

      {/* STEP 1: Configure — style + color + sizes + prints all on one page */}
      {step === 1 && (() => {
        const garmentTypes = [...new Set(POPULAR_STYLES.map(s => s.garment))];
        const styleOptions = selectedGarment
          ? POPULAR_STYLES.filter(s => s.garment === selectedGarment)
          : [];

        return (
        <div className="space-y-5">
          <h3 className="text-lg font-bold text-slate-800">Configure Your Order</h3>

          {/* All garments as collapsible cards */}
          {garments.map((gg, idx) => {
            const isActive = idx === activeIdx;
            const gQty = Object.values(gg.sizes).reduce((s,v)=>s+(parseInt(v)||0),0);
            const hasStyle = !!gg.style;

            // Collapsed chip
            if (!isActive) {
              return (
                <button key={gg.id} onClick={() => setActiveIdx(idx)}
                  className="w-full flex items-center justify-between bg-white rounded-2xl px-5 py-4 border-2 border-slate-200 hover:border-indigo-300 transition text-left">
                  <div className="flex items-center gap-3 min-w-0">
                    {hasStyle && (gg.style.colorImages?.[gg.color] || gg.style.image || gg.style.styleImage) ? (
                      <img src={gg.style.colorImages?.[gg.color] || gg.style.image || gg.style.styleImage} alt="" className="w-10 h-10 rounded-lg object-contain bg-slate-50" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                        <Icon name="tee" className="w-5 h-5 text-slate-400" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate">
                        {hasStyle ? `${gg.style.name}${gg.color ? ` · ${gg.color}` : ""}` : "New garment"}
                      </div>
                      <div className="text-xs text-slate-400">
                        {gQty > 0 ? `${gQty} pcs` : "no sizes"} · {gg.imprints.map(i=>`${i.location} (${i.colors}c)`).join(", ")}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-indigo-600 font-semibold">Edit</span>
                    {garments.length > 1 && (
                      <span onClick={(e) => { e.stopPropagation(); removeGarment(idx); }}
                        className="text-xs text-red-400 hover:text-red-600">Remove</span>
                    )}
                  </div>
                </button>
              );
            }

            // Expanded card — all sections inside one block
            return (
              <div key={gg.id} className="bg-white rounded-2xl border-2 border-indigo-300 shadow-sm overflow-hidden">
                {/* Card header */}
                <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 flex items-center justify-between">
                  <div className="text-sm font-bold text-slate-800">
                    {garments.length > 1 ? `Garment ${idx + 1}` : "Your Garment"}
                    {hasStyle && <span className="font-normal text-slate-500 ml-2">— {gg.style.name}{gg.color ? ` · ${gg.color}` : ""}</span>}
                  </div>
                  {garments.length > 1 && (
                    <button onClick={() => removeGarment(idx)} className="text-xs text-red-400 hover:text-red-600">Remove</button>
                  )}
                </div>

                <div className="p-5 space-y-5">

          {/* ── Style ── */}
          <div className="space-y-3">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Style</div>
            {!style ? (<>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Garment type</label>
                  <select value={selectedGarment} onChange={(e) => { setSelectedGarment(e.target.value); setPreviewStyle(null); }}
                    className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300">
                    <option value="">Select…</option>
                    {garmentTypes.map(gt => <option key={gt} value={gt}>{gt}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Or search by style #</label>
                  <form onSubmit={handleSSLookup} className="flex gap-1.5">
                    <input value={ssLookupInput} onChange={(e) => setSsLookupInput(e.target.value)} placeholder="e.g. IND4000"
                      className="flex-1 text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" disabled={ssLookupLoading} />
                    <button type="submit" disabled={ssLookupLoading||!ssLookupInput.trim()}
                      className="text-sm font-semibold text-indigo-600 border border-indigo-200 px-3 py-2 rounded-xl hover:bg-indigo-50 disabled:opacity-50">
                      {ssLookupLoading ? "…" : "Go"}</button>
                  </form>
                  {ssLookupError && <div className="text-xs text-red-500 mt-1">{ssLookupError}</div>}
                </div>
              </div>
              {styleOptions.length > 0 && <div className="grid grid-cols-2 gap-2">
                {styleOptions.map(s => (
                  <button key={s.id} onClick={() => selectAndEnrichStyle(s)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 transition text-left">
                    {s.image ? <img src={s.image} alt="" className="w-10 h-10 rounded-lg object-contain bg-slate-50" /> :
                      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center"><Icon name={s.icon||"tee"} className="w-5 h-5 text-slate-400" /></div>}
                    <div className="min-w-0"><div className="text-sm font-semibold text-slate-800 truncate">{s.name}</div>
                      <div className="text-xs text-slate-400">{s.weight}{s.tag ? ` · ${s.tag}` : ""}</div></div>
                  </button>))}
              </div>}
              {ssMatches.length > 0 && <div className="grid grid-cols-2 gap-2">
                {ssMatches.map(m => (
                  <button key={m.id} onClick={() => pickSSMatch(m)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 transition text-left">
                    {m.styleImage && <img src={m.styleImage} alt="" className="w-10 h-10 rounded-lg object-contain bg-white" />}
                    <div className="min-w-0"><div className="text-sm font-semibold text-slate-900 truncate">{m.brandName} {m.styleNumber}</div>
                      <div className="text-xs text-slate-400 truncate">{m.description}</div></div>
                  </button>))}
              </div>}
            </>) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {(style.image || style.styleImage) && <img src={style.image || style.styleImage} alt="" className="w-12 h-12 rounded-lg object-contain bg-slate-50" />}
                  <div><div className="font-semibold text-slate-900">{style.name}</div>
                    {style.description && <div className="text-xs text-slate-500">{style.description}</div>}</div>
                </div>
                <button onClick={()=>{ setStyle(null); setColor(""); setSelectedGarment(""); setPreviewStyle(null); setSsMatches([]); setSsLookupInput(""); }}
                  className="text-xs text-indigo-600 font-semibold hover:text-indigo-700">Change</button>
              </div>
            )}
          </div>

          {/* ── Color ── */}
          {style && (
            <div className="border-t border-slate-100 pt-5">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Color {color && <span className="normal-case font-normal text-slate-400">· {color}</span>}</div>
              {enrichingStyle && <div className="text-center text-sm text-slate-400 py-4">Loading colors…</div>}
              {!enrichingStyle && style.colors?.length > 0 ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                  {style.colors.map(c => {
                    const colorImg = style.colorImages?.[c];
                    return (
                      <button key={c} onClick={()=>setColor(c)}
                        className={`rounded-xl border-2 p-2 text-center transition hover:shadow-md ${color===c?"border-indigo-500 bg-indigo-50":"border-slate-200 hover:border-indigo-300"}`}>
                        {colorImg ? <img src={colorImg} alt={c} className="w-full aspect-square rounded-lg object-contain bg-white mb-2" />
                          : <div className={`w-full aspect-square rounded-lg mb-2 ${SWATCHES[c]||"bg-slate-200"}`} />}
                        <div className="text-xs font-semibold text-slate-700 truncate">{c}</div>
                      </button>);
                  })}
                </div>
              ) : !enrichingStyle ? (
                <input value={color} onChange={e=>setColor(e.target.value)} placeholder="e.g. Black, Navy, Heather Grey"
                  className="w-full text-sm border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              ) : null}
            </div>
          )}

          {/* ── Sizes ── */}
          {style && (
            <div className="border-t border-slate-100 pt-5">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Sizes</div>
              {(() => {
                const inv = color ? (style.inventoryMap?.[color] || {}) : {};
                const hasInv = Object.keys(inv).length > 0;
                return (<>
                  <div className="grid grid-cols-8 gap-3 mb-3">
                    {SIZES.map(sz => {
                      const stock = inv[sz] ?? inv[sz.replace("XL","X")] ?? null;
                      return (<div key={sz} className="text-center">
                        <div className={`text-xs font-bold mb-1 ${BIG_SIZES.includes(sz)?"text-amber-600":"text-slate-500"}`}>{sz}</div>
                        <input type="number" min="0" value={sizes[sz]||""} onChange={e=>setSizes(prev=>({...prev,[sz]:parseInt(e.target.value)||0}))}
                          placeholder="0" className={`w-full text-center text-sm border rounded-xl py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 ${BIG_SIZES.includes(sz)?"border-amber-200 bg-amber-50":"border-slate-200"}`} />
                        {hasInv && <div className={`text-[10px] mt-1 ${stock!=null&&stock>0?(stock<50?"text-amber-500":"text-emerald-500"):"text-red-400"}`}>
                          {stock!=null?(stock>0?`${stock} avail`:"out"):"—"}</div>}
                      </div>);
                    })}
                  </div>
                  <div className="flex justify-between items-center border-t border-slate-100 pt-3">
                    <div className="text-sm text-slate-500">Total: <span className="font-bold text-slate-900">{qty} pcs</span>
                      {twoXL > 0 && <span className="ml-3 text-amber-600 text-xs font-semibold">+$2/pc on {twoXL} oversized</span>}</div>
                    {qty > 0 && qty < 25 && <span className="text-xs font-semibold text-red-500 bg-red-50 px-3 py-1 rounded-full border border-red-100">Min 25 pcs</span>}
                  </div>
                </>);
              })()}
            </div>
          )}

          {/* ── Print ── */}
          {style && (
            <div className="border-t border-slate-100 pt-5 space-y-3">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Print</div>
              {imprints.map((imp, idx) => (
                <div key={imp.id} className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-600">Print {idx+1}</span>
                    {imprints.length > 1 && <button onClick={()=>setImprints(prev=>prev.filter((_,i)=>i!==idx))} className="text-xs text-red-400 hover:text-red-600">Remove</button>}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-[11px] text-slate-400 mb-1">Placement</label>
                      <select value={imp.location} onChange={e=>updateImprint(idx,{location:e.target.value})}
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300">
                        {LOCATIONS.map(l=><option key={l} value={l}>{l}</option>)}</select></div>
                    <div><label className="block text-[11px] text-slate-400 mb-1">Technique</label>
                      <select value={imp.technique} onChange={e=>updateImprint(idx,{technique:e.target.value})}
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300">
                        {["Screen Print","DTG","Embroidery","DTF","Heat Transfer"].map(t=><option key={t}>{t}</option>)}</select></div>
                  </div>
                  <div><label className="block text-[11px] text-slate-400 mb-1.5">Colors</label>
                    <div className="flex gap-1.5">{COLOR_COUNTS.map(n=>(
                      <button key={n} onClick={()=>updateImprint(idx,{colors:n})}
                        className={`w-9 h-9 rounded-lg text-sm font-bold transition ${imp.colors===n?"bg-indigo-600 text-white":"bg-white border border-slate-200 text-slate-600 hover:border-indigo-300"}`}>{n}</button>
                    ))}</div></div>
                  <div><label className="block text-[11px] text-slate-400 mb-1">Pantone(s)</label>
                    <input value={imp.pantones||""} onChange={e=>updateImprint(idx,{pantones:e.target.value})} placeholder="e.g. PMS 286 C"
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
                  <div><label className="block text-[11px] text-slate-400 mb-1">Artwork <span className="text-slate-300">(optional)</span></label>
                    {artFiles[idx] ? (
                      <div>
                        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs">
                          <span className="text-emerald-600 font-semibold truncate flex-1">✓ {artFiles[idx].name}</span>
                          <button onClick={()=>{setArtFiles(prev=>{const n={...prev};delete n[idx];return n;}); setColorResults(prev=>{const n={...prev};delete n[idx];return n;});}} className="text-slate-400 hover:text-red-500 text-xs">Remove</button>
                        </div>
                        <ColorAnalysisResult result={colorResults[idx]} imageUrl={artFiles[idx]?.url}
                          onApplyCount={(count) => updateImprint(idx, { colors: Math.min(8, Math.max(1, count)) })} />
                      </div>
                    ) : (
                      <label className={`flex items-center gap-2 border-2 border-dashed rounded-lg px-3 py-2.5 cursor-pointer transition text-xs ${uploading[idx]?"border-indigo-300 bg-indigo-50":"border-slate-200 hover:border-indigo-300 hover:bg-slate-50"}`}>
                        <input type="file" accept=".ai,.eps,.pdf,.png,.jpg,.jpeg,.svg,.psd" className="hidden"
                          onChange={e=>e.target.files[0]&&handleArtUpload(idx,e.target.files[0])} />
                        {uploading[idx] ? <span className="text-indigo-500">Uploading…</span> : <span className="text-slate-400">Upload artwork</span>}
                      </label>
                    )}</div>
                </div>
              ))}
              <button onClick={()=>setImprints(prev=>[...prev,{id:uid(),location:"Back",colors:1,pantones:"",technique:"Screen Print",details:""}])}
                className="w-full text-sm font-semibold text-indigo-600 border border-indigo-200 rounded-xl py-2.5 hover:bg-indigo-50 transition">+ Add Print Location</button>
            </div>
          )}

          {/* ── Turnaround ── */}
          {style && (
            <div className="border-t border-slate-100 pt-5">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Turnaround</div>
              <div className="flex gap-3">
                {[{val:false,label:"Standard",sub:"14 business days"},{val:true,label:"Rush",sub:"7 business days",badge:"+20%"}].map(opt=>(
                  <button key={String(opt.val)} onClick={()=>setRush(opt.val)}
                    className={`flex-1 rounded-xl border-2 px-4 py-3 text-left transition ${rush===opt.val?"border-indigo-600 bg-indigo-50":"border-slate-200 hover:border-slate-300"}`}>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-bold ${rush===opt.val?"text-indigo-700":"text-slate-700"}`}>{opt.label}</span>
                      {opt.badge && <span className="text-xs font-bold text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">{opt.badge}</span>}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">{opt.sub}</div>
                  </button>))}
              </div>
            </div>
          )}

                </div>
              </div>
            );
          })}

          <div className="flex justify-between items-center gap-3">
            <button
              onClick={addGarment}
              className="font-semibold px-5 py-2.5 rounded-xl transition text-sm border-2 border-indigo-200 text-indigo-600 hover:bg-indigo-50"
            >
              + Add Another Garment
            </button>
            <button onClick={()=>{
              const anyValid = garments.some(gg => {
                const gQ = Object.values(gg.sizes).reduce((a,v)=>a+(parseInt(v)||0),0);
                return gg.style && gg.color && gQ >= 25;
              });
              if (anyValid) setStep(2);
            }}
              disabled={!garments.some(gg => { const gQ = Object.values(gg.sizes).reduce((a,v)=>a+(parseInt(v)||0),0); return gg.style && gg.color && gQ >= 25; })}
              className={`font-semibold px-6 py-2.5 rounded-xl transition ${garments.some(gg => { const gQ = Object.values(gg.sizes).reduce((a,v)=>a+(parseInt(v)||0),0); return gg.style && gg.color && gQ >= 25; })?"bg-indigo-600 hover:bg-indigo-700 text-white":"bg-slate-100 text-slate-400 cursor-not-allowed"}`}>
              Continue →
            </button>
          </div>
        </div>
        );
      })()}

      {/* STEP 2: Contact Details */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button onClick={()=>setStep(1)} className="text-slate-400 hover:text-slate-700 text-sm">← Back</button>
            <h3 className="text-lg font-bold text-slate-800">Your details</h3>
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
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
                    className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">In-Hands Date</label>
                <input type="date" value={contact.dueDate} onChange={e=>setContact(c=>({...c,dueDate:e.target.value}))}
                  className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Art / Special Notes</label>
                <input value={contact.notes} onChange={e=>setContact(c=>({...c,notes:e.target.value}))}
                  placeholder="File format, special instructions, Pantone refs…"
                  className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={()=>contact.name.trim()&&contact.email.trim()&&setStep(3)}
              disabled={!contact.name.trim() || !contact.email.trim()}
              className={`font-semibold px-6 py-2.5 rounded-xl transition ${contact.name.trim() && contact.email.trim() ? "bg-indigo-600 hover:bg-indigo-700 text-white" : "bg-slate-100 text-slate-400 cursor-not-allowed"}`}
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
            <h3 className="text-lg font-bold text-slate-800">Review &amp; Submit</h3>
          </div>
          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-4">
              {/* Order summary */}
              <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Order Summary</div>
                <div className="flex justify-between text-sm"><span className="text-slate-400">Garment</span><span className="font-semibold">{style?.name}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-400">Color</span><span className="font-semibold">{color}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-400">Print Setup</span><span className="font-semibold">{setup?.name}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-400">Locations</span>
                  <span className="font-semibold text-right">{imprints.map(i=>`${i.location} (${i.colors}c)`).join(", ")}</span>
                </div>
                {Object.keys(artFiles).length > 0 && (
                  <div className="border-t border-slate-100 pt-2">
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Artwork</div>
                    {Object.entries(artFiles).map(([idx, f])=>(
                      <div key={idx} className="flex items-center gap-1.5 text-xs text-slate-600">
                        <span className="text-emerald-500">✓</span>
                        <span className="text-slate-400">{imprints[idx]?.location}:</span>
                        <span className="font-medium truncate">{f.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex justify-between text-sm"><span className="text-slate-400">Turnaround</span>
                  <span className={`font-semibold ${rush?"text-orange-600":""}`}>{rush?"Rush — 7 days":"Standard — 14 days"}</span>
                </div>
                <div className="border-t border-slate-100 pt-2">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Sizes</div>
                  <div className="flex flex-wrap gap-1.5">
                    {SIZES.filter(sz=>(parseInt(sizes[sz])||0)>0).map(sz=>(
                      <span key={sz} className={`text-xs font-semibold px-2 py-1 rounded-lg border ${BIG_SIZES.includes(sz)?"bg-amber-50 border-amber-200 text-amber-700":"bg-slate-50 border-slate-200 text-slate-600"}`}>
                        {sz}: {sizes[sz]}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              {/* Contact */}
              <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-1.5 text-sm">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Contact</div>
                <div className="flex justify-between"><span className="text-slate-400">Name</span><span className="font-semibold">{contact.name}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Email</span><span className="font-semibold">{contact.email}</span></div>
                {contact.phone && <div className="flex justify-between"><span className="text-slate-400">Phone</span><span className="font-semibold">{contact.phone}</span></div>}
                {contact.company && <div className="flex justify-between"><span className="text-slate-400">Company</span><span className="font-semibold">{contact.company}</span></div>}
                {contact.dueDate && <div className="flex justify-between"><span className="text-slate-400">In-Hands</span><span className="font-semibold">{fmtDate(contact.dueDate)}</span></div>}
              </div>
            </div>

            {/* Pricing breakdown */}
            <div className="bg-slate-900 rounded-2xl overflow-hidden">
              <div className="bg-slate-800 px-5 py-3 border-b border-slate-700">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Pricing Breakdown</div>
              </div>
              <div className="p-5 space-y-0">
                {price && imprints.filter(i=>i.colors>0).sort((a,b)=>a.colors-b.colors).map((imp,i)=>(
                  <div key={imp.id} className="flex justify-between py-2 border-b border-slate-800 text-xs">
                    <span className="text-slate-400 uppercase tracking-wide">{i===0?"1st Print":"+ Add'l Print"} — {imp.location} ({imp.colors}c)</span>
                    <span className="text-white font-semibold">
                      {fmtMoney((i===0?price.firstPPP:(ADDL_PRINT[Math.min(8,Math.max(1,imp.colors))][price.tier]||0))*qty)}
                    </span>
                  </div>
                ))}
                {price && (
                  <div className="flex justify-between py-2 border-b border-slate-800 text-xs">
                    <span className="text-slate-400 uppercase tracking-wide">Garments ({qty} × {fmtMoney((style?.garmentCost||0)*getAdminMarkup(style?.garmentCost))})</span>
                    <span className="text-white font-semibold">{fmtMoney(price.gCost)}</span>
                  </div>
                )}
                {twoXL > 0 && (
                  <div className="flex justify-between py-2 border-b border-slate-800 text-xs">
                    <span className="text-amber-400 uppercase tracking-wide">2XL+ Surcharge ({twoXL} × $2)</span>
                    <span className="text-amber-400 font-semibold">{fmtMoney(twoXL*2)}</span>
                  </div>
                )}
                {rush && price && (
                  <div className="flex justify-between py-2 border-b border-slate-800 text-xs">
                    <span className="text-orange-400 uppercase tracking-wide">Rush Fee (+20%)</span>
                    <span className="text-orange-400 font-semibold">{fmtMoney(price.rushFee)}</span>
                  </div>
                )}
              </div>
              <div className="bg-emerald-800 px-5 py-5 flex justify-between items-center">
                <div>
                  <div className="text-xs font-bold text-emerald-300 uppercase tracking-widest mb-0.5">Estimated Total</div>
                  <div className="text-emerald-200 text-xs">{fmtMoney(livePpp)}/pc · {getTier(qty)}+ pricing tier</div>
                  <div className="text-emerald-300 text-xs mt-1">*Final quote confirmed after art review</div>
                </div>
                <div className="text-4xl font-bold text-white">{fmtMoney(liveTotals?.total || total)}</div>
              </div>
              <div className="p-5">
                <button onClick={handleSubmit}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl transition text-sm">
                  Submit Order Request →
                </button>
                <p className="text-xs text-slate-500 text-center mt-3">We'll confirm your order within 1 business day. No payment required now.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}