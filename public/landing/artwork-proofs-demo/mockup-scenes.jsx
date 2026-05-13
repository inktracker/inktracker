// mockup-scenes.jsx — InkTracker "Mockups & Art Proof" demo (~26s)

const MK = {
  appBg: '#F5F5F8',
  surface: '#FFFFFF',
  surface2: '#FAFAFC',
  surface3: '#F1F1F4',
  border: '#E5E7EB',
  borderStrong: '#CBD5E1',
  text1: '#0F172A',
  text2: '#475569',
  text3: '#94A3B8',
  text4: '#CBD5E1',
  accent: '#4F46E5',
  accentHover: '#4338CA',
  accentText: '#4338CA',
  accentSoft: '#EEF2FF',
  accentBorder: '#C7D2FE',
  green: '#16A34A',
  greenSoft: '#DCFCE7',
  greenBorder: '#86EFAC',
  magic: '#7C3AED',
  magicSoft: '#F5F3FF',
  navy: '#0F172A',
};
const MF = '"Inter", system-ui, -apple-system, sans-serif';
const MM = '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace';

const MDARK = '#0B0B0E';
const MDARK1 = '#F4F4F5';
const MDARK2 = 'rgba(244,244,245,0.62)';
const MDARK3 = 'rgba(244,244,245,0.40)';

const ART_INK = '#E9DEC7'; // cream/sand ink color matching the design

function mclamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ─── Logo ───────────────────────────────────────────────────────────────────
function MLogo({ size = 32 }) {
  return (
    <img src="assets/inktracker-logo.png" alt="InkTracker"
      style={{ width: size, height: size, display: 'block', objectFit: 'contain', flexShrink: 0 }} />
  );
}

// ─── Sidebar ───────────────────────────────────────────────────────────────
const MNAV = [
  { label: 'Dashboard',   icon: 'home' },
  { label: 'Quotes',      icon: 'doc' },
  { label: 'Production',  icon: 'box' },
  { label: 'Customers',   icon: 'users' },
  { label: 'Inventory',   icon: 'archive' },
  { label: 'Invoices',    icon: 'receipt' },
  { label: 'Performance', icon: 'chart' },
  { label: 'Mockups',     icon: 'paint' },
  { label: 'Wizard',      icon: 'wand' },
  { label: 'Embed',       icon: 'code' },
  { label: 'Account',     icon: 'gear' },
];

function MNavIcon({ kind, color }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
    stroke: color, strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (kind) {
    case 'home':    return <svg {...p}><path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-4v-7H8v7H4a1 1 0 01-1-1z"/></svg>;
    case 'doc':     return <svg {...p}><path d="M7 3h8l4 4v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1zM14 3v5h5"/></svg>;
    case 'box':     return <svg {...p}><path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>;
    case 'users':   return <svg {...p}><circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="8" r="2.6"/><path d="M15 14c2 0 6 2 6 5"/></svg>;
    case 'archive': return <svg {...p}><rect x="3" y="5" width="18" height="4" rx="1"/><path d="M5 9v10a1 1 0 001 1h12a1 1 0 001-1V9M10 13h4"/></svg>;
    case 'receipt': return <svg {...p}><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM8 8h8M8 12h8M8 16h5"/></svg>;
    case 'chart':   return <svg {...p}><path d="M3 21h18M5 17V9M11 17V5M17 17v-6"/></svg>;
    case 'paint':   return <svg {...p}><path d="M19 11a8 8 0 11-16 0c0-4.4 3.6-8 8-8 4 0 6 2 6 4s-2 2-2 4 4 1 4 0z"/></svg>;
    case 'wand':    return <svg {...p}><path d="M15 4l5 5-9 11-5-5z"/><path d="M3 21l3-3M14 5l5 5"/></svg>;
    case 'code':    return <svg {...p}><path d="M8 6L2 12l6 6M16 6l6 6-6 6M14 4l-4 16"/></svg>;
    case 'gear':    return <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M5 5l2 2M17 17l2 2M2 12h3M19 12h3M5 19l2-2M17 7l2-2"/></svg>;
    default: return null;
  }
}

function MSidebar() {
  const active = 'Mockups';
  return (
    <div style={{
      position: 'absolute', left: 0, top: 0, bottom: 0,
      width: 232,
      borderRight: `1px solid ${MK.border}`,
      background: MK.surface,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '20px 20px 18px',
      }}>
        <MLogo size={36} />
        <div>
          <div style={{ fontFamily: MF, fontSize: 16, fontWeight: 800, color: MK.text1, letterSpacing: '-0.015em' }}>Biota Mfg</div>
          <div style={{ fontFamily: MF, fontSize: 11.5, color: MK.text3, letterSpacing: '0.01em', marginTop: 1 }}>Shop Manager</div>
        </div>
      </div>
      <div style={{ padding: '0 10px', flex: 1, overflow: 'hidden' }}>
        {MNAV.map((it) => {
          const a = it.label === active;
          return (
            <div key={it.label} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '9px 12px', margin: '2px 0',
              borderRadius: 8,
              background: a ? MK.accent : 'transparent',
              color: a ? '#fff' : MK.text2,
              fontFamily: MF, fontSize: 14, fontWeight: a ? 600 : 500,
            }}>
              <MNavIcon kind={it.icon} color={a ? '#fff' : MK.text3} />
              <span>{it.label}</span>
            </div>
          );
        })}
      </div>
      <div style={{ padding: 10 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '9px 12px', margin: '2px 0',
          borderRadius: 8,
          color: '#7C3AED',
          fontFamily: MF, fontSize: 14, fontWeight: 700,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z"/></svg>
          Admin
        </div>
      </div>
      <div style={{ padding: 14, borderTop: `1px solid ${MK.border}` }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 12px',
          background: MK.surface,
          border: `1px solid ${MK.border}`,
          borderRadius: 10,
          fontFamily: MF, fontSize: 13.5, color: MK.text3,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={MK.text3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          Search...
        </div>
      </div>
      <div style={{ padding: '0 18px 12px', fontFamily: MM, fontSize: 10, color: MK.text4, letterSpacing: '0.06em' }}>v1.0</div>
    </div>
  );
}

// ─── Mockup Cursor ──────────────────────────────────────────────────────────
function MCursor({ x, y, label }) {
  return (
    <div style={{
      position: 'absolute', left: x, top: y,
      pointerEvents: 'none', zIndex: 200,
      transition: 'left 600ms cubic-bezier(0.4,0,0.2,1), top 600ms cubic-bezier(0.4,0,0.2,1)',
    }}>
      <svg width="22" height="22" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.25))' }}>
        <path d="M3 2l7 18 2.5-7.5L20 10z" fill="#fff" stroke="#0F172A" strokeWidth="1.4" strokeLinejoin="round"/>
      </svg>
      {label && (
        <div style={{
          marginTop: 4, marginLeft: 14,
          background: MK.accent, color: '#fff',
          padding: '4px 9px', borderRadius: 6,
          fontFamily: MF, fontSize: 11.5, fontWeight: 600,
          whiteSpace: 'nowrap',
          boxShadow: '0 4px 12px rgba(79,70,229,0.4)',
        }}>{label}</div>
      )}
    </div>
  );
}

// ─── Vintage "Goods and Services" Lynx Artwork (clean SVG) ──────────────────
function LynxArtwork({ width = 560, color = ART_INK, blocky = 0 }) {
  // blocky 0..1 — 1 makes the strokes coarser to feel like raster, 0 = clean
  const sw = 0.7 + blocky * 1.2;
  const h = width * 1.05;
  return (
    <svg viewBox="0 0 560 590" width={width} height={h} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <path id="lx-top-arc" d="M 90 130 A 240 240 0 0 1 470 130" fill="none" />
        <filter id="lx-pix" x="-5%" y="-5%" width="110%" height="110%">
          <feGaussianBlur stdDeviation={blocky * 1.4} />
        </filter>
      </defs>

      <g fill={color} stroke={color} style={{ filter: blocky > 0.01 ? 'url(#lx-pix)' : 'none' }}>
        {/* SILKSCREEN arc text */}
        <text fontFamily={MF} fontWeight="800" fontSize="22" letterSpacing="0.42em" textAnchor="middle">
          <textPath href="#lx-top-arc" startOffset="50%">·  S I L K S C R E E N  ·</textPath>
        </text>

        {/* GOODS */}
        <text x="280" y="200" fontFamily="Georgia, 'Playfair Display', serif" fontWeight="900" fontSize="92" letterSpacing="0.01em" textAnchor="middle" fontStyle="italic">GOODS</text>
        {/* "and" script */}
        <text x="395" y="252" fontFamily="'Brush Script MT','Apple Chancery',cursive" fontStyle="italic" fontWeight="700" fontSize="44">and</text>
        {/* SERVICES */}
        <text x="280" y="318" fontFamily="Georgia, 'Playfair Display', serif" fontWeight="900" fontSize="92" letterSpacing="0.01em" textAnchor="middle" fontStyle="italic">SERVICES</text>

        {/* Leaping lynx silhouette — stylized cat shape */}
        <g transform="translate(140 340) scale(1)">
          {/* Body */}
          <path d="M 8 60
                   C 14 40, 38 32, 62 36
                   C 86 40, 110 44, 138 38
                   C 168 32, 196 26, 218 22
                   C 232 22, 244 28, 252 38
                   L 268 50
                   L 274 42 L 272 30 L 278 22 L 286 32 L 282 44 L 276 54
                   C 278 62, 274 70, 264 76
                   C 248 84, 226 86, 200 84
                   C 174 82, 150 88, 128 92
                   C 100 96, 76 96, 56 90
                   C 40 84, 28 80, 14 76 Z"
            fill={color} stroke="none" strokeWidth={sw} />
          {/* Front legs leaping forward */}
          <path d="M 244 50 L 258 70 L 252 78 L 240 60 Z M 230 54 L 248 78 L 240 84 L 222 64 Z" fill={color} />
          {/* Back legs */}
          <path d="M 20 80 L 12 102 L 22 104 L 32 86 Z M 50 88 L 44 110 L 56 112 L 64 90 Z" fill={color} />
          {/* Tail */}
          <path d="M 8 64 C -8 56 -16 48 -24 38 L -18 36 C -10 44 -2 52 10 60 Z" fill={color} />
          {/* Ear tufts */}
          <path d="M 256 28 L 252 14 L 262 22 Z M 270 18 L 268 4 L 278 14 Z" fill={color} />
          {/* Eye highlight (negative) */}
          <circle cx="254" cy="42" r="2" fill={MK.text1} opacity="0.6" />
          {/* Spots */}
          <circle cx="80" cy="70" r="3" fill={MK.text1} opacity="0.35" />
          <circle cx="120" cy="64" r="2.5" fill={MK.text1} opacity="0.35" />
          <circle cx="160" cy="68" r="3" fill={MK.text1} opacity="0.35" />
          <circle cx="200" cy="60" r="2.5" fill={MK.text1} opacity="0.35" />
        </g>

        {/* Alpine Quality badge (bottom-left starburst) */}
        <g transform="translate(82 466)">
          <path d="M 0 -36 L 8 -24 L 22 -28 L 18 -14 L 32 -10 L 22 0 L 32 10 L 18 14 L 22 28 L 8 24 L 0 36 L -8 24 L -22 28 L -18 14 L -32 10 L -22 0 L -32 -10 L -18 -14 L -22 -28 L -8 -24 Z"
            fill={color} stroke="none" />
          <text x="0" y="-4" textAnchor="middle" fontFamily={MF} fontWeight="800" fontSize="9" fill={MK.text1} letterSpacing="0.04em">ALPINE</text>
          <text x="0" y="8" textAnchor="middle" fontFamily={MF} fontWeight="800" fontSize="9" fill={MK.text1} letterSpacing="0.04em">QUALITY</text>
        </g>

        {/* Checkered band */}
        <g transform="translate(140 470)">
          {[...Array(20)].map((_, i) => (
            <rect key={i} x={i * 14} y={0} width="14" height="14" fill={i % 2 === 0 ? color : 'transparent'} />
          ))}
        </g>

        {/* BIOTA MFG */}
        <text x="280" y="528" fontFamily="Georgia, 'Playfair Display', serif" fontWeight="900" fontSize="56" letterSpacing="0.02em" textAnchor="middle" fontStyle="italic">BIOTA MFG</text>
        <text x="280" y="558" fontFamily={MF} fontWeight="800" fontSize="14" letterSpacing="0.22em" textAnchor="middle">"BUILT FOR THE HIGH SIERRA"</text>
        <text x="98" y="558" fontFamily={MF} fontWeight="800" fontSize="11" letterSpacing="0.2em" textAnchor="middle" opacity="0.7">★</text>
        <text x="462" y="558" fontFamily={MF} fontWeight="800" fontSize="11" letterSpacing="0.2em" textAnchor="middle" opacity="0.7">★</text>
      </g>
    </svg>
  );
}

// ─── T-shirt — crossfades between three states:
//     blank (real Comfort Colors 1717 product photo) → raw artwork → cleaned
//     `rawOpacity` and `cleanOpacity` are independent 0..1 values so the
//     scene can drive each layer smoothly.
function TShirt({ width = 760, rawOpacity = 0, cleanOpacity = 0, cleaned }) {
  // Back-compat: legacy `cleaned` prop still works (0 = raw, 1 = clean)
  if (cleaned !== undefined && rawOpacity === 0 && cleanOpacity === 0) {
    rawOpacity = 1;
    cleanOpacity = cleaned;
  }
  const w = width;
  const h = w * 1.05;
  return (
    <div style={{ position: 'relative', width: w, height: h, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img src="assets/shirt-blank.png" alt=""
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'block', opacity: 1 }} />
      <img src="assets/shirt-real.png" alt=""
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'block', opacity: rawOpacity, transition: 'opacity 80ms linear' }} />
      <img src="assets/shirt-real-clean.png" alt=""
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'block', opacity: cleanOpacity, transition: 'opacity 80ms linear' }} />
    </div>
  );
}

// ─── Page chrome: Mockup Designer ──────────────────────────────────────────

function FieldLabelM({ children, noMargin }) {
  return (
    <div style={{
      fontFamily: MF, fontSize: 11, color: MK.text3, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.1em',
      marginBottom: noMargin ? 0 : 7,
    }}>{children}</div>
  );
}

function MCaret() {
  const time = useTime();
  const on = (time * 1.8) % 1 < 0.5;
  return (
    <span style={{
      display: 'inline-block', width: 2, height: 14,
      background: MK.accent, marginLeft: 2,
      opacity: on ? 1 : 0,
      verticalAlign: 'middle',
    }} />
  );
}

function MInput({ value, placeholder, typing, label, small, focused, prefix, suffix }) {
  return (
    <div>
      {label && <div style={{ fontFamily: MF, fontSize: 12, color: MK.text2, marginBottom: 5 }}>{label}</div>}
      <div style={{
        padding: small ? '8px 12px' : '10px 14px',
        background: MK.surface,
        border: `1.5px solid ${(typing || focused) ? MK.accent : MK.border}`,
        borderRadius: 8,
        fontFamily: MF, fontSize: small ? 13 : 14, fontWeight: 500,
        color: value ? MK.text1 : MK.text3,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        minHeight: small ? 32 : 38,
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          {prefix && <span style={{ color: MK.text3, marginRight: 4 }}>{prefix}</span>}
          {value || placeholder}
          {typing && <MCaret />}
        </span>
        {suffix}
      </div>
    </div>
  );
}

const COLOR_CHIPS = [
  { name: 'Banana', hex: '#F1E5A3' },
  { name: 'Bay',    hex: '#1F3A4C' },
  { name: 'Berry',  hex: '#8A2E55' },
  { name: 'Black',  hex: '#1A1A1C' },
  { name: 'Blossom',hex: '#F5C5D2' },
  { name: 'Blue Jean', hex: '#5A7A95' },
  { name: 'Blue Spruce', hex: '#2C4A45' },
  { name: 'Brick',  hex: '#A04331' },
  { name: 'Bright Orange', hex: '#E66A30' },
  { name: 'Bright Salmon', hex: '#F08070' },
  { name: 'Burnt Orange', hex: '#B85633' },
  { name: 'Butter', hex: '#F2E89A' },
  { name: 'Chalky Mint', hex: '#A8D5C5' },
  { name: 'Chambray', hex: '#7A92AE' },
  { name: 'Chili',  hex: '#9F2C2C' },
];

function ColorChip({ name, selected, dot }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '6px 12px',
      background: selected ? MK.accent : MK.surface,
      color: selected ? '#fff' : MK.text2,
      border: selected ? 'none' : `1px solid ${MK.border}`,
      borderRadius: 999,
      fontFamily: MF, fontSize: 12.5, fontWeight: selected ? 600 : 500,
      whiteSpace: 'nowrap',
    }}>
      {dot && <span style={{ width: 10, height: 10, borderRadius: 5, background: dot, border: selected ? '1px solid rgba(255,255,255,0.35)' : `1px solid ${MK.border}` }} />}
      {name}
    </span>
  );
}

function MockupPage({
  styleVal = '',
  styleTyping = false,
  garmentLoaded = 0,
  selectedColor = null,
  artUploaded = 0,
  artBlocky = 1,
  customer = '',
  customerTyping = false,
  quote = '',
  quoteTyping = false,
  qty = '',
  qtyTyping = false,
  pw = '',
  ph = '',
  color1 = '',
  color1Typing = false,
  tolerance = 0,
  contrast = 100,
  rotation = 0,
  pdfBtnHi = 0,
  highlightSearchBtn = 0,
  highlightUploadBtn = 0,
  highlightMakeOneColorBtn = 0,
  rawOpacity = 0,
  cleanOpacity = 0,
  showTools = false,
}) {
  return (
    <div style={{
      position: 'absolute', left: 232, top: 0, right: 0, bottom: 0,
      overflow: 'hidden',
      padding: '32px 44px',
    }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: MF, fontSize: 32, fontWeight: 800, color: MK.text1, letterSpacing: '-0.025em', margin: 0 }}>Mockup Designer</h1>
        <div style={{ fontFamily: MF, fontSize: 14, color: MK.text3, marginTop: 4 }}>Create print mockups and art proofs</div>
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.05fr', gap: 28, height: 'calc(100% - 90px)' }}>
        {/* LEFT — form column */}
        <div style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Garment */}
          <Card>
            <FieldLabelM>Garment</FieldLabelM>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <MInput value={styleVal} placeholder="Style # (e.g. 5001, 1717)" typing={styleTyping} />
              </div>
              <button style={{
                padding: '10px 16px',
                background: MK.accent, color: '#fff',
                border: 'none', borderRadius: 8,
                boxShadow: highlightSearchBtn > 0
                  ? `0 0 0 ${4 + highlightSearchBtn * 6}px rgba(79,70,229,${highlightSearchBtn * 0.18}), 0 4px 12px rgba(79,70,229,0.3)`
                  : 'none',
                transform: `scale(${1 + highlightSearchBtn * 0.03})`,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
              </button>
            </div>
            {garmentLoaded > 0 && (
              <div style={{
                marginTop: 10,
                fontFamily: MF, fontSize: 14, fontWeight: 700, color: MK.green,
                opacity: garmentLoaded,
                transform: `translateY(${(1 - garmentLoaded) * 4}px)`,
              }}>
                ✓ Comfort Colors 1717
              </div>
            )}
          </Card>

          {/* Color picker (always rendered — fades in once garment is loaded) */}
          <Card opacity={mclamp((garmentLoaded - 0.4) / 0.6, 0, 1)}>
              <FieldLabelM>Color</FieldLabelM>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {COLOR_CHIPS.slice(0, 11).map((c) => (
                  <ColorChip key={c.name} name={c.name} dot={c.hex} selected={selectedColor === c.name} />
                ))}
              </div>
            </Card>

          {/* Artwork */}
          <Card>
            <FieldLabelM>Artwork</FieldLabelM>
            <div style={{
              padding: '20px 14px',
              border: `2px dashed ${highlightUploadBtn > 0 ? MK.accent : MK.borderStrong}`,
              borderRadius: 10,
              background: highlightUploadBtn > 0 ? MK.accentSoft : MK.surface2,
              textAlign: 'center',
              fontFamily: MF, fontSize: 14, fontWeight: 600,
              color: highlightUploadBtn > 0 ? MK.accent : MK.text2,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              boxShadow: highlightUploadBtn > 0
                ? `0 0 0 ${4 + highlightUploadBtn * 6}px rgba(79,70,229,${highlightUploadBtn * 0.16})`
                : 'none',
              transform: `scale(${1 + highlightUploadBtn * 0.01})`,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
              {artUploaded > 0 ? 'Change Front Artwork' : 'Upload Front Artwork'}
            </div>
            {artUploaded > 0 && (
              <div style={{ marginTop: 10, fontFamily: MF, fontSize: 12.5, color: MK.text3 }}>
                Tools appear below the preview
              </div>
            )}
          </Card>

          {/* Proof details */}
          <Card>
            <FieldLabelM>Proof Details</FieldLabelM>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <MInput label="Customer" value={customer} typing={customerTyping} placeholder="Customer name" small />
              <MInput label="Quote #" value={quote} typing={quoteTyping} placeholder="Q-2026-XXX" small />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
              <MInput label="Date" value="05/12/2026" small />
              <MInput label="Due Date" value="" placeholder="mm/dd/yyyy" small />
            </div>
            <div style={{ marginTop: 10 }}>
              <MInput label="Quantity" value={qty} typing={qtyTyping} placeholder="100" small />
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontFamily: MF, fontSize: 12, color: MK.text2, marginBottom: 5 }}>Front Print Size (inches)</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1 }}><MInput value={pw} placeholder="" small /></div>
                <span style={{ fontFamily: MF, fontSize: 14, color: MK.text3 }}>x</span>
                <div style={{ flex: 1 }}><MInput value={ph} placeholder="" small /></div>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontFamily: MF, fontSize: 12, color: MK.text2, marginBottom: 5 }}>Front Colors</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <MInput value={color1} typing={color1Typing} placeholder="Color 1" small focused={color1Typing} />
                <MInput value="" placeholder="Color 2" small />
              </div>
            </div>
          </Card>

          {/* Generate PDF button */}
          <button style={{
            padding: '14px 22px',
            background: MK.navy, color: '#fff',
            border: 'none', borderRadius: 10,
            fontFamily: MF, fontSize: 15, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            boxShadow: pdfBtnHi > 0
              ? `0 0 0 ${4 + pdfBtnHi * 8}px rgba(15,23,42,${pdfBtnHi * 0.18}), 0 8px 24px rgba(15,23,42,0.3)`
              : '0 4px 12px rgba(15,23,42,0.18)',
            transform: `scale(${1 + pdfBtnHi * 0.025})`,
            whiteSpace: 'nowrap',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/><path d="M9 14h6M9 17h4"/></svg>
            Generate Art Proof PDF
          </button>
        </div>

        {/* RIGHT — preview column */}
        <div style={{
          background: MK.surface,
          border: `1px solid ${MK.border}`,
          borderRadius: 14,
          padding: 24,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
          minHeight: 0,
        }}>
          {/* Front / Back toggle */}
          {garmentLoaded > 0 && (
            <div style={{
              display: 'flex', gap: 6,
              background: MK.surface3, padding: 4, borderRadius: 10,
              marginBottom: 18, opacity: garmentLoaded,
            }}>
              <span style={{ padding: '6px 18px', background: MK.accent, color: '#fff', borderRadius: 7, fontFamily: MF, fontSize: 13, fontWeight: 600 }}>Front <sup style={{ marginLeft: 2 }}>•</sup></span>
              <span style={{ padding: '6px 18px', color: MK.text2, fontFamily: MF, fontSize: 13, fontWeight: 500 }}>Back</span>
            </div>
          )}

          {/* Garment image */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', width: '100%' }}>
            {garmentLoaded === 0 ? (
              <div style={{ fontFamily: MF, fontSize: 16, color: MK.text3 }}>No garment image</div>
            ) : (
              <div style={{ opacity: garmentLoaded, transform: `scale(${0.96 + 0.04 * garmentLoaded})` }}>
                <TShirt width={520} rawOpacity={rawOpacity} cleanOpacity={cleanOpacity} />
              </div>
            )}
          </div>

          {/* Label */}
          {garmentLoaded > 0.6 && (
            <div style={{
              fontFamily: MF, fontSize: 14, color: MK.text2,
              marginTop: 8, opacity: garmentLoaded,
            }}>
              Comfort Colors 1717 — Black · Front
            </div>
          )}

          {/* Tools toolbar (always rendered — fades in once art is uploaded) */}
          {(
            <div style={{
              opacity: showTools ? 1 : 0,
              transition: 'opacity 200ms',
              pointerEvents: showTools ? 'auto' : 'none',
              marginTop: 16,
              width: '100%',
              background: MK.surface2,
              border: `1px solid ${MK.border}`,
              borderRadius: 12,
              padding: '12px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <ToolBtn icon="target" />
                <ToolBtn icon="brackets" />
                <ToolBtn icon="frame" />
                <ToolBtn icon="rotate" />
                <span style={{ color: MK.border, fontFamily: MM, fontSize: 16 }}>|</span>
                <ToolBtn icon="magic" active />
                <div style={{ marginLeft: 'auto' }}>
                  <ToolBtn icon="reset" />
                </div>
              </div>
              <Slider label="Tolerance" value={tolerance} max={100} active />
              <div style={{ marginTop: 8 }}>
                <button style={{
                  padding: '6px 14px',
                  background: highlightMakeOneColorBtn > 0 ? MK.magic : MK.surface,
                  color: highlightMakeOneColorBtn > 0 ? '#fff' : MK.text1,
                  border: `1px solid ${highlightMakeOneColorBtn > 0 ? MK.magic : MK.border}`, borderRadius: 8,
                  fontFamily: MF, fontSize: 12.5, fontWeight: 600,
                  boxShadow: highlightMakeOneColorBtn > 0
                    ? `0 0 0 ${4 + highlightMakeOneColorBtn * 6}px rgba(124,58,237,${highlightMakeOneColorBtn * 0.18}), 0 4px 12px rgba(124,58,237,0.3)`
                    : 'none',
                  transform: `scale(${1 + highlightMakeOneColorBtn * 0.03})`,
                  transition: 'all 120ms',
                }}>Make One Color</button>
              </div>
              <div style={{ marginTop: 8 }}>
                <Slider label="Contrast" value={contrast} max={100} unit="%" />
              </div>
              <div style={{ marginTop: 8 }}>
                <Slider label="Rotation" value={rotation} max={360} unit="°" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ children, opacity = 1 }) {
  return (
    <div style={{
      background: MK.surface,
      border: `1px solid ${MK.border}`,
      borderRadius: 14,
      padding: 18,
      opacity,
    }}>{children}</div>
  );
}

function ToolBtn({ icon, active }) {
  const sw = { width: 32, height: 32, borderRadius: 7,
    background: active ? MK.magicSoft : 'transparent',
    border: active ? `1px solid #DDD6FE` : `1px solid transparent`,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
  const c = active ? MK.magic : MK.text2;
  const p = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: c, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  let body;
  switch (icon) {
    case 'target': body = <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></>; break;
    case 'brackets': body = <><path d="M7 4L4 4 4 20 7 20"/><path d="M17 4l3 0 0 16-3 0"/></>; break;
    case 'frame': body = <rect x="4" y="6" width="16" height="12" rx="1"/>; break;
    case 'rotate': body = <><path d="M21 12a9 9 0 11-3.4-7"/><polyline points="21 4 21 9 16 9"/></>; break;
    case 'magic': body = <><path d="M15 4l5 5-9 11-5-5z"/><path d="M14 5l5 5"/><circle cx="6" cy="6" r="0.5"/><circle cx="18" cy="14" r="0.5"/></>; break;
    case 'reset': body = <><polyline points="3 12 3 4 11 4"/><path d="M3 12a9 9 0 109-8"/></>; break;
    default: body = null;
  }
  return <div style={sw}><svg {...p}>{body}</svg></div>;
}

function Slider({ label, value, max, unit, active }) {
  const pct = mclamp(value / max, 0, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontFamily: MF, fontSize: 12, color: MK.text2, width: 70, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: MK.surface3, borderRadius: 3, position: 'relative' }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${pct * 100}%`,
          background: active ? MK.accent : MK.text2,
          borderRadius: 3,
        }} />
        <div style={{
          position: 'absolute', left: `calc(${pct * 100}% - 8px)`, top: -5,
          width: 16, height: 16, borderRadius: 8,
          background: active ? MK.accent : MK.text2,
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </div>
      <span style={{ fontFamily: MM, fontSize: 12, color: MK.text2, width: 40, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        {Math.round(value)}{unit || ''}
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SCENES
// ────────────────────────────────────────────────────────────────────────────

// Hook (0-3s)
function MSceneHook() {
  const { localTime } = useSprite();
  const t = localTime;
  const logoT = mclamp(t / 0.5, 0, 1);
  const h1T = mclamp((t - 0.4) / 0.5, 0, 1);
  const h2T = mclamp((t - 0.85) / 0.5, 0, 1);
  const subT = mclamp((t - 1.5) / 0.5, 0, 1);
  const trailT = mclamp((t - 2.0) / 0.6, 0, 1);
  return (
    <div style={{ position: 'absolute', inset: 0, background: MDARK, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ opacity: logoT, transform: `translateY(${(1-logoT)*8}px)`, display: 'flex', alignItems: 'center', gap: 14, marginBottom: 38 }}>
        <MLogo size={40} />
        <div style={{ fontFamily: MF, fontSize: 22, fontWeight: 700, color: MDARK1, letterSpacing: '-0.015em' }}>InkTracker</div>
      </div>
      <div style={{ opacity: h1T, transform: `translateY(${(1-h1T)*10}px)`, fontFamily: MF, fontSize: 96, fontWeight: 800, color: MDARK1, letterSpacing: '-0.045em', lineHeight: 1, textAlign: 'center' }}>Art proofs,</div>
      <div style={{ opacity: h2T, transform: `translateY(${(1-h2T)*10}px)`, fontFamily: MF, fontSize: 96, fontWeight: 800, color: '#A5B4FC', letterSpacing: '-0.045em', lineHeight: 1.02, textAlign: 'center', marginTop: 10 }}>made easy.</div>
      <div style={{ opacity: subT, transform: `translateY(${(1-subT)*8}px)`, fontFamily: MF, fontSize: 20, color: MDARK2, marginTop: 36, textAlign: 'center' }}>Garment, artwork, and a signature-ready PDF — in one screen.</div>
      <div style={{ opacity: trailT, marginTop: 56, display: 'flex', alignItems: 'center', gap: 18, fontFamily: MF, fontSize: 13, fontWeight: 700, color: MDARK3, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
        <span>Garment</span>
        <span style={{ color: 'rgba(244,244,245,0.25)' }}>→</span>
        <span>Artwork</span>
        <span style={{ color: 'rgba(244,244,245,0.25)' }}>→</span>
        <span>Proof</span>
      </div>
    </div>
  );
}

// Style search (3-7s)
function MSceneStyle() {
  const { localTime } = useSprite();
  const t = localTime; // 0..4
  // Type 1717, click search, garment appears, color "Black" selected
  const styleFull = '1717';
  const styleP = mclamp((t - 0.4) / 1.0, 0, 1);
  const styleVal = styleFull.slice(0, Math.floor(styleP * styleFull.length));
  const styleTyping = styleP > 0 && styleP < 1;
  const searchHi = mclamp((t - 1.5) / 0.4, 0, 1) * (1 - mclamp((t - 2.0) / 0.3, 0, 1));
  const garmentLoaded = mclamp((t - 2.1) / 0.6, 0, 1);
  const colorPicked = t > 2.9 ? 'Black' : null;

  // Cursor path
  let cx, cy;
  if (t < 0.4)      { cx = 900; cy = 600; }
  else if (t < 1.4) { cx = 540; cy = 380; }      // input
  else if (t < 2.0) { cx = interpolate([1.4, 2.0], [540, 760])(t); cy = interpolate([1.4, 2.0], [380, 380])(t); }
  else if (t < 2.8) { cx = interpolate([2.0, 2.8], [760, 580])(t); cy = interpolate([2.0, 2.8], [380, 590])(t); }
  else              { cx = 580; cy = 590; }

  const capT = mclamp((t - 0.2) / 0.4, 0, 1) * (1 - mclamp((t - 3.5) / 0.4, 0, 1));

  return (
    <div style={{ position: 'absolute', inset: 0, background: MK.appBg }}>
      <MSidebar />
      <MockupPage
        styleVal={styleVal}
        styleTyping={styleTyping}
        garmentLoaded={garmentLoaded}
        selectedColor={colorPicked}
        highlightSearchBtn={searchHi}
      />
      <MCursor x={cx} y={cy} label={searchHi > 0.5 ? 'Search' : (t > 2.5 && t < 2.9 ? 'Black' : null)} />
      <SceneCaption step="Step 01" text="Pick the garment." opacity={capT} />
    </div>
  );
}

// Upload artwork + remove background (7-14s)
function MSceneArtwork() {
  const { localTime } = useSprite();
  const t = localTime;

  // Beats:
  //  0.0–0.6  cursor moves to Upload, hover glow
  //  0.7      art lands on shirt (raw — with black backing block visible)
  //  1.3      tools toolbar appears
  //  2.0–3.0  cursor pans to "Make One Color" button, glow ramps
  //  3.0      click → crossfade begins
  //  3.0–4.4  shirt-real → shirt-real-clean crossfade
  //  4.6+     cursor settles, beauty pose

  const uploadHi = mclamp((t - 0.1) / 0.4, 0, 1) * (1 - mclamp((t - 0.7) / 0.3, 0, 1));
  const showTools = t > 1.3;
  const makeOneHi = mclamp((t - 2.0) / 0.5, 0, 1) * (1 - mclamp((t - 3.1) / 0.3, 0, 1));
  const cleaned = Easing.easeInOutCubic(mclamp((t - 3.0) / 1.4, 0, 1));

  // Cursor path — land the tip directly on the "Make One Color" button
  // (right column, inside tools panel: ~x=1160, y=965 in the 1920×1080 canvas)
  let cx, cy;
  if (t < 0.6)      { cx = interpolate([0, 0.6], [900, 580])(t); cy = interpolate([0, 0.6], [600, 760])(t); }
  else if (t < 1.4) { cx = 580; cy = 760; }
  else if (t < 2.4) { cx = interpolate([1.4, 2.4], [580, 1160])(t); cy = interpolate([1.4, 2.4], [760, 965])(t); }
  else if (t < 3.2) { cx = 1160; cy = 965; }
  else if (t < 4.6) { cx = interpolate([3.2, 4.6], [1160, 1380])(t); cy = interpolate([3.2, 4.6], [965, 620])(t); }
  else              { cx = 1380; cy = 620; }

  const capT = mclamp((t - 0.2) / 0.4, 0, 1);
  const capFade =
    (t > 1.85 && t < 2.25) ||
    (t > 4.45 && t < 4.85);
  let captionStep = 'Step 02', captionText = 'Drop in artwork.';
  if (t >= 2.25 && t < 4.85) { captionStep = 'Step 03'; captionText = 'Drop the background — one color, print-ready.'; }
  else if (t >= 4.85)        { captionStep = 'Step 04'; captionText = 'Mockup ready in seconds.'; }

  return (
    <div style={{ position: 'absolute', inset: 0, background: MK.appBg }}>
      <MSidebar />
      <MockupPage
        styleVal="1717"
        garmentLoaded={1}
        selectedColor="Black"
        artUploaded={1}
        artBlocky={0}
        tolerance={0}
        contrast={100}
        rotation={0}
        highlightUploadBtn={uploadHi}
        highlightMakeOneColorBtn={makeOneHi}
        cleaned={cleaned}
        showTools={showTools}
      />
      <MCursor x={cx} y={cy} label={uploadHi > 0.5 ? 'Upload' : (makeOneHi > 0.5 ? 'Remove BG' : null)} />
      <SceneCaption step={captionStep} text={captionText} opacity={capT * (capFade ? 0.4 : 1)} />
    </div>
  );
}

// Proof details (14-21s)
function MSceneProof() {
  const { localTime } = useSprite();
  const t = localTime; // 0..6.5

  // Type customer, quote, qty, sizes, color
  const customerFull = 'Biota Mfg';
  const cP = mclamp((t - 0.2) / 1.0, 0, 1);
  const customer = customerFull.slice(0, Math.floor(cP * customerFull.length));
  const customerTyping = cP > 0 && cP < 1;

  const quoteFull = 'Q-2026-591';
  const qP = mclamp((t - 1.3) / 1.0, 0, 1);
  const quote = quoteFull.slice(0, Math.floor(qP * quoteFull.length));
  const quoteTyping = qP > 0 && qP < 1;

  const qtyFull = '100';
  const qtyP = mclamp((t - 2.5) / 0.5, 0, 1);
  const qty = qtyFull.slice(0, Math.floor(qtyP * qtyFull.length));
  const qtyTyping = qtyP > 0 && qtyP < 1;

  // Size fields appear at 3.2 / 3.6
  const pw = t > 3.2 ? '13' : '';
  const ph = t > 3.6 ? '19' : '';

  const color1Full = 'Cream';
  const c1P = mclamp((t - 4.2) / 1.0, 0, 1);
  const color1 = color1Full.slice(0, Math.floor(c1P * color1Full.length));
  const color1Typing = c1P > 0 && c1P < 1;

  // Cursor moves down through the form
  let cx = 540, cy = 600;
  if (t < 0.4)      { cx = 1820; cy = 870; } // from previous
  else if (t < 1.2) { cx = interpolate([0.4, 1.2], [1820, 540])(t); cy = interpolate([0.4, 1.2], [870, 1000])(t); }
  else if (t < 2.2) { cx = 760; cy = 1000; }
  else if (t < 3.0) { cx = 540; cy = 1170; }
  else if (t < 4.0) { cx = 540; cy = 1290; }
  else              { cx = 540; cy = 1420; }

  const capT = mclamp((t - 0.2) / 0.4, 0, 1);

  return (
    <div style={{ position: 'absolute', inset: 0, background: MK.appBg }}>
      <MSidebar />
      <MockupPage
        styleVal="1717"
        garmentLoaded={1}
        selectedColor="Black"
        artUploaded={1}
        artBlocky={0}
        tolerance={42}
        contrast={100}
        rotation={0}
        showTools
        cleaned={1}
        customer={customer}
        customerTyping={customerTyping}
        quote={quote}
        quoteTyping={quoteTyping}
        qty={qty}
        qtyTyping={qtyTyping}
        pw={pw}
        ph={ph}
        color1={color1}
        color1Typing={color1Typing}
      />
      <MCursor x={cx} y={cy} />
      <SceneCaption step="Step 05" text="Fill the proof details." opacity={capT} />
    </div>
  );
}

// Generate PDF (21-25s)
function MScenePDF() {
  const { localTime } = useSprite();
  const t = localTime; // 0..4

  // 0.0–0.6 cursor moves to PDF button, glow builds
  // 0.7 click → modal flies up showing PDF preview
  // Modal animates in, big "ART PROOF" header, details rows, signature line

  const pdfHi = mclamp((t - 0.1) / 0.4, 0, 1) * (1 - mclamp((t - 0.9) / 0.3, 0, 1));
  const modalT = Easing.easeOutCubic(mclamp((t - 0.8) / 0.6, 0, 1));

  let cx, cy;
  if (t < 0.7)      { cx = interpolate([0, 0.7], [900, 360])(t); cy = interpolate([0, 0.7], [800, 1530])(t); }
  else              { cx = 360; cy = 1530; }

  return (
    <div style={{ position: 'absolute', inset: 0, background: MK.appBg }}>
      <MSidebar />
      <MockupPage
        styleVal="1717"
        garmentLoaded={1}
        selectedColor="Black"
        artUploaded={1}
        artBlocky={0}
        tolerance={42}
        contrast={100}
        rotation={0}
        showTools
        cleaned={1}
        customer="Biota Mfg"
        quote="Q-2026-591"
        qty="100"
        pw="13"
        ph="19"
        color1="Cream"
        pdfBtnHi={pdfHi}
      />
      {modalT < 0.4 && <MCursor x={cx} y={cy} label={pdfHi > 0.5 ? 'Generate' : null} />}

      {/* Backdrop */}
      {modalT > 0 && (
        <div style={{
          position: 'absolute', inset: 0,
          background: `rgba(15,23,42,${0.5 * modalT})`,
        }} />
      )}

      {/* PDF preview */}
      {modalT > 0 && (
        <div style={{
          position: 'absolute',
          left: '50%', top: '50%',
          transform: `translate(-50%, -50%) translateY(${(1 - modalT) * 60}px) scale(${0.92 + 0.08 * modalT})`,
          opacity: modalT,
          width: 880,
          height: 1140,
          background: '#FAFAF7',
          borderRadius: 8,
          boxShadow: '0 50px 120px rgba(15,23,42,0.5), 0 0 0 1px rgba(15,23,42,0.08)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}>
          <PdfProof t={t - 0.8} />
        </div>
      )}

      {/* Caption */}
      <SceneCaption step="Step 06" text="One click. Client-ready PDF." opacity={mclamp((t - 0.4) / 0.4, 0, 1)} />
    </div>
  );
}

function PdfProof({ t }) {
  // Matches the real Biota Mfg art-proof format
  const tt = mclamp(t, 0, 5);
  const Hd = ({ children }) => (
    <div style={{ fontFamily: MF, fontSize: 13, fontWeight: 700, color: MK.text1, paddingBottom: 6, marginBottom: 10, borderBottom: `1.5px solid ${MK.text1}`, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{children}</div>
  );
  const Kv = ({ k, v }) => (
    <div style={{ display: 'flex', gap: 8, fontFamily: MF, fontSize: 12.5, lineHeight: 1.55 }}>
      <span style={{ color: MK.text2, fontWeight: 600, minWidth: 110 }}>{k}</span>
      <span style={{ color: MK.text1, fontWeight: 500 }}>{v}</span>
    </div>
  );
  return (
    <div style={{ padding: '44px 56px 28px', fontFamily: MF, color: MK.text1, height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* Title */}
      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <div style={{ fontFamily: MF, fontSize: 30, fontWeight: 900, letterSpacing: '0.04em' }}>ART PROOF</div>
      </div>

      {/* Two-column top */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 36, marginBottom: 22 }}>
        <div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Kv k="Quote Number:" v="Q-2026-591" />
            <Kv k="Customer:" v="Biota Mfg" />
            <Kv k="Date Ordered:" v="2026-05-12" />
            <Kv k="Due Date:" v="—" />
            <Kv k="Quantity:" v="100" />
            <Kv k="Garment:" v="Comfort Colors 1717" />
            <Kv k="Color:" v="Black" />
          </div>
        </div>
        <div>
          <Hd>Additional Services</Hd>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: MF, fontSize: 12.5 }}>
            {['Screen Printed Neck Labels','Fold, Bag, Label','Color Change','Specialty Ink'].map(s => (
              <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, color: MK.text1 }}>
                <span style={{ width: 13, height: 13, border: `1.5px solid ${MK.text1}`, display: 'inline-block', flexShrink: 0 }} />
                {s}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* FRONT section */}
      <div style={{ marginBottom: 18 }}>
        <Hd>Front</Hd>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 36 }}>
          <div>
            <div style={{ fontFamily: MF, fontSize: 12.5, fontWeight: 700, color: MK.text1, marginBottom: 6 }}>Print Size - Front</div>
            <div style={{ fontFamily: MF, fontSize: 12.5, color: MK.text1 }}>Width: <b>13"</b>  Height: <b>19"</b></div>
          </div>
          <div>
            <div style={{ fontFamily: MF, fontSize: 12.5, fontWeight: 700, color: MK.text1, marginBottom: 6 }}>Print Colors - Front</div>
            <div style={{ fontFamily: MF, fontSize: 12.5, color: MK.text1, display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 2 }}>
              <div>1. <b>Cream</b></div>
              <div>5.</div>
              <div>2.</div>
              <div>6.</div>
              <div>3.</div>
              <div>7.</div>
              <div>4.</div>
              <div>8.</div>
            </div>
          </div>
        </div>
      </div>

      {/* Mockup image */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0, marginBottom: 14 }}>
        <div style={{ width: 360 }}>
          <TShirt width={360} cleaned={1} />
        </div>
      </div>

      {/* Pre-press checklist + Signature */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 28 }}>
        <div>
          <Hd>Pre-press Checklist</Hd>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontFamily: MF, fontSize: 12.5 }}>
            {['Check Spelling','Spot Color Check','Check Placement','Registration','Tape Registration Marks'].map(s => (
              <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 13, height: 13, border: `1.5px solid ${MK.text1}`, flexShrink: 0 }} />
                {s}
              </label>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: MF, fontSize: 12.5, fontWeight: 700, color: MK.text1, marginBottom: 4 }}>Customer Signature:</div>
          <div style={{ borderBottom: `1.5px solid ${MK.text1}`, height: 38, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 0, bottom: 2, fontFamily: MF, fontSize: 13 }}>x.</span>
            {tt > 2.0 && (
              <svg viewBox="0 0 240 44" width="240" height="38" style={{ position: 'absolute', left: 16, bottom: 2, opacity: mclamp((tt - 2.0) / 0.4, 0, 1) }}>
                <path d="M 6 32 C 18 6, 32 2, 44 16 C 54 26, 64 32, 74 18 C 84 6, 96 34, 108 24 C 118 16, 132 30, 144 12 C 156 -2, 170 26, 192 18"
                  stroke="#1E3A8A" strokeWidth="2.6" fill="none" strokeLinecap="round"
                  strokeDasharray="220" strokeDashoffset={220 - 220 * mclamp((tt - 2.0) / 1.2, 0, 1)} />
              </svg>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 18, textAlign: 'center', fontFamily: MF, fontSize: 11, color: MK.text2 }}>www.biotamfg.com</div>
    </div>
  );
}

function Spec({ label, value }) {
  return (
    <div>
      <div style={{ fontFamily: MF, fontSize: 10.5, color: MK.text3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: MF, fontSize: 15, fontWeight: 700, color: MK.text1, letterSpacing: '-0.01em' }}>{value}</div>
    </div>
  );
}

// Consolidated mid scene (3–24.5s) — one MockupPage stays mounted the whole
// time so the shirt image never unmounts/cuts. All phase state derives from
// the local time `t` (0..21.5s).
function MSceneMid() {
  const { localTime } = useSprite();
  const t = localTime;

  // Realistic flow timing (local t, 0..21.5s):
  //   0.0–3.5   Style search:  click style input → type "1717" → click search → garment loads → click Black
  //   3.5–7.5   Artwork:       click Upload → art lands → click Make One Color → background dissolves
  //   7.5–14.0  Proof details: cursor lands on each field as it's typed
  //  14.0–21.5  Generate PDF:  click Generate → modal flies up → signature animates

  // ===== Phase A: Style (0..3.5) =====
  const styleFull = '1717';
  const styleP = mclamp((t - 0.6) / 0.8, 0, 1);
  const styleVal = t < 3.5 ? styleFull.slice(0, Math.floor(styleP * styleFull.length)) : styleFull;
  const styleTyping = t > 0.6 && t < 1.4;
  const searchHi = mclamp((t - 1.55) / 0.25, 0, 1) * (1 - mclamp((t - 2.0) / 0.3, 0, 1));
  const garmentLoaded = t < 3.5 ? mclamp((t - 2.05) / 0.6, 0, 1) : 1;
  const selectedColor = (t > 3.2) ? 'Black' : null;

  // ===== Phase B: Artwork (3.5..7.5) =====
  const uploadHi = mclamp((t - 3.65) / 0.25, 0, 1) * (1 - mclamp((t - 4.05) / 0.3, 0, 1));
  const showTools = t >= 4.4;
  const makeOneHi = mclamp((t - 5.4) / 0.3, 0, 1) * (1 - mclamp((t - 5.95) / 0.3, 0, 1));
  // Three states crossfade:
  //   t < 4.0           : blank SVG shirt (rawOpacity=0, cleanOpacity=0)
  //   4.0..4.8          : raw artwork fades in (rawOpacity 0→1)
  //   4.8..5.9          : raw artwork visible
  //   5.9..7.3          : cleaned version crossfades in (cleanOpacity 0→1)
  //   t > 7.3           : final clean state
  const rawOpacity   = Easing.easeOutCubic(mclamp((t - 4.0) / 0.8, 0, 1));
  const cleanOpacity = Easing.easeInOutCubic(mclamp((t - 5.9) / 1.4, 0, 1));

  // ===== Phase C: Proof details (7.5..14.0) =====
  // Each field types in only while the cursor is on it.
  const typedField = (full, startT, dur) => {
    if (t < startT) return '';
    if (t >= startT + dur) return full;
    const k = (t - startT) / dur;
    return full.slice(0, Math.floor(full.length * k));
  };
  // Schedule:
  //   7.7  → Customer       "Biota Mfg"        (0.9s)
  //   8.9  → Quote #        "Q-2026-591"       (1.1s)
  //  10.2  → Quantity       "100"              (0.4s)
  //  10.9  → Print Width    "13"               (0.2s)
  //  11.4  → Print Height   "19"               (0.2s)
  //  12.1  → Color 1        "Cream"            (0.7s)
  const customer       = typedField('Biota Mfg',  7.7,  0.9);
  const customerTyping = t > 7.7 && t < 8.6;
  const quote          = typedField('Q-2026-591', 8.9,  1.1);
  const quoteTyping    = t > 8.9 && t < 10.0;
  const qty            = typedField('100',        10.2, 0.4);
  const qtyTyping      = t > 10.2 && t < 10.6;
  const pw             = t >= 11.0 ? '13' : '';
  const ph             = t >= 11.5 ? '19' : '';
  const color1         = typedField('Cream',      12.1, 0.7);
  const color1Typing   = t > 12.1 && t < 12.8;

  // ===== Phase D: Generate PDF (14.0..21.5) =====
  const v = t - 14.0;
  const pdfBtnHi = t >= 14.0 ? mclamp((t - 14.15) / 0.25, 0, 1) * (1 - mclamp((t - 14.55) / 0.3, 0, 1)) : 0;
  const modalT = t >= 14.0 ? Easing.easeOutCubic(mclamp((t - 14.6) / 0.7, 0, 1)) : 0;

  // ===== Cursor path =====
  // Waypoints land directly on the UI elements being interacted with.
  const WP = [
    { t: 0.0,  x: 900,  y: 600  },                                  // idle
    { t: 0.55, x: 430,  y: 320  },                                  // style input
    { t: 1.4,  x: 430,  y: 320  },                                  // (stay while typing)
    { t: 1.8,  x: 650,  y: 320  },                                  // search button
    { t: 2.7,  x: 650,  y: 320  },                                  // wait for garment to load
    { t: 3.25, x: 520,  y: 470  },                                  // Black chip
    { t: 3.65, x: 520,  y: 700  },                                  // Upload button
    { t: 4.4,  x: 520,  y: 700  },                                  // (after click, art lands)
    { t: 5.5,  x: 1160, y: 965  },                                  // Make One Color
    { t: 6.05, x: 1160, y: 965  },                                  // (after click, bg dissolves)
    { t: 7.55, x: 460,  y: 825  },                                  // Customer field
    { t: 8.9,  x: 770,  y: 825  },                                  // Quote # field
    { t: 10.2, x: 460,  y: 920  },                                  // Quantity
    { t: 10.95,x: 330,  y: 985  },                                  // Print Width
    { t: 11.5, x: 540,  y: 985  },                                  // Print Height
    { t: 12.1, x: 460,  y: 1060 },                                  // Color 1
    { t: 12.95,x: 460,  y: 1060 },                                  // (linger after typing)
    { t: 14.05,x: 460,  y: 1240 },                                  // Generate PDF button
    { t: 14.55,x: 460,  y: 1240 },                                  // click peak
  ];
  function lerp(a, b, k) { return a + (b - a) * k; }
  let cx = WP[0].x, cy = WP[0].y;
  for (let i = 0; i < WP.length - 1; i++) {
    const a = WP[i], b = WP[i + 1];
    if (t >= a.t && t <= b.t) {
      const k = (t - a.t) / (b.t - a.t || 1);
      cx = lerp(a.x, b.x, k);
      cy = lerp(a.y, b.y, k);
      break;
    }
    if (t > b.t && i === WP.length - 2) { cx = b.x; cy = b.y; }
  }
  // Hide cursor while modal is centered
  const showCursor = modalT < 0.4;
  let cursorLabel = null;
  if (searchHi > 0.5) cursorLabel = 'Search';
  else if (t > 3.1 && t < 3.5) cursorLabel = 'Black';
  else if (uploadHi > 0.5) cursorLabel = 'Upload';
  else if (makeOneHi > 0.5) cursorLabel = 'Remove BG';
  else if (pdfBtnHi > 0.5) cursorLabel = 'Generate';

  // ===== Caption =====
  let captionStep = 'Step 01', captionText = 'Pick the garment.';
  if (t >= 3.5 && t < 5.5)      { captionStep = 'Step 02'; captionText = 'Drop in artwork.'; }
  else if (t >= 5.5 && t < 7.4) { captionStep = 'Step 03'; captionText = 'One-color mode — background drops out.'; }
  else if (t >= 7.4 && t < 14.0){ captionStep = 'Step 04'; captionText = 'Fill in the proof details.'; }
  else if (t >= 14.0)           { captionStep = 'Step 05'; captionText = 'One click. Client-ready PDF.'; }
  // Cross-fade caption around transitions
  const BOUNDARIES = [3.5, 5.5, 7.4, 14.0];
  let capFade = 1;
  for (const b of BOUNDARIES) {
    const d = Math.abs(t - b);
    if (d < 0.35) capFade = Math.min(capFade, d / 0.35);
  }
  const capT = mclamp((t - 0.2) / 0.4, 0, 1);

  return (
    <div style={{ position: 'absolute', inset: 0, background: MK.appBg }}>
      <MSidebar />
      <MockupPage
        styleVal={styleVal}
        styleTyping={styleTyping}
        garmentLoaded={garmentLoaded}
        selectedColor={selectedColor}
        artUploaded={t >= 4.0 ? 1 : 0}
        artBlocky={0}
        tolerance={t >= 5.5 ? 42 : 0}
        contrast={100}
        rotation={0}
        highlightSearchBtn={searchHi}
        highlightUploadBtn={uploadHi}
        highlightMakeOneColorBtn={makeOneHi}
        rawOpacity={rawOpacity}
        cleanOpacity={cleanOpacity}
        showTools={showTools}
        customer={customer}
        customerTyping={customerTyping}
        quote={quote}
        quoteTyping={quoteTyping}
        qty={qty}
        qtyTyping={qtyTyping}
        pw={pw}
        ph={ph}
        color1={color1}
        color1Typing={color1Typing}
        pdfBtnHi={pdfBtnHi}
      />
      {/* Cursor and step captions removed for a cleaner walkthrough */}

      {/* PDF modal */}
      {modalT > 0 && (
        <>
          <div style={{ position: 'absolute', inset: 0, background: `rgba(15,23,42,${0.5 * modalT})` }} />
          <div style={{
            position: 'absolute',
            left: '50%', top: '50%',
            transform: `translate(-50%, -50%) translateY(${(1 - modalT) * 60}px) scale(${0.92 + 0.08 * modalT})`,
            opacity: modalT,
            width: 880, height: 1140,
            background: '#FAFAF7', borderRadius: 8,
            boxShadow: '0 50px 120px rgba(15,23,42,0.5), 0 0 0 1px rgba(15,23,42,0.08)',
            overflow: 'hidden', display: 'flex', flexDirection: 'column',
          }}>
            <PdfProof t={v - 0.8} />
          </div>
        </>
      )}

      {/* Caption removed */}
    </div>
  );
}

// Outro (25-28s)
function MSceneOutro() {
  const { localTime } = useSprite();
  const t = localTime;
  const inT = Easing.easeOutCubic(mclamp(t / 0.6, 0, 1));
  const checkT = mclamp((t - 0.3) / 0.5, 0, 1);
  const wordT = mclamp((t - 0.9) / 0.5, 0, 1);

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: MDARK,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at center, rgba(79,70,229,0.22), transparent 60%)',
        opacity: inT,
      }} />

      <div style={{
        opacity: checkT,
        transform: `scale(${0.7 + 0.3 * Easing.easeOutCubic(checkT)})`,
        width: 96, height: 96, borderRadius: 48,
        background: '#16A34A',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 14px 36px rgba(22,163,74,0.4)',
        marginBottom: 32,
      }}>
        <svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>

      <div style={{
        opacity: inT,
        transform: `translateY(${(1 - inT) * 16}px)`,
        fontFamily: MF, fontSize: 72, fontWeight: 800,
        color: '#fff', letterSpacing: '-0.03em',
        textAlign: 'center',
      }}>
        Signed off, <span style={{ color: '#A5B4FC' }}>first try.</span>
      </div>

      <div style={{
        position: 'absolute', bottom: 64,
        display: 'flex', alignItems: 'center', gap: 14,
        opacity: wordT,
        transform: `translateY(${(1 - wordT) * 10}px)`,
      }}>
        <MLogo size={36} />
        <span style={{ fontFamily: MF, fontSize: 24, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>InkTracker</span>
      </div>
    </div>
  );
}

function SceneCaption({ step, text, opacity = 1 }) {
  return (
    <div style={{
      position: 'absolute',
      left: 280, bottom: 64,
      opacity,
      transform: `translateY(${(1 - opacity) * 8}px)`,
      pointerEvents: 'none',
    }}>
      <div style={{
        fontFamily: MF, fontSize: 12, color: MK.accent, fontWeight: 800,
        textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 8,
      }}>{step}</div>
      <div style={{ fontFamily: MF, fontSize: 30, fontWeight: 700, color: MK.text1, letterSpacing: '-0.02em' }}>
        {text}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
function MockupDemo() {
  return (
    <>
      <Sprite start={0}     end={3.0}>   <MSceneHook /></Sprite>
      <Sprite start={3.0}   end={24.5}>  <MSceneMid /></Sprite>
      <Sprite start={24.5}  end={28.0}>  <MSceneOutro /></Sprite>
    </>
  );
}

window.MockupDemo = MockupDemo;
