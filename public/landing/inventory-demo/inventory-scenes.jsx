// inventory-scenes.jsx — InkTracker Inventory & Restock demo (~22s)
// Same visual system as the other demos. Demo SKUs and stock levels only.

const IN = {
  darkBg: '#0B0B0E',
  darkText1: '#F4F4F5',
  darkText2: 'rgba(244,244,245,0.62)',
  darkText3: 'rgba(244,244,245,0.40)',
  appBg: '#F5F5F8',
  surface: '#FFFFFF',
  surface2: '#FAFAFC',
  border: '#E5E7EB',
  borderStrong: '#CBD5E1',
  text1: '#0F172A',
  text2: '#475569',
  text3: '#94A3B8',
  text4: '#CBD5E1',
  accent: '#4F46E5',
  accentSoft: '#EEF2FF',
  accentBorder: '#C7D2FE',
  green: '#16A34A',
  greenSoft: '#DCFCE7',
  greenBorder: '#86EFAC',
  amber: '#D97706',
  amberSoft: '#FEF3C7',
  amberBorder: '#FCD34D',
  rose: '#E11D48',
  roseSoft: '#FFE4E6',
  roseBorder: '#FBCFE8',
  slate: '#64748B',
  slateSoft: '#F1F5F9',
  shopifyGreen: '#5E8E3E',
  shopifyGreenSoft: '#EBF5DD',
};
const INF = '"Inter", system-ui, -apple-system, sans-serif';
const INM = '"JetBrains Mono", ui-monospace, monospace';

function inclamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function ineaseOut(t) { return 1 - Math.pow(1 - t, 3); }

function INLogo({ size = 32 }) {
  return <img src="assets/inktracker-logo.png" alt="" style={{ width: size, height: size, display: 'block', objectFit: 'contain', flexShrink: 0 }} />;
}

// ─── Demo inventory — mixed categories the shop keeps in stock ─────────────
// status: ok / low / out  — drives badge color + bar fill.
// swatch: hex color for blanks/inks; null = render an icon (kind from `icon`).
const DEMO_INVENTORY = [
  // ── Blanks ──
  { category: 'Blanks',   swatch: '#F4F4F5', sku: 'BELLA-3001', name: 'Bella+Canvas 3001 Unisex Tee',  variant: 'White · L',              stock: 14, par: 36, vendor: 'S&S',       unit: '$3.18',  status: 'low' },
  { category: 'Blanks',   swatch: '#374151', sku: 'CHAMP-S700', name: 'Champion S700 Pullover Hoodie', variant: 'Athletic Gray · L',      stock: 38, par: 18, vendor: 'S&S',       unit: '$11.42', status: 'ok'  },
  { category: 'Blanks',   swatch: '#0F172A', sku: 'ASC-5050',   name: 'AS Colour 5050 Heavy Hood',     variant: 'Black · M',              stock: 0,  par: 18, vendor: 'AS Colour', unit: '$22.50', status: 'out' },
  // ── Inks ──
  { category: 'Inks',     swatch: '#FFFFFF', sku: 'INK-PL-WHT', name: 'Plastisol — Bright White',      variant: 'Wilflex Genesis · gallon',    stock: 3, par: 4, vendor: 'Ryonet', unit: '$48.00', status: 'ok'  },
  { category: 'Inks',     swatch: '#0F172A', sku: 'INK-PL-BLK', name: 'Plastisol — Soft Hand Black',   variant: 'Wilflex Equinox · gallon',    stock: 1, par: 4, vendor: 'Ryonet', unit: '$52.00', status: 'low' },
  // ── Supplies ──
  { category: 'Supplies', swatch: null, icon: 'screen', sku: 'SCRN-156', name: 'Screen — 156 mesh aluminum',    variant: '23 × 31 · pre-stretched', stock: 18, par: 12, vendor: 'Ryonet', unit: '$24.00', status: 'ok'  },
  { category: 'Supplies', swatch: null, icon: 'jar',    sku: 'EMUL-DPX', name: 'Emulsion — photopolymer',       variant: 'DirectPro X · quart',     stock: 0,  par: 2,  vendor: 'Saati',  unit: '$36.00', status: 'out' },
];

// Per-category totals shown in the filter strip
const CATEGORIES = [
  { key: 'All',      count: 124 },
  { key: 'Blanks',   count: 89  },
  { key: 'Inks',     count: 14  },
  { key: 'Supplies', count: 21  },
];

const IN_NAV = [
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

function INNavIcon({ kind, color }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
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
    case 'code':    return <svg {...p}><path d="M8 6l-6 6 6 6M16 6l6 6-6 6M14 4l-4 16"/></svg>;
    case 'gear':    return <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
    default:        return null;
  }
}

function INSidebar() {
  return (
    <div style={{
      position: 'absolute', left: 0, top: 0, bottom: 0, width: 232,
      borderRight: `1px solid ${IN.border}`, background: IN.surface,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 20px 18px' }}>
        <INLogo size={36} />
        <div>
          <div style={{ fontFamily: INF, fontSize: 16, fontWeight: 800, color: IN.text1, letterSpacing: '-0.015em' }}>Northwind Print</div>
          <div style={{ fontFamily: INF, fontSize: 11.5, color: IN.text3, marginTop: 1 }}>Shop Manager</div>
        </div>
      </div>
      <div style={{ padding: '0 10px', flex: 1 }}>
        {IN_NAV.map((it) => {
          const a = it.label === 'Inventory';
          return (
            <div key={it.label} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '11px 14px', borderRadius: 8, marginBottom: 2,
              background: a ? IN.accent : 'transparent',
            }}>
              <INNavIcon kind={it.icon} color={a ? '#fff' : IN.text3} />
              <div style={{ fontFamily: INF, fontSize: 14, fontWeight: a ? 700 : 500, color: a ? '#fff' : IN.text2 }}>{it.label}</div>
            </div>
          );
        })}
      </div>
      <div style={{ padding: '14px 16px', borderTop: `1px solid ${IN.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 34, background: IN.surface2, border: `1px solid ${IN.border}`, borderRadius: 8, display: 'flex', alignItems: 'center', padding: '0 10px', gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={IN.text3} strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
          <span style={{ fontFamily: INF, fontSize: 12, color: IN.text3 }}>Search…</span>
        </div>
      </div>
    </div>
  );
}

function INApp({ children, opacity = 1 }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: IN.appBg, opacity }}>
      <INSidebar />
      <div style={{ position: 'absolute', left: 232, right: 0, top: 0, bottom: 0, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

// ─── Stock badge ───────────────────────────────────────────────────────────
function StockBadge({ status }) {
  const map = {
    ok:  { label: 'In stock',  bg: IN.greenSoft, fg: IN.green, br: IN.greenBorder },
    low: { label: 'Low',       bg: IN.amberSoft, fg: IN.amber, br: IN.amberBorder },
    out: { label: 'Out',       bg: IN.roseSoft,  fg: IN.rose,  br: IN.roseBorder  },
  };
  const s = map[status] || map.ok;
  return (
    <div style={{
      padding: '3px 9px', background: s.bg, color: s.fg,
      border: `1px solid ${s.br}`,
      borderRadius: 999, fontFamily: INF, fontSize: 11, fontWeight: 700, letterSpacing: '0.02em',
      whiteSpace: 'nowrap',
    }}>{s.label}</div>
  );
}

// ─── Stock bar (filled fraction = stock/par, color by status) ──────────────
function StockBar({ stock, par, status, animProgress = 1 }) {
  const frac = inclamp((stock / par) * animProgress, 0, 1);
  const color = status === 'ok' ? IN.green : status === 'low' ? IN.amber : IN.rose;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{
        position: 'relative',
        width: 140, height: 8,
        background: IN.slateSoft,
        borderRadius: 999, overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          width: `${frac * 100}%`,
          background: color,
          borderRadius: 999,
          transition: 'width 0.4s',
        }} />
      </div>
      <div style={{ fontFamily: INM, fontSize: 12.5, color: IN.text2, fontWeight: 600, minWidth: 60 }}>
        {Math.round(stock)} / {par}
      </div>
    </div>
  );
}

// ─── Swatch (color square for blanks/inks, icon tile for supplies) ────────
function InvSwatch({ item }) {
  if (item.swatch != null) {
    return (
      <div style={{
        width: 28, height: 28, borderRadius: 8,
        background: item.swatch, border: `1px solid ${IN.border}`,
      }} />
    );
  }
  const stroke = '#475569';
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke, strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
  let icon;
  switch (item.icon) {
    case 'screen': icon = <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 8h18M3 13h18M8 3v18M13 3v18M18 3v18"/></svg>; break;
    case 'jar':    icon = <svg {...p}><path d="M7 3h10M8 3l-1 4h10l-1-4M6 7h12v12a2 2 0 01-2 2H8a2 2 0 01-2-2z"/></svg>; break;
    default:       icon = <svg {...p}><circle cx="12" cy="12" r="9"/></svg>;
  }
  return (
    <div style={{
      width: 28, height: 28, borderRadius: 8,
      background: IN.surface2, border: `1px solid ${IN.border}`,
      display: 'grid', placeItems: 'center',
    }}>{icon}</div>
  );
}

// ─── Inventory row ─────────────────────────────────────────────────────────
function InvRow({ item, animProgress = 1, dim, flashEmerald, ghost }) {
  return (
    <div style={{
      background: flashEmerald ? IN.greenSoft : IN.surface,
      border: `1px solid ${IN.border}`,
      borderRadius: 12, padding: '14px 18px',
      boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
      opacity: dim ? 0.42 : 1,
      transition: 'background 0.4s',
      display: 'grid',
      gridTemplateColumns: '36px 1fr 100px 110px 80px 220px 88px 100px',
      alignItems: 'center', gap: 16,
    }}>
      <InvSwatch item={item} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: INF, fontSize: 14, fontWeight: 700, color: IN.text1, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
        <div style={{ fontFamily: INM, fontSize: 11.5, color: IN.text3, marginTop: 2 }}>{item.sku} · {item.variant}</div>
      </div>
      <CategoryChip category={item.category} />
      <VendorChip vendor={item.vendor} />
      <div style={{ fontFamily: INF, fontSize: 13, color: IN.text2, fontWeight: 600 }}>{item.unit}</div>
      <StockBar stock={item.stock} par={item.par} status={item.status} animProgress={animProgress} />
      <div><StockBadge status={item.status} /></div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        {ghost ? null : (
          <button style={{
            padding: '6px 12px',
            background: item.status === 'out' ? IN.accent : '#fff',
            color: item.status === 'out' ? '#fff' : IN.text2,
            border: item.status === 'out' ? 'none' : `1px solid ${IN.border}`,
            borderRadius: 8, fontFamily: INF, fontSize: 12.5, fontWeight: 700,
            boxShadow: item.status === 'out' ? '0 4px 10px rgba(79,70,229,0.28)' : 'none',
          }}>
            Restock
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Category chip on each row ─────────────────────────────────────────────
function CategoryChip({ category }) {
  const styles = {
    Blanks:   { bg: '#F1F5F9', fg: '#334155', br: '#CBD5E1' },
    Inks:     { bg: '#FDF2F8', fg: '#9D174D', br: '#FBCFE8' },
    Supplies: { bg: '#FFFBEB', fg: '#92400E', br: '#FDE68A' },
  };
  const s = styles[category] || styles.Blanks;
  return (
    <div style={{
      padding: '3px 9px', background: s.bg, color: s.fg,
      border: `1px solid ${s.br}`,
      borderRadius: 6, fontFamily: INF, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
      textTransform: 'uppercase', textAlign: 'center', width: 'fit-content',
    }}>{category}</div>
  );
}

function VendorChip({ vendor }) {
  const styles = {
    'S&S':       { bg: '#EFF6FF', fg: '#1D4ED8', br: '#BFDBFE' },
    'AS Colour': { bg: '#FEF3C7', fg: '#92400E', br: '#FDE68A' },
    'Ryonet':    { bg: '#FCE7F3', fg: '#9D174D', br: '#FBCFE8' },
    'Saati':     { bg: '#ECFDF5', fg: '#065F46', br: '#A7F3D0' },
  };
  const s = styles[vendor] || styles['S&S'];
  return (
    <div style={{
      padding: '3px 9px', background: s.bg, color: s.fg,
      border: `1px solid ${s.br}`,
      borderRadius: 6, fontFamily: INF, fontSize: 11, fontWeight: 700, letterSpacing: '0.01em', whiteSpace: 'nowrap',
    }}>{vendor}</div>
  );
}

// ─── Caption ───────────────────────────────────────────────────────────────
function INCaption({ text, time, duration, delay = 0.3, fade = 0.4 }) {
  const local = time - delay;
  const tIn = inclamp(local / fade, 0, 1);
  const tOut = inclamp((duration - delay - local) / fade, 0, 1);
  const op = ineaseOut(Math.min(tIn, tOut));
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 36, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{
        opacity: op,
        background: 'rgba(11,11,14,0.92)', color: '#F4F4F5',
        fontFamily: INF, fontSize: 17, fontWeight: 500, letterSpacing: '-0.005em',
        padding: '12px 22px', borderRadius: 999,
        boxShadow: '0 12px 32px rgba(0,0,0,0.25)', whiteSpace: 'nowrap',
      }}>{text}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 1 — HOOK (0–3s)
// ═══════════════════════════════════════════════════════════════════════════
function SceneINHook() {
  const { localTime } = useSprite();
  const t = localTime;
  const logoT = inclamp(t / 0.6, 0, 1);
  const h1T = inclamp((t - 0.5) / 0.5, 0, 1);
  const h2T = inclamp((t - 0.95) / 0.5, 0, 1);
  const subT = inclamp((t - 1.6) / 0.5, 0, 1);
  return (
    <div style={{ position: 'absolute', inset: 0, background: IN.darkBg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ opacity: logoT, transform: `translateY(${(1-logoT)*8}px)`, display: 'flex', alignItems: 'center', gap: 14, marginBottom: 38 }}>
        <INLogo size={40} />
        <div style={{ fontFamily: INF, fontSize: 22, fontWeight: 700, color: IN.darkText1, letterSpacing: '-0.015em' }}>InkTracker</div>
      </div>
      <div style={{ opacity: h1T, transform: `translateY(${(1-h1T)*10}px)`, fontFamily: INF, fontSize: 96, fontWeight: 800, color: IN.darkText1, letterSpacing: '-0.045em', lineHeight: 1, textAlign: 'center' }}>Never run out.</div>
      <div style={{ opacity: h2T, transform: `translateY(${(1-h2T)*10}px)`, fontFamily: INF, fontSize: 96, fontWeight: 800, color: '#FCD34D', letterSpacing: '-0.045em', lineHeight: 1.02, textAlign: 'center', marginTop: 10 }}>Restock in seconds.</div>
      <div style={{ opacity: subT, transform: `translateY(${(1-subT)*8}px)`, fontFamily: INF, fontSize: 20, color: IN.darkText2, marginTop: 36, textAlign: 'center' }}>Blanks, inks, supplies — live pricing and Shopify sync built in.</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 2 — INVENTORY GRID (3–9s)
// ═══════════════════════════════════════════════════════════════════════════
function SceneINGrid() {
  const { localTime, duration } = useSprite();
  const t = localTime;
  const pageT = inclamp(t / 0.4, 0, 1);
  const headerT = inclamp((t - 0.2) / 0.4, 0, 1);
  const statsT = inclamp((t - 0.4) / 0.45, 0, 1);

  return (
    <INApp opacity={pageT}>
      <div style={{ padding: '36px 56px 0', opacity: headerT }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontFamily: INF, fontSize: 38, fontWeight: 800, color: IN.text1, letterSpacing: '-0.03em' }}>Inventory</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: IN.shopifyGreenSoft, border: `1px solid #D7E8C0`, borderRadius: 999 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill={IN.shopifyGreen}><path d="M19.4 8.4c-.4-.2-3-1.4-3-1.4S14.6 5 14.4 5c-.2-.1-.6-.1-1 0L11 7c-.2.1-.7.2-1 .4-.3.2-3.4 1-3.6 1-.2 0-.5.2-.6.4-.1.2-1.4 11.4-1.4 11.4l9.5 1.8 6.4-1.4-1.3-11.2z"/></svg>
              <div style={{ fontFamily: INF, fontSize: 12.5, color: IN.shopifyGreen, fontWeight: 700, letterSpacing: '0.01em' }}>Shopify · synced 3m ago</div>
            </div>
            <button style={{ padding: '10px 18px', background: IN.accent, color: '#fff', border: 'none', borderRadius: 8, fontFamily: INF, fontSize: 14, fontWeight: 700, boxShadow: '0 6px 16px rgba(79,70,229,0.32)' }}>+ Add Item</button>
          </div>
        </div>
      </div>

      <div style={{ padding: '24px 56px 0', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, opacity: statsT }}>
        <StatCard label="Total SKUs"        value="124"        trend="blanks · inks · supplies" color={IN.text1} />
        <StatCard label="Low stock"         value="8"          trend="need restock"             color={IN.amber} alert />
        <StatCard label="Out of stock"      value="2"          trend="ship date risk"           color={IN.rose}  alert />
        <StatCard label="Restock on order"  value="$842.00"    trend="3 POs"                    color={IN.accent} />
      </div>

      <div style={{ padding: '20px 56px 0', display: 'flex', alignItems: 'center', gap: 10, opacity: statsT }}>
        {CATEGORIES.map((c) => {
          const active = c.key === 'All';
          return (
            <div key={c.key} style={{
              padding: '7px 14px',
              background: active ? IN.text1 : '#fff',
              color: active ? '#fff' : IN.text2,
              border: `1px solid ${active ? IN.text1 : IN.border}`,
              borderRadius: 999,
              fontFamily: INF, fontSize: 13, fontWeight: 700, letterSpacing: '-0.005em',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              {c.key}
              <span style={{ fontFamily: INM, fontSize: 11, fontWeight: 600, color: active ? 'rgba(255,255,255,0.7)' : IN.text3 }}>{c.count}</span>
            </div>
          );
        })}
      </div>

      <div style={{ padding: '16px 56px 6px', display: 'grid', gridTemplateColumns: '36px 1fr 100px 110px 80px 220px 88px 100px', gap: 16, alignItems: 'center' }}>
        <div />
        <div style={{ fontFamily: INF, fontSize: 11.5, fontWeight: 700, color: IN.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Item</div>
        <div style={{ fontFamily: INF, fontSize: 11.5, fontWeight: 700, color: IN.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Category</div>
        <div style={{ fontFamily: INF, fontSize: 11.5, fontWeight: 700, color: IN.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Vendor</div>
        <div style={{ fontFamily: INF, fontSize: 11.5, fontWeight: 700, color: IN.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Unit</div>
        <div style={{ fontFamily: INF, fontSize: 11.5, fontWeight: 700, color: IN.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Stock vs par</div>
        <div style={{ fontFamily: INF, fontSize: 11.5, fontWeight: 700, color: IN.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Status</div>
        <div />
      </div>

      <div style={{ padding: '0 56px 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {DEMO_INVENTORY.map((item, i) => {
          const start = 0.85 + i * 0.08;
          const rowT = inclamp((t - start) / 0.35, 0, 1);
          const rowE = ineaseOut(rowT);
          // Bars fill last, after the row has slid in
          const barStart = start + 0.25;
          const barT = inclamp((t - barStart) / 0.55, 0, 1);
          const barE = ineaseOut(barT);
          return (
            <div key={i} style={{ opacity: rowE, transform: `translateY(${(1-rowE)*12}px)` }}>
              <InvRow item={item} animProgress={barE} />
            </div>
          );
        })}
      </div>

      <INCaption text="Blanks, inks, supplies — every SKU you stock, in one view." time={localTime} duration={duration} delay={0.7} />
    </INApp>
  );
}

function StatCard({ label, value, trend, color, alert }) {
  return (
    <div style={{
      background: IN.surface,
      border: `1px solid ${alert ? (color === IN.rose ? IN.roseBorder : IN.amberBorder) : IN.border}`,
      borderRadius: 12, padding: '16px 20px',
      boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ fontFamily: INF, fontSize: 11.5, fontWeight: 700, color: IN.text3, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontFamily: INF, fontSize: 28, fontWeight: 800, color, letterSpacing: '-0.025em' }}>{value}</div>
      <div style={{ fontFamily: INF, fontSize: 12, color: IN.text3, fontWeight: 500 }}>{trend}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 3 — RESTOCK MODAL (9–15s)
// ═══════════════════════════════════════════════════════════════════════════
// Restock the out-of-stock AS Colour 5050 hoodie (Black).
// Animate: modal in (0–0.5s), size qty fields fill (0.7–2.2s),
// running total counts up (1.2–2.6s), Place Order button (3.4s+).
function SceneINRestock() {
  const { localTime, duration } = useSprite();
  const t = localTime;
  const modalT = inclamp(t / 0.5, 0, 1);
  const modalE = ineaseOut(modalT);

  // Size qty progression (S=6, M=12, L=12, XL=6, 2XL=4)
  const sizes = [
    { label: 'S',   qty: 6,  start: 0.7 },
    { label: 'M',   qty: 12, start: 1.0 },
    { label: 'L',   qty: 12, start: 1.3 },
    { label: 'XL',  qty: 6,  start: 1.6 },
    { label: '2XL', qty: 4,  start: 1.9 },
  ];

  const totalQty = sizes.reduce((acc, s) => {
    const k = inclamp((t - s.start) / 0.25, 0, 1);
    return acc + s.qty * k;
  }, 0);
  const subtotal = totalQty * 22.50; // unit price from inventory data
  const shipping = totalQty > 0 ? 14.00 : 0;
  const total = subtotal + shipping;

  const placeAt = 3.4;
  const placing = t >= placeAt && t < placeAt + 0.7;
  const placed = t >= placeAt + 0.7;
  const placedT = inclamp((t - placeAt - 0.7) / 0.4, 0, 1);

  return (
    <INApp opacity={1}>
      <div style={{ padding: '36px 56px 0', opacity: 0.35 }}>
        <div style={{ fontFamily: INF, fontSize: 38, fontWeight: 800, color: IN.text1, letterSpacing: '-0.03em' }}>Inventory</div>
      </div>

      <div style={{ position: 'absolute', inset: 0, background: `rgba(15,23,42,${0.42 * modalE})`, pointerEvents: 'none' }} />

      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: `translate(-50%, calc(-50% + ${(1 - modalE) * 24}px))`,
        opacity: modalE,
        width: 940,
        background: IN.surface, border: `1px solid ${IN.border}`,
        borderRadius: 18, boxShadow: '0 32px 96px rgba(15,23,42,0.32)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Modal header */}
        <div style={{ padding: '22px 32px', borderBottom: `1px solid ${IN.border}`, display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 46, height: 46, borderRadius: 10, background: '#0F172A' }} />
          <div>
            <div style={{ fontFamily: INF, fontSize: 20, fontWeight: 800, color: IN.text1, letterSpacing: '-0.02em' }}>AS Colour 5050 — Black</div>
            <div style={{ fontFamily: INM, fontSize: 12, color: IN.text3, marginTop: 2 }}>ASC-5050 · Heavy Hood · live price from AS Colour API</div>
          </div>
          <div style={{ marginLeft: 'auto' }}><VendorChip vendor="AS Colour" /></div>
        </div>

        {/* Size matrix */}
        <div style={{ padding: '24px 32px 8px' }}>
          <div style={{ fontFamily: INF, fontSize: 12, fontWeight: 700, color: IN.text3, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>Order quantities</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
            {sizes.map((s) => {
              const k = inclamp((t - s.start) / 0.25, 0, 1);
              const active = k > 0;
              return (
                <div key={s.label} style={{
                  background: active ? IN.accentSoft : IN.surface2,
                  border: `1px solid ${active ? IN.accentBorder : IN.border}`,
                  borderRadius: 10, padding: '12px 14px',
                  display: 'flex', flexDirection: 'column', gap: 6,
                  transition: 'background 0.25s, border-color 0.25s',
                }}>
                  <div style={{ fontFamily: INF, fontSize: 12, color: IN.text3, fontWeight: 700, letterSpacing: '0.04em' }}>{s.label}</div>
                  <div style={{ fontFamily: INF, fontSize: 26, fontWeight: 800, color: active ? IN.accent : IN.text4, letterSpacing: '-0.02em' }}>
                    {Math.round(s.qty * k)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live pricing */}
        <div style={{ padding: '14px 32px 4px', display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Row label={`${Math.round(totalQty)} units × $22.50`} value={fmt(subtotal)} />
            <Row label="Ground shipping (S&S consolidation)" value={fmt(shipping)} />
            <div style={{ display: 'flex', alignItems: 'center', borderTop: `1px solid ${IN.border}`, paddingTop: 10, marginTop: 4 }}>
              <div style={{ fontFamily: INF, fontSize: 14, color: IN.text1, fontWeight: 700, letterSpacing: '0.02em' }}>Total</div>
              <div style={{ marginLeft: 'auto', fontFamily: INF, fontSize: 24, color: IN.accent, fontWeight: 800, letterSpacing: '-0.02em' }}>{fmt(total)}</div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '18px 32px 22px', background: IN.surface2, borderTop: `1px solid ${IN.border}`, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ fontFamily: INF, fontSize: 12.5, color: IN.text3 }}>Estimated delivery <span style={{ color: IN.text1, fontWeight: 700 }}>2–3 business days</span></div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {placed && (
              <div style={{ opacity: placedT, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: IN.greenSoft, color: IN.green, border: `1px solid ${IN.greenBorder}`, borderRadius: 8, fontFamily: INF, fontSize: 13, fontWeight: 700 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={IN.green} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11"/></svg>
                PO #AS-2026-0182
              </div>
            )}
            <button style={{
              padding: '11px 22px',
              background: placed ? IN.greenSoft : IN.accent,
              color: placed ? IN.green : '#fff',
              border: placed ? `1px solid ${IN.greenBorder}` : 'none',
              borderRadius: 9,
              fontFamily: INF, fontSize: 14.5, fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: 10,
              boxShadow: placed ? 'none' : '0 6px 16px rgba(79,70,229,0.32)',
              transition: 'all 0.25s',
            }}>
              {placing && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" style={{ transform: `rotate(${t * 720}deg)` }}><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
              )}
              {placed ? 'Order placed ✓' : (placing ? 'Placing…' : 'Place AS Colour order')}
            </button>
          </div>
        </div>
      </div>

      <INCaption text="Live pricing. Vendor APIs. One-click PO." time={localTime} duration={duration} delay={0.6} />
    </INApp>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{ fontFamily: INF, fontSize: 13, color: IN.text3, fontWeight: 500 }}>{label}</div>
      <div style={{ marginLeft: 'auto', fontFamily: INF, fontSize: 14, color: IN.text2, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function fmt(n) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 4 — STOCK UPDATED (15–20s)
// ═══════════════════════════════════════════════════════════════════════════
// Show the inventory list again — the AS Colour 5050 row is now "On order"
// with a fresh badge, count animates from 0 to 40, status flips out→ok.
function SceneINUpdated() {
  const { localTime, duration } = useSprite();
  const t = localTime;
  const pageT = inclamp(t / 0.3, 0, 1);

  // Stock count tick on the AS Colour row 0 → 40 between 0.6–1.8s
  const tickT = inclamp((t - 0.6) / 1.2, 0, 1);
  const tickE = ineaseOut(tickT);
  const newStock = 40 * tickE;
  const flipped = tickE >= 1;
  const flashing = flipped && t < 3.5;

  const toastT = inclamp((t - 0.3) / 0.4, 0, 1);

  const invs = DEMO_INVENTORY.map((item) => {
    if (item.sku === 'ASC-5050') {
      return { ...item, stock: newStock, status: flipped ? 'ok' : 'out' };
    }
    return item;
  });

  return (
    <INApp opacity={pageT}>
      <div style={{ padding: '36px 56px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontFamily: INF, fontSize: 38, fontWeight: 800, color: IN.text1, letterSpacing: '-0.03em' }}>Inventory</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: IN.shopifyGreenSoft, border: `1px solid #D7E8C0`, borderRadius: 999 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill={IN.shopifyGreen}><path d="M19.4 8.4c-.4-.2-3-1.4-3-1.4S14.6 5 14.4 5c-.2-.1-.6-.1-1 0L11 7c-.2.1-.7.2-1 .4-.3.2-3.4 1-3.6 1-.2 0-.5.2-.6.4-.1.2-1.4 11.4-1.4 11.4l9.5 1.8 6.4-1.4-1.3-11.2z"/></svg>
              <div style={{ fontFamily: INF, fontSize: 12.5, color: IN.shopifyGreen, fontWeight: 700, letterSpacing: '0.01em' }}>Shopify · synced just now</div>
            </div>
            <button style={{ padding: '10px 18px', background: IN.accent, color: '#fff', border: 'none', borderRadius: 8, fontFamily: INF, fontSize: 14, fontWeight: 700, boxShadow: '0 6px 16px rgba(79,70,229,0.32)' }}>+ Add Item</button>
          </div>
        </div>
      </div>

      <div style={{ padding: '24px 56px 0', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <StatCard label="Total SKUs"        value="124"      trend="blanks · inks · supplies" color={IN.text1} />
        <StatCard label="Low stock"         value="8"        trend="need restock"             color={IN.amber} alert />
        <StatCard label="Out of stock"      value={flipped ? '1' : '2'} trend="ship date risk" color={IN.rose} alert />
        <StatCard label="Restock on order"  value="$1,732.00" trend="4 POs"                   color={IN.accent} />
      </div>

      <div style={{ padding: '20px 56px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
        {CATEGORIES.map((c) => {
          const active = c.key === 'All';
          return (
            <div key={c.key} style={{
              padding: '7px 14px',
              background: active ? IN.text1 : '#fff',
              color: active ? '#fff' : IN.text2,
              border: `1px solid ${active ? IN.text1 : IN.border}`,
              borderRadius: 999,
              fontFamily: INF, fontSize: 13, fontWeight: 700, letterSpacing: '-0.005em',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              {c.key}
              <span style={{ fontFamily: INM, fontSize: 11, fontWeight: 600, color: active ? 'rgba(255,255,255,0.7)' : IN.text3 }}>{c.count}</span>
            </div>
          );
        })}
      </div>

      <div style={{ padding: '16px 56px 6px', display: 'grid', gridTemplateColumns: '36px 1fr 100px 110px 80px 220px 88px 100px', gap: 16, alignItems: 'center' }}>
        <div />
        <div style={{ fontFamily: INF, fontSize: 11.5, fontWeight: 700, color: IN.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Item</div>
        <div style={{ fontFamily: INF, fontSize: 11.5, fontWeight: 700, color: IN.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Category</div>
        <div style={{ fontFamily: INF, fontSize: 11.5, fontWeight: 700, color: IN.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Vendor</div>
        <div style={{ fontFamily: INF, fontSize: 11.5, fontWeight: 700, color: IN.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Unit</div>
        <div style={{ fontFamily: INF, fontSize: 11.5, fontWeight: 700, color: IN.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Stock vs par</div>
        <div style={{ fontFamily: INF, fontSize: 11.5, fontWeight: 700, color: IN.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Status</div>
        <div />
      </div>

      <div style={{ padding: '0 56px 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {invs.map((item, i) => {
          const isTarget = item.sku === 'ASC-5050';
          return (
            <InvRow key={i} item={item} flashEmerald={isTarget && flashing} />
          );
        })}
      </div>

      {/* Restock confirmation toast */}
      <div style={{
        position: 'absolute', top: 32, right: 56,
        transform: `translateX(${(1 - ineaseOut(toastT)) * 40}px)`,
        opacity: toastT,
        background: IN.surface,
        border: `1px solid ${IN.greenBorder}`,
        borderRadius: 12,
        padding: '14px 18px',
        display: 'flex', alignItems: 'center', gap: 14,
        boxShadow: '0 18px 48px rgba(22,163,74,0.18)',
        minWidth: 360,
      }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: IN.greenSoft, display: 'grid', placeItems: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={IN.green} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11"/></svg>
        </div>
        <div>
          <div style={{ fontFamily: INF, fontSize: 14, fontWeight: 800, color: IN.text1, letterSpacing: '-0.005em' }}>AS Colour PO confirmed · 40 units</div>
          <div style={{ fontFamily: INF, fontSize: 12.5, color: IN.text3, marginTop: 2 }}>5050 Heavy Hood (Black) · arriving Tue · $1,028.00</div>
        </div>
      </div>

      <INCaption text="Stock updates everywhere it matters — instantly." time={localTime} duration={duration} delay={2.0} />
    </INApp>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 5 — LOCKUP (20–22s)
// ═══════════════════════════════════════════════════════════════════════════
function SceneINLockup() {
  const { localTime } = useSprite();
  const t = localTime;
  const logoT = inclamp(t / 0.6, 0, 1);
  const textT = inclamp((t - 0.4) / 0.6, 0, 1);
  return (
    <div style={{ position: 'absolute', inset: 0, background: IN.darkBg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ opacity: logoT, transform: `translateY(${(1-logoT)*8}px)`, display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <INLogo size={56} />
        <div style={{ fontFamily: INF, fontSize: 36, fontWeight: 800, color: IN.darkText1, letterSpacing: '-0.025em' }}>InkTracker</div>
      </div>
      <div style={{ opacity: textT, transform: `translateY(${(1-textT)*8}px)`, fontFamily: INF, fontSize: 26, color: IN.darkText2, marginTop: 8, textAlign: 'center', letterSpacing: '-0.01em' }}>Inventory you can trust.</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
function InventoryDemo() {
  return (
    <>
      <Sprite start={0}  end={3}>   <SceneINHook />     </Sprite>
      <Sprite start={3}  end={9}>   <SceneINGrid />     </Sprite>
      <Sprite start={9}  end={15}>  <SceneINRestock />  </Sprite>
      <Sprite start={15} end={20}>  <SceneINUpdated />  </Sprite>
      <Sprite start={20} end={22}>  <SceneINLockup />   </Sprite>
    </>
  );
}
