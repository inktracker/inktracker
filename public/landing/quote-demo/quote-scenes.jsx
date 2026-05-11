// quote-scenes.jsx — InkTracker "Writing a Quote" demo (≈22s)
// Recreates the actual Quote Builder flow from screenshots.

const Q = {
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
  accentSofter: '#F5F3FF',
  accentBorder: '#C7D2FE',
  green: '#16A34A',
  greenSoft: '#DCFCE7',
  greenBorder: '#86EFAC',
  yellow: '#FEF3C7',
  yellowText: '#92400E',
  yellowBorder: '#FCD34D',
  amber: '#F59E0B',
  navy: '#0F172A',
};
const F = '"Inter", system-ui, -apple-system, sans-serif';
const M = '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace';

// ─── Logo ───────────────────────────────────────────────────────────────────
function Logo({ size = 32 }) {
  return (
    <img src="assets/inktracker-logo.png" alt="InkTracker"
      style={{ width: size, height: size, display: 'block', objectFit: 'contain', flexShrink: 0 }} />
  );
}

// ─── Sidebar (with Quotes active) ───────────────────────────────────────────
const NAV = [
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

function NavIcon({ kind, color }) {
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

function Sidebar({ active = 'Quotes' }) {
  return (
    <div style={{
      position: 'absolute', left: 0, top: 0, bottom: 0,
      width: 232,
      borderRight: `1px solid ${Q.border}`,
      background: Q.surface,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Brand */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '20px 20px 18px',
      }}>
        <Logo size={36} />
        <div>
          <div style={{ fontFamily: F, fontSize: 16, fontWeight: 800, color: Q.text1, letterSpacing: '-0.015em' }}>Biota Mfg</div>
          <div style={{ fontFamily: F, fontSize: 11.5, color: Q.text3, letterSpacing: '0.01em', marginTop: 1 }}>Shop Manager</div>
        </div>
      </div>

      <div style={{ padding: '0 10px', flex: 1, overflow: 'hidden' }}>
        {NAV.map((it) => {
          const a = it.label === active;
          return (
            <div key={it.label} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '9px 12px', margin: '2px 0',
              borderRadius: 8,
              background: a ? Q.accent : 'transparent',
              color: a ? '#fff' : Q.text2,
              fontFamily: F, fontSize: 14, fontWeight: a ? 600 : 500,
            }}>
              <NavIcon kind={it.icon} color={a ? '#fff' : Q.text3} />
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
          fontFamily: F, fontSize: 14, fontWeight: 700,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z"/></svg>
          Admin
        </div>
      </div>

      <div style={{ padding: 14, borderTop: `1px solid ${Q.border}` }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 12px',
          background: Q.surface,
          border: `1px solid ${Q.border}`,
          borderRadius: 10,
          fontFamily: F, fontSize: 13.5, color: Q.text3,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={Q.text3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          Search...
        </div>
      </div>
      <div style={{ padding: '0 18px 12px', fontFamily: M, fontSize: 10, color: Q.text4, letterSpacing: '0.06em' }}>v1.0</div>
    </div>
  );
}

// ─── Quotes list (background screen) ────────────────────────────────────────
const FILTERS_A = ['All', 'Draft', 'Sent', 'Pending', 'Approved', 'Approved and Paid', 'Declined'];
const FILTERS_B = ['All', 'Internal', 'Broker', 'Wizard'];

const EXISTING_QUOTES = [
  { id: 'Q-2026-58LL', cust: 'Harbor Print Co.',         date: '05/09/2026', inh: '05/22/2026', qty: '50 pcs',  total: '$815.24',   tier: '50+', status: 'Draft',    sDark: false },
  { id: 'Q-2026-IDS2', cust: 'Northwind Bakery',         date: '05/09/2026', inh: '05/23/2026', qty: '35 pcs',  total: '$594.54',   tier: '25+', status: 'Approved', sDark: false },
  { id: 'Q-2026-S8FD', cust: 'Maple & Pine Outfitters',  date: '04/16/2026', inh: '04/30/2026', qty: '96 pcs',  total: '$1,950.00', tier: '50+', status: 'Approved', sDark: false },
  { id: 'Q-2026-K4PA', cust: 'Tinsel Goods',             date: '04/14/2026', inh: '04/28/2026', qty: '24 pcs',  total: '$432.18',   tier: '12+', status: 'Sent',     sDark: false },
  { id: 'Q-2026-9VRT', cust: 'Cedar Creek Coffee',       date: '04/12/2026', inh: '04/24/2026', qty: '120 pcs', total: '$2,184.00', tier: '100+',status: 'Approved', sDark: false },
  { id: 'Q-2026-M2XK', cust: 'Iron Anvil Brewing',       date: '04/10/2026', inh: '04/22/2026', qty: '72 pcs',  total: '$1,406.40', tier: '50+', status: 'Pending',  sDark: false },
  { id: 'Q-2026-W7BD', cust: 'Lakeside Yoga Studio',     date: '04/08/2026', inh: '04/20/2026', qty: '40 pcs',  total: '$702.00',   tier: '25+', status: 'Approved', sDark: false },
  { id: 'Q-2026-A1QM', cust: 'Sunrise Trail Co-op',      date: '04/05/2026', inh: '04/19/2026', qty: '64 pcs',  total: '$1,118.72', tier: '50+', status: 'Sent',     sDark: false },
  { id: 'Q-2026-P3JN', cust: 'Bramble & Birch Mercantile',date:'04/03/2026', inh: '04/17/2026', qty: '18 pcs',  total: '$338.40',   tier: '12+', status: 'Draft',    sDark: false },
  { id: 'Q-2026-Z6HC', cust: 'Foxglove Florals',         date: '04/01/2026', inh: '04/15/2026', qty: '48 pcs',  total: '$854.40',   tier: '25+', status: 'Approved', sDark: false },
];

function QuotesList({ highlightNewBtn = 0, newRowT = 0 }) {
  return (
    <div style={{
      position: 'absolute', left: 232, top: 0, right: 0, bottom: 0,
      padding: '32px 44px',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <h1 style={{
          fontFamily: F, fontSize: 32, fontWeight: 800, color: Q.text1,
          letterSpacing: '-0.025em', margin: 0,
        }}>Quotes</h1>
        <button style={{
          padding: '12px 22px',
          background: Q.accent,
          color: '#fff', border: 'none', borderRadius: 10,
          fontFamily: F, fontSize: 14.5, fontWeight: 600,
          boxShadow: highlightNewBtn > 0
            ? `0 0 0 ${4 + highlightNewBtn * 6}px rgba(79,70,229,${highlightNewBtn * 0.18}), 0 4px 12px rgba(79,70,229,0.3)`
            : '0 1px 2px rgba(15,23,42,0.06)',
          transform: `scale(${1 + highlightNewBtn * 0.02})`,
        }}>+ New Quote</button>
      </div>

      {/* Filters row 1 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {FILTERS_A.map((f, i) => (
          <span key={f} style={{
            padding: '7px 14px',
            background: i === 0 ? Q.accent : Q.surface,
            color: i === 0 ? '#fff' : Q.text2,
            border: i === 0 ? 'none' : `1px solid ${Q.border}`,
            borderRadius: 999,
            fontFamily: F, fontSize: 13, fontWeight: 500,
            whiteSpace: 'nowrap',
          }}>{f}</span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, alignItems: 'center' }}>
        {FILTERS_B.map((f, i) => (
          <span key={f} style={{
            padding: '7px 14px',
            background: i === 0 ? Q.accent : Q.surface,
            color: i === 0 ? '#fff' : Q.text2,
            border: i === 0 ? 'none' : `1px solid ${Q.border}`,
            borderRadius: 999,
            fontFamily: F, fontSize: 13, fontWeight: 500,
            whiteSpace: 'nowrap',
          }}>{f}</span>
        ))}
        <span style={{
          width: 18, height: 18, borderRadius: 10, border: `1.5px solid ${Q.text3}`,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: Q.text3, fontFamily: F, fontSize: 11, fontWeight: 700,
        }}>?</span>
      </div>

      {/* Advanced filters */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        fontFamily: F, fontSize: 13.5, color: Q.text2, fontWeight: 600,
        marginBottom: 14,
      }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={Q.text2} strokeWidth="2" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
        Advanced Filters
      </div>

      <div style={{ fontFamily: F, fontSize: 13, color: Q.text3, marginBottom: 12 }}>
        {3 + (newRowT > 0 ? 1 : 0)} quotes
      </div>

      {/* Table */}
      <div style={{
        background: Q.surface,
        border: `1px solid ${Q.border}`,
        borderRadius: 14,
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '40px 140px 1fr 130px 130px 90px 130px 80px 110px 70px',
          padding: '14px 22px',
          fontFamily: F, fontSize: 11.5, color: Q.text3, fontWeight: 600,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          borderBottom: `1px solid ${Q.border}`,
          alignItems: 'center',
        }}>
          <span />
          <span>Quote ID</span>
          <span>Customer</span>
          <span>Date ▼</span>
          <span>In-Hands</span>
          <span>Qty</span>
          <span>Total</span>
          <span>Tier</span>
          <span>Status</span>
          <span />
        </div>
        {/* New row (animates in) */}
        {newRowT > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: '40px 140px 1fr 130px 130px 90px 130px 80px 110px 70px',
            padding: '16px 22px',
            alignItems: 'center',
            fontFamily: F, fontSize: 13.5, color: Q.text1,
            borderBottom: `1px solid ${Q.border}`,
            background: `rgba(238,242,255,${newRowT * 0.6})`,
            opacity: newRowT,
            transform: `translateX(${(1 - newRowT) * -12}px)`,
          }}>
            <input type="checkbox" />
            <span style={{ color: Q.accent, fontWeight: 600 }}>Q-2026-JX7B</span>
            <span style={{ fontWeight: 600 }}>Riverside Surf Club</span>
            <span>05/11/2026</span>
            <span>05/25/2026</span>
            <span style={{ fontFamily: M }}>84 pcs</span>
            <span style={{ fontWeight: 700 }}>$1,178.64</span>
            <Tier label="50+" />
            <StatusPill label="Draft" tone="gray" />
            <span style={{ color: Q.accent, fontWeight: 600 }}>View →</span>
          </div>
        )}
        {EXISTING_QUOTES.map((r) => (
          <div key={r.id} style={{
            display: 'grid',
            gridTemplateColumns: '40px 140px 1fr 130px 130px 90px 130px 80px 110px 70px',
            padding: '16px 22px',
            alignItems: 'center',
            fontFamily: F, fontSize: 13.5, color: Q.text1,
            borderBottom: `1px solid ${Q.border}`,
          }}>
            <input type="checkbox" />
            <span style={{ color: Q.text3, fontWeight: 600 }}>{r.id}</span>
            <span style={{ fontWeight: r.cust === '—' ? 400 : 600, color: r.cust === '—' ? Q.text3 : Q.text1 }}>{r.cust}</span>
            <span>{r.date}</span>
            <span>{r.inh}</span>
            <span style={{ fontFamily: M }}>{r.qty}</span>
            <span style={{ fontWeight: 700 }}>{r.total}</span>
            <Tier label={r.tier} />
            <StatusPill label={r.status} tone={r.status === 'Draft' ? 'gray' : 'green'} />
            <span style={{ color: Q.accent, fontWeight: 600 }}>View →</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Tier({ label }) {
  return (
    <span style={{
      display: 'inline-block', padding: '3px 11px',
      background: Q.greenSoft, color: Q.green,
      border: `1px solid ${Q.greenBorder}`,
      borderRadius: 999,
      fontFamily: F, fontSize: 11.5, fontWeight: 600,
    }}>{label}</span>
  );
}

function StatusPill({ label, tone = 'green' }) {
  const styles = tone === 'green'
    ? { bg: Q.greenSoft, fg: Q.green, br: Q.greenBorder }
    : { bg: '#F1F5F9', fg: Q.text2, br: '#CBD5E1' };
  return (
    <span style={{
      display: 'inline-block', padding: '3px 11px',
      background: styles.bg, color: styles.fg,
      border: `1px solid ${styles.br}`,
      borderRadius: 999,
      fontFamily: F, fontSize: 11.5, fontWeight: 600,
    }}>{label}</span>
  );
}

// ─── Quote Builder Modal ────────────────────────────────────────────────────

function QuoteBuilderModal({ t, modalT }) {
  // t is local time in seconds since modal opened
  // Phase plan:
  //   0.0–0.6 modal flies up
  //   0.8–1.8 customer dropdown opens, "Choo Choo's Tavern" selected
  //   1.8–3.0 job title types in "Spring Merch Drop"
  //   3.0–3.4 Rush hover→pass (we keep Standard)
  //   3.6–4.4 garment style "5001" types in → autofill brand/category/color
  //   4.6–6.6 size breakdown qty types: 12 → 25 → 25 → 20 → 2
  //   6.8–7.6 print location: title "Demo Logo", colors 1, pantone "Algae Black"
  //   7.8–9.0 live pricing materializes, counts up
  //   9.0–10.0 line total locks in, button glows
  //   10.0–11.0 click Save → row appears in table

  // Customer
  const custOpen = t > 0.8 && t < 1.6;
  const custSel  = t > 1.6;
  const custName = 'Riverside Surf Club';

  // Job title typing
  const jobStart = 1.8, jobEnd = 2.9;
  const jobTitleFull = 'Spring Merch Drop';
  const jobP = clamp((t - jobStart) / (jobEnd - jobStart), 0, 1);
  const jobTitle = jobTitleFull.slice(0, Math.floor(jobP * jobTitleFull.length));

  // Garment style
  const styleStart = 3.6, styleEnd = 4.2;
  const styleFull = '5001';
  const styleP = clamp((t - styleStart) / (styleEnd - styleStart), 0, 1);
  const styleVal = styleFull.slice(0, Math.floor(styleP * styleFull.length));
  const autofill = clamp((t - 4.3) / 0.4, 0, 1);  // brand/cat/color appear after style typed

  // Size breakdown
  const SIZE_STEPS = [
    { idx: 2, val: 12, t: 4.7 }, // S
    { idx: 3, val: 25, t: 5.1 }, // M
    { idx: 4, val: 25, t: 5.5 }, // L
    { idx: 5, val: 20, t: 5.9 }, // XL
    { idx: 6, val: 2,  t: 6.3 }, // 2XL
  ];
  const sizes = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let total = 0;
  for (const s of SIZE_STEPS) {
    if (t >= s.t) { sizes[s.idx] = s.val; total += s.val; }
  }
  const activeSizeIdx = (() => {
    for (let i = SIZE_STEPS.length - 1; i >= 0; i--) {
      if (t >= SIZE_STEPS[i].t && t < SIZE_STEPS[i].t + 0.35) return SIZE_STEPS[i].idx;
    }
    return -1;
  })();

  // Print location
  const titleStart = 6.8, titleEnd = 7.6;
  const titleFull = 'Surf Camp 2026';
  const titleP = clamp((t - titleStart) / (titleEnd - titleStart), 0, 1);
  const titleVal = titleFull.slice(0, Math.floor(titleP * titleFull.length));

  const pantoneStart = 7.5, pantoneEnd = 8.0;
  const pantoneFull = 'Algae Black';
  const pantoneP = clamp((t - pantoneStart) / (pantoneEnd - pantoneStart), 0, 1);
  const pantoneVal = pantoneFull.slice(0, Math.floor(pantoneP * pantoneFull.length));

  // Linked button activates ~7.8
  const linkedActive = t > 7.8;

  // Live pricing card appears early (with the modal) and updates live as qty fills.
  const priceCardT = clamp((t - 0.6) / 0.5, 0, 1);
  // Drive pricing from the current entered total quantity (full = 84 pcs)
  const FULL_QTY = 84;
  const qtyFraction = total / FULL_QTY;
  // Smooth the visual count so each size step glides in
  const [smoothFrac, setSmoothFrac] = React.useState(0);
  React.useEffect(() => {
    let raf;
    const tick = () => {
      setSmoothFrac((prev) => {
        const next = prev + (qtyFraction - prev) * 0.22;
        if (Math.abs(qtyFraction - next) < 0.001) return qtyFraction;
        raf = requestAnimationFrame(tick);
        return next;
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [qtyFraction]);
  const priceCount = smoothFrac;
  const PRINT_TOTAL  = 476.28;
  const GARMENT_TOTAL = 702.36;
  const LINE_TOTAL   = 1178.64;

  // Save button highlight
  const saveT = clamp((t - 9.6) / 0.4, 0, 1);

  // Modal fly-in
  const flyT = Easing.easeOutCubic(clamp(modalT / 0.55, 0, 1));

  return (
    <>
      {/* Backdrop */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(15,23,42,0.45)',
        opacity: flyT,
      }} />

      {/* Modal */}
      <div style={{
        position: 'absolute',
        left: '50%', top: '50%',
        width: 1320, height: 1020,
        transform: `translate(-50%, -50%) translateY(${(1 - flyT) * 60}px) scale(${0.94 + 0.06 * flyT})`,
        opacity: flyT,
        background: Q.appBg,
        borderRadius: 16,
        boxShadow: '0 50px 120px rgba(15,23,42,0.4), 0 8px 24px rgba(15,23,42,0.2)',
        overflow: 'hidden',
        border: `1px solid ${Q.border}`,
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 30px 16px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          background: Q.surface,
          borderBottom: `1px solid ${Q.border}`,
        }}>
          <div>
            <div style={{ fontFamily: M, fontSize: 12, color: Q.text3, letterSpacing: '0.05em', marginBottom: 3 }}>Q-2026-JX7B</div>
            <h2 style={{ fontFamily: F, fontSize: 26, fontWeight: 800, color: Q.text1, letterSpacing: '-0.02em', margin: 0 }}>Quote Builder</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              padding: '8px 28px 8px 14px',
              background: Q.surface, border: `1px solid ${Q.border}`,
              borderRadius: 8,
              fontFamily: F, fontSize: 13.5, color: Q.text2,
              position: 'relative',
            }}>
              Draft
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={Q.text3} strokeWidth="2" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <button style={{
              padding: '10px 22px',
              background: Q.accent, color: '#fff',
              border: 'none', borderRadius: 9,
              fontFamily: F, fontSize: 13.5, fontWeight: 700,
              boxShadow: saveT > 0
                ? `0 0 0 ${4 + saveT * 5}px rgba(79,70,229,${saveT * 0.18}), 0 6px 16px rgba(79,70,229,0.35)`
                : '0 4px 12px rgba(79,70,229,0.25)',
              transform: `scale(${1 + saveT * 0.03})`,
              whiteSpace: 'nowrap',
            }}>Save Quote →</button>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={Q.text3} strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M6 18L18 6"/></svg>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: '18px 30px 16px', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Top form row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div>
              <FieldLabel>Customer *</FieldLabel>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{
                  flex: 1,
                  padding: '10px 14px',
                  background: Q.surface,
                  border: `1.5px solid ${custOpen || custSel ? Q.accent : Q.border}`,
                  borderRadius: 9,
                  fontFamily: F, fontSize: 14, fontWeight: custSel ? 600 : 500,
                  color: custSel ? Q.text1 : Q.text3,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  position: 'relative',
                  cursor: 'pointer',
                }}>
                  {custSel ? custName : 'Select customer...'}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={Q.text3} strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                  {custOpen && (
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
                      background: Q.surface,
                      border: `1px solid ${Q.border}`,
                      borderRadius: 9,
                      padding: 6,
                      boxShadow: '0 8px 24px rgba(15,23,42,0.15)',
                      zIndex: 10,
                      opacity: clamp((t - 0.85) / 0.15, 0, 1),
                    }}>
                      <div style={{ padding: '8px 12px', borderRadius: 6, color: Q.text2, fontWeight: 500 }}>Harbor Print Co.</div>
                      <div style={{ padding: '8px 12px', borderRadius: 6, color: Q.text2, fontWeight: 500 }}>Northwind Bakery</div>
                      <div style={{
                        padding: '8px 12px', borderRadius: 6,
                        background: t > 1.2 ? Q.accentSoft : 'transparent',
                        color: t > 1.2 ? Q.accentText : Q.text2, fontWeight: 600,
                      }}>Riverside Surf Club</div>
                      <div style={{ padding: '8px 12px', borderRadius: 6, color: Q.text2, fontWeight: 500 }}>Tinsel Goods</div>
                    </div>
                  )}
                </div>
                <button style={{
                  padding: '10px 16px',
                  background: Q.surface, color: Q.accentText,
                  border: `1px solid ${Q.accent}`, borderRadius: 9,
                  fontFamily: F, fontSize: 13.5, fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}>+ New Customer</button>
              </div>
            </div>
            <div>
              <FieldLabel>Job Title</FieldLabel>
              <div style={{
                padding: '10px 14px',
                background: Q.surface,
                border: `1.5px solid ${jobP > 0 && jobP < 1 ? Q.accent : Q.border}`,
                borderRadius: 9,
                fontFamily: F, fontSize: 14, fontWeight: 500,
                color: jobTitle ? Q.text1 : Q.text3,
                display: 'flex', alignItems: 'center',
              }}>
                {jobTitle || 'Business Cards, Event Shirts, etc.'}
                {jobP > 0 && jobP < 1 && <Caret />}
              </div>
            </div>
          </div>

          {/* Dates row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
            <DateField label="Quote Date" value="05/11/2026" />
            <DateField label="In-Hands Date" value="05/25/2026" />
            <DateField label="Quote Expires" value="06/10/2026" />
          </div>

          {/* Turnaround + Add-ons */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 24 }}>
            <div>
              <FieldLabel>Turnaround</FieldLabel>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <TurnaroundCard active label="Standard" sub="14 business days" />
                <TurnaroundCard label="Rush +20%" sub="7 business days" />
              </div>
            </div>
            <div>
              <FieldLabel>Add-ons (per piece)</FieldLabel>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <AddonCard label="Custom Tags" price="+$1.50/pc" />
                <AddonCard label="Difficult Print" price="+$0.50/pc" />
                <AddonCard label="Pantone Match" price="+$1.00/pc" />
                <AddonCard label="Water-Based Ink" price="+$1.00/pc" />
              </div>
            </div>
          </div>

          {/* LINE ITEMS */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <FieldLabel noMargin>Line Items</FieldLabel>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{
                padding: '7px 13px',
                background: Q.surface, color: Q.green,
                border: `1px solid ${Q.greenBorder}`, borderRadius: 8,
                fontFamily: F, fontSize: 12.5, fontWeight: 600,
                whiteSpace: 'nowrap',
              }}>📋 Paste Order</button>
              <button style={{
                padding: '7px 13px',
                background: Q.surface, color: Q.accentText,
                border: `1px solid ${Q.accent}`, borderRadius: 8,
                fontFamily: F, fontSize: 12.5, fontWeight: 600,
                whiteSpace: 'nowrap',
              }}>+ Add Garment Group</button>
            </div>
          </div>

          {/* Garment group + Live Pricing */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 18, flex: 1, minHeight: 0 }}>
            {/* Garment card */}
            <div style={{
              background: Q.surface, border: `1px solid ${Q.border}`, borderRadius: 12,
              padding: '14px 18px',
              overflow: 'hidden',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, color: Q.accent,
                fontFamily: F, fontSize: 13, fontWeight: 600, marginBottom: 10,
              }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={Q.accent} strokeWidth="2.4"><polyline points="6 9 12 15 18 9"/></svg>
                Collapse
              </div>

              {/* Style fields row */}
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr 100px', gap: 12, marginBottom: 10 }}>
                <Cell label="Style #">
                  <Inp value={styleVal} typing={styleP > 0 && styleP < 1} placeholder="e.g. 1717" />
                </Cell>
                <Cell label="Category">
                  <Inp value={autofill > 0 ? 'T-Shirts' : ''} placeholder="Select..." select fade={autofill} />
                </Cell>
                <Cell label="Brand">
                  <Inp value={autofill > 0 ? 'AS Colour — 5001 — S…' : ''} placeholder="e.g. Gildan" select fade={autofill} />
                </Cell>
                <Cell label="Garment Color">
                  <Inp value={autofill > 0 ? 'White' : ''} placeholder="e.g. Black" select fade={autofill} />
                </Cell>
                <Cell label="Garment Cost">
                  <Inp value={autofill > 0 ? '5.85' : ''} prefix="$" fade={autofill} />
                </Cell>
              </div>
              <div style={{ fontFamily: F, fontSize: 12.5, color: Q.accent, fontWeight: 600, marginBottom: 10 }}>
                ⧉ Duplicate
              </div>

              {/* Display header preview */}
              <div style={{
                padding: '10px 14px',
                background: Q.accentSofter,
                border: `1px solid ${Q.accentBorder}`,
                borderRadius: 10,
                marginBottom: 12,
                opacity: autofill,
              }}>
                <div style={{
                  fontFamily: F, fontSize: 10.5, color: Q.accentText, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4,
                }}>Display Header Preview</div>
                <div style={{ fontFamily: F, fontSize: 15.5, fontWeight: 700, color: Q.text1, letterSpacing: '-0.01em', marginBottom: 2 }}>
                  5001 - Staple Tee
                </div>
                <div style={{ fontFamily: F, fontSize: 12.5, color: Q.text2 }}>
                  Brand: AS Colour · Color: White
                </div>
              </div>

              {/* Size breakdown */}
              <FieldLabel noMargin small>Size Breakdown</FieldLabel>
              <div style={{ marginTop: 8 }}>
                <SizeRow head values={['Size', 'OS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'Total']} />
                <SizeRow
                  values={['Qty', ...sizes.map((n, i) => i === 6 || i === 7 || i === 8 || i === 9 ? n : n), total]}
                  highlights={[6,7,8,9]} activeIdx={activeSizeIdx} total={total}
                />
              </div>
              {total > 0 && SIZE_STEPS.some(s => s.idx === 6 && t >= s.t) && (
                <div style={{
                  marginTop: 10,
                  padding: '8px 12px',
                  background: Q.yellow,
                  border: `1px solid ${Q.yellowBorder}`,
                  borderRadius: 8,
                  fontFamily: F, fontSize: 12.5, color: Q.yellowText, fontWeight: 500,
                  opacity: clamp((t - 6.4) / 0.3, 0, 1),
                }}>
                  2XL+ sizes highlighted — pricing based on average across all sizes.
                </div>
              )}

              {/* Print locations */}
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <FieldLabel noMargin small>Print Locations</FieldLabel>
                  <span style={{ fontFamily: F, fontSize: 12.5, color: Q.accentText, fontWeight: 600 }}>+ Add Location</span>
                </div>
                <div style={{
                  background: Q.surface2,
                  border: `1px solid ${Q.border}`,
                  borderRadius: 10,
                  padding: '12px 14px',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto 70px 70px',
                  gap: 12,
                  alignItems: 'end',
                }}>
                  <SubField label="Title">
                    <Inp value={titleVal} typing={titleP > 0 && titleP < 1} placeholder="e.g. Front Logo" small />
                  </SubField>
                  <SubField label="Link Print">
                    <div style={{
                      padding: '7px 12px',
                      background: linkedActive ? Q.greenSoft : Q.surface,
                      color: linkedActive ? Q.green : Q.text2,
                      border: `1px solid ${linkedActive ? Q.greenBorder : Q.border}`,
                      borderRadius: 7,
                      fontFamily: F, fontSize: 12.5, fontWeight: 600,
                      whiteSpace: 'nowrap', textAlign: 'center',
                    }}>{linkedActive ? '✓ Linked' : 'Link'}</div>
                  </SubField>
                  <SubField label="Width"><Inp value={linkedActive ? '12' : ''} placeholder='e.g. 4"' small /></SubField>
                  <SubField label="Height"><Inp value={linkedActive ? '12' : ''} placeholder='e.g. 2"' small /></SubField>
                </div>
                <div style={{
                  background: Q.surface2,
                  border: `1px solid ${Q.border}`, borderTop: 'none',
                  borderRadius: '0 0 10px 10px',
                  padding: '12px 14px',
                  display: 'grid',
                  gridTemplateColumns: '110px 90px 1fr',
                  gap: 12,
                  alignItems: 'end',
                }}>
                  <SubField label="Location"><Inp value="Front" select small /></SubField>
                  <SubField label="Colors">
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '4px 8px',
                      background: Q.surface, border: `1px solid ${Q.border}`,
                      borderRadius: 7,
                    }}>
                      <span style={{ fontFamily: F, fontSize: 14, color: Q.text2 }}>−</span>
                      <span style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: Q.text1 }}>1</span>
                      <span style={{ fontFamily: F, fontSize: 14, color: Q.text2 }}>+</span>
                    </div>
                  </SubField>
                  <SubField label="Pantone(s)">
                    <Inp value={pantoneVal} typing={pantoneP > 0 && pantoneP < 1} placeholder="e.g. PMS 286 C, White" small />
                  </SubField>
                </div>
              </div>
            </div>

            {/* Live pricing */}
            <div style={{
              background: Q.surface2,
              border: `1px solid ${Q.border}`,
              borderRadius: 14,
              padding: 14,
              display: 'flex', flexDirection: 'column', gap: 12,
              opacity: priceCardT,
              transform: `translateX(${(1 - priceCardT) * 16}px)`,
            }}>
              <div style={{
                background: Q.navy,
                borderRadius: 12,
                padding: 16,
                color: '#fff',
              }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginBottom: 16,
                }}>
                  <span style={{
                    fontFamily: F, fontSize: 11, fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.12em',
                    color: 'rgba(255,255,255,0.55)',
                  }}>Live Pricing</span>
                  <span style={{
                    background: Q.accent, padding: '3px 10px', borderRadius: 999,
                    fontFamily: F, fontSize: 11.5, fontWeight: 700,
                  }}>{total} pcs</span>
                </div>
                <PriceRow
                  label="1st Print — Front (1c)"
                  sub={`Tier: 50+ from ${total} pcs · linked`}
                  value={priceCount > 0 ? `$${(PRINT_TOTAL * priceCount).toFixed(2)}` : '—'}
                  right="$5.67/pc"
                />
                <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '12px 0' }} />
                <PriceRow
                  label="Garments"
                  sub="$8.36/pc avg"
                  value={priceCount > 0 ? `$${(GARMENT_TOTAL * priceCount).toFixed(2)}` : '—'}
                />
                <div style={{
                  marginTop: 16,
                  borderTop: '1px solid rgba(255,255,255,0.08)',
                  paddingTop: 14,
                }}>
                  <div style={{
                    fontFamily: F, fontSize: 10.5, fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.1em',
                    color: 'rgba(255,255,255,0.45)', marginBottom: 6,
                  }}>Override Price Per Piece</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontFamily: F, fontSize: 16, color: 'rgba(255,255,255,0.55)' }}>$</span>
                    <span style={{
                      fontFamily: F, fontSize: 22, fontWeight: 700, color: '#fff',
                      fontVariantNumeric: 'tabular-nums',
                    }}>{(14.03 * priceCount).toFixed(2)}</span>
                    <span style={{ fontFamily: F, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>/pc</span>
                    <span style={{ fontFamily: F, fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginLeft: 'auto' }}>(suggested)</span>
                  </div>
                </div>
              </div>

              {/* Line total */}
              <div style={{
                background: Q.accent,
                borderRadius: 12,
                padding: '18px 20px',
                color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                boxShadow: '0 12px 28px rgba(79,70,229,0.35)',
              }}>
                <div>
                  <div style={{
                    fontFamily: F, fontSize: 10.5, fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.12em',
                    opacity: 0.85, marginBottom: 4,
                  }}>Line Total</div>
                  <div style={{ fontFamily: F, fontSize: 11.5, opacity: 0.75 }}>
                    ${(14.03 * priceCount).toFixed(2)}/pc avg
                  </div>
                </div>
                <div style={{
                  fontFamily: F, fontSize: 30, fontWeight: 800,
                  letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}>
                  ${(LINE_TOTAL * priceCount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </>
  );
}

function FieldLabel({ children, noMargin, small }) {
  return (
    <div style={{
      fontFamily: F, fontSize: small ? 10.5 : 11, color: Q.text3, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.1em',
      marginBottom: noMargin ? 0 : 7,
    }}>{children}</div>
  );
}

function DateField({ label, value }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div style={{
        padding: '10px 14px',
        background: Q.surface, border: `1px solid ${Q.border}`, borderRadius: 9,
        fontFamily: F, fontSize: 14, fontWeight: 500, color: Q.text1,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        {value}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={Q.text3} strokeWidth="1.7"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>
      </div>
    </div>
  );
}

function TurnaroundCard({ label, sub, active }) {
  return (
    <div style={{
      padding: '12px 14px',
      background: active ? Q.accentSoft : Q.surface,
      border: `1.5px solid ${active ? Q.accent : Q.border}`,
      borderRadius: 10,
    }}>
      <div style={{ fontFamily: F, fontSize: 14, fontWeight: 700, color: active ? Q.accentText : Q.text1 }}>{label}</div>
      <div style={{ fontFamily: F, fontSize: 11.5, color: Q.text3, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function AddonCard({ label, price }) {
  return (
    <div style={{
      padding: '10px 14px',
      background: Q.surface, border: `1px solid ${Q.border}`, borderRadius: 10,
    }}>
      <div style={{ fontFamily: F, fontSize: 13, fontWeight: 600, color: Q.text1 }}>{label}</div>
      <div style={{ fontFamily: F, fontSize: 11.5, color: Q.text3, marginTop: 1 }}>{price}</div>
    </div>
  );
}

function Cell({ label, children }) {
  return (
    <div>
      <div style={{
        fontFamily: F, fontSize: 10, color: Q.text3, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4,
      }}>{label}</div>
      {children}
    </div>
  );
}

function SubField({ label, children }) {
  return (
    <div>
      <div style={{ fontFamily: F, fontSize: 11.5, color: Q.text2, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function Inp({ value, placeholder, prefix, select, typing, fade = 1, small }) {
  return (
    <div style={{
      padding: small ? '7px 10px' : '8px 12px',
      background: Q.surface, border: `1px solid ${typing ? Q.accent : Q.border}`,
      borderRadius: 7,
      fontFamily: F, fontSize: small ? 12.5 : 13.5, fontWeight: 500,
      color: value ? Q.text1 : Q.text3,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      opacity: fade,
      whiteSpace: 'nowrap', overflow: 'hidden',
      minHeight: small ? 30 : 34,
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
        {prefix && <span style={{ color: Q.text3, marginRight: 4 }}>{prefix}</span>}
        {value || placeholder}
        {typing && <Caret />}
      </span>
      {select && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={Q.text3} strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>}
    </div>
  );
}

function Caret() {
  const time = useTime();
  const on = (time * 1.8) % 1 < 0.5;
  return (
    <span style={{
      display: 'inline-block', width: 2, height: 14,
      background: Q.accent, marginLeft: 2,
      opacity: on ? 1 : 0,
      verticalAlign: 'middle',
    }} />
  );
}

function SizeRow({ values, head, highlights = [], activeIdx = -1, total }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `40px repeat(${values.length - 1}, 1fr)`,
      gap: 4,
      padding: '4px 0',
      alignItems: 'center',
    }}>
      {values.map((v, i) => {
        const isLabel = i === 0;
        const isTotal = i === values.length - 1;
        if (head) {
          return (
            <div key={i} style={{
              fontFamily: F, fontSize: 11.5, color: Q.text3,
              fontWeight: 600, textAlign: isLabel ? 'left' : 'center',
              padding: '4px 0',
            }}>{v}</div>
          );
        }
        if (isLabel) {
          return (
            <div key={i} style={{
              fontFamily: F, fontSize: 12, color: Q.text2, fontWeight: 500,
            }}>{v}</div>
          );
        }
        const sizeColIdx = i - 1;
        const isHi = highlights.includes(sizeColIdx);
        const isActive = activeIdx === sizeColIdx;
        if (isTotal) {
          return (
            <div key={i} style={{
              fontFamily: M, fontSize: 14, fontWeight: 700, color: Q.text1,
              textAlign: 'center', fontVariantNumeric: 'tabular-nums',
            }}>{total}</div>
          );
        }
        return (
          <div key={i} style={{
            padding: '5px 4px',
            background: isHi ? '#FEF9C3' : Q.surface,
            border: `1px solid ${isActive ? Q.accent : (isHi ? Q.yellowBorder : Q.border)}`,
            borderRadius: 6,
            textAlign: 'center',
            fontFamily: M, fontSize: 12.5, fontWeight: 500,
            color: v === 0 ? Q.text3 : Q.text1,
            fontVariantNumeric: 'tabular-nums',
            boxShadow: isActive ? `0 0 0 3px rgba(79,70,229,0.18)` : 'none',
            transition: 'box-shadow 200ms',
          }}>{v}</div>
        );
      })}
    </div>
  );
}

function PriceRow({ label, sub, value, right }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      gap: 12,
    }}>
      <div>
        <div style={{ fontFamily: F, fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 2 }}>{label}</div>
        <div style={{ fontFamily: F, fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{sub}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontFamily: F, fontSize: 15, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{value}</div>
        {right && <div style={{ fontFamily: F, fontSize: 11, color: 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap' }}>{right}</div>}
      </div>
    </div>
  );
}

function Cursor({ x, y, label }) {
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
          background: Q.accent, color: '#fff',
          padding: '4px 9px', borderRadius: 6,
          fontFamily: F, fontSize: 11.5, fontWeight: 600,
          whiteSpace: 'nowrap',
          boxShadow: '0 4px 12px rgba(79,70,229,0.4)',
        }}>{label}</div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SCENES
// ────────────────────────────────────────────────────────────────────────────

// 0–3s: Quotes list, cursor moves to + New Quote and clicks
function SceneList() {
  const { localTime } = useSprite();
  // Cursor path: rest 1500,400 → hover button (1685, 100) by 1.5s → click flash at 2.0s
  const t = localTime;
  const cx = t < 0.6 ? 900 : t < 1.7 ? interpolate([0.6, 1.7], [900, 1690])(t) : 1690;
  const cy = t < 0.6 ? 700 : t < 1.7 ? interpolate([0.6, 1.7], [600, 105])(t) : 105;

  const btnHi = clamp((t - 1.4) / 0.4, 0, 1);
  const clickFlash = t > 1.95 && t < 2.15 ? (1 - (t - 1.95) / 0.2) : 0;

  // Caption
  const capT = clamp((t - 0.15) / 0.4, 0, 1) * (1 - clamp((t - 2.6) / 0.4, 0, 1));

  return (
    <div style={{ position: 'absolute', inset: 0, background: Q.appBg }}>
      <Sidebar active="Quotes" />
      <QuotesList highlightNewBtn={btnHi} newRowT={0} />
      <Cursor x={cx} y={cy} label={btnHi > 0.5 ? 'Click' : null} />
      {clickFlash > 0 && (
        <div style={{
          position: 'absolute',
          right: 28, top: 70,
          width: 220, height: 56, borderRadius: 12,
          background: `rgba(79,70,229,${clickFlash * 0.25})`,
          pointerEvents: 'none',
        }} />
      )}

      {/* Caption */}
      <div style={{
        position: 'absolute',
        left: 280, bottom: 64,
        opacity: capT,
        transform: `translateY(${(1 - capT) * 8}px)`,
      }}>
        <div style={{
          fontFamily: F, fontSize: 12, color: Q.accent, fontWeight: 800,
          textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 8,
        }}>Step 01</div>
        <div style={{ fontFamily: F, fontSize: 30, fontWeight: 700, color: Q.text1, letterSpacing: '-0.02em' }}>
          Start a new quote.
        </div>
      </div>
    </div>
  );
}

// 3–18s: The full Quote Builder fill-in
function SceneBuilder() {
  const { localTime } = useSprite();
  const t = localTime; // 0..15

  // Captions change as the user moves through phases
  let captionStep = '';
  let captionLine = '';
  if (t < 3.0)       { captionStep = 'Step 02'; captionLine = 'Pick the customer and job.'; }
  else if (t < 6.5)  { captionStep = 'Step 03'; captionLine = 'Add garments and sizes.'; }
  else if (t < 8.0)  { captionStep = 'Step 04'; captionLine = 'Define the print.'; }
  else if (t < 11.5) { captionStep = 'Step 05'; captionLine = 'Pricing — live as you type.'; }
  else               { captionStep = 'Step 06'; captionLine = 'Save and it lands on the board.'; }

  const capT = clamp((t - 0.4) / 0.4, 0, 1);
  const capFade = (t > 2.7 && t < 3.1) || (t > 6.2 && t < 6.6) || (t > 7.7 && t < 8.1) || (t > 11.2 && t < 11.6);

  // Save click moment — quote modal stays up; we cut straight to the email scene
  const modalT = clamp(t / 0.5, 0, 1);

  // New row stays hidden behind the modal until the email scene shows the list
  const newRowT = 0;

  return (
    <div style={{ position: 'absolute', inset: 0, background: Q.appBg }}>
      {/* Background list with new row dropping in late */}
      <Sidebar active="Quotes" />
      <QuotesList newRowT={newRowT} />

      <QuoteBuilderModal t={t} modalT={modalT} />

      {/* Caption tucked in the dark backdrop, right of the modal */}
      <div style={{
        position: 'absolute',
        right: 36, top: '50%',
        transform: `translateY(-50%) translateY(${(1 - capT) * 8}px)`,
        width: 240,
        opacity: capT * (capFade ? 0.4 : 1) * (modalT > 0.4 ? 1 : 0),
        transition: 'opacity 200ms',
        zIndex: 5,
        pointerEvents: 'none',
      }}>
        <div style={{
          fontFamily: F, fontSize: 11.5, color: '#A5B4FC', fontWeight: 800,
          textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 8,
        }}>{captionStep}</div>
        <div style={{
          fontFamily: F, fontSize: 22, fontWeight: 700,
          color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.2,
        }}>{captionLine}</div>
      </div>
    </div>
  );
}

// 18–22s: Final outro card — quote saved
function SceneOutro() {
  const { localTime } = useSprite();
  const t = localTime;
  const inT = Easing.easeOutCubic(clamp(t / 0.6, 0, 1));
  const checkT = clamp((t - 0.3) / 0.5, 0, 1);
  const wordT = clamp((t - 0.8) / 0.5, 0, 1);

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: '#0B0B0E',
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
        fontFamily: F, fontSize: 72, fontWeight: 800,
        color: '#fff', letterSpacing: '-0.03em',
        textAlign: 'center',
      }}>
        Quotes sent in <span style={{ color: '#A5B4FC' }}>minutes.</span>
      </div>

      <div style={{
        position: 'absolute', bottom: 64,
        display: 'flex', alignItems: 'center', gap: 14,
        opacity: wordT,
        transform: `translateY(${(1 - wordT) * 10}px)`,
      }}>
        <Logo size={36} />
        <span style={{ fontFamily: F, fontSize: 24, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>InkTracker</span>
      </div>
    </div>
  );
}

function Stat({ n, l }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        fontFamily: F, fontSize: 36, fontWeight: 800, color: '#A5B4FC',
        letterSpacing: '-0.02em', marginBottom: 4,
      }}>{n}</div>
      <div style={{
        fontFamily: F, fontSize: 12, color: 'rgba(255,255,255,0.55)',
        textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 600,
      }}>{l}</div>
    </div>
  );
}
function Divider() {
  return <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.15)' }} />;
}

// 18–24s: Send Quote Email modal
function SceneEmail() {
  const { localTime } = useSprite();
  const t = localTime; // 0..6

  // 0.0–0.4 modal flies up
  // 0.6–2.4 "To" email types in
  // 3.0–4.0 Send button glow → click
  // 4.0–5.0 modal fades, green "Sent" toast slides in
  const modalT = Easing.easeOutCubic(clamp(t / 0.5, 0, 1)) * (1 - clamp((t - 4.0) / 0.5, 0, 1));
  const emailFull = 'derek@riversidesurfclub.com';
  const emailP = clamp((t - 0.6) / 1.8, 0, 1);
  const emailVal = emailFull.slice(0, Math.floor(emailP * emailFull.length));
  const emailTyping = emailP > 0 && emailP < 1;
  const sendT = clamp((t - 3.0) / 0.4, 0, 1) * (1 - clamp((t - 4.0) / 0.3, 0, 1));
  const sentT = clamp((t - 4.2) / 0.5, 0, 1);

  // Cursor: rest center → Send button (around 1700, 950 of the modal) → off
  const cx = t < 2.6 ? 1100 : t < 3.4 ? interpolate([2.6, 3.4], [1100, 1340])(t) : 1340;
  const cy = t < 2.6 ? 780 : t < 3.4 ? interpolate([2.6, 3.4], [780, 950])(t) : 950;

  const capT = clamp((t - 0.3) / 0.4, 0, 1);

  return (
    <div style={{ position: 'absolute', inset: 0, background: Q.appBg }}>
      <Sidebar active="Quotes" />
      <QuotesList newRowT={1} />

      {/* Backdrop */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(15,23,42,0.45)',
        opacity: modalT,
      }} />

      {/* Email modal */}
      <div style={{
        position: 'absolute',
        left: '50%', top: '50%',
        width: 720,
        transform: `translate(-50%, -50%) translateY(${(1 - modalT) * 60}px) scale(${0.94 + 0.06 * modalT})`,
        opacity: modalT,
        background: Q.surface,
        borderRadius: 18,
        boxShadow: '0 50px 120px rgba(15,23,42,0.4), 0 8px 24px rgba(15,23,42,0.2)',
        border: `1px solid ${Q.border}`,
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '24px 28px 0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: Q.accentSoft,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={Q.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/>
              </svg>
            </div>
            <span style={{ fontFamily: F, fontSize: 20, fontWeight: 800, color: Q.text1, letterSpacing: '-0.015em' }}>Send Quote Email</span>
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={Q.text3} strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M6 18L18 6"/></svg>
        </div>

        <div style={{ padding: '20px 28px 0', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* TO */}
          <div>
            <div style={{ fontFamily: F, fontSize: 10.5, color: Q.accentText, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>
              To (Separate Multiple With Commas)
            </div>
            <div style={{
              padding: '12px 14px',
              background: Q.surface, border: `1.5px solid ${emailTyping ? Q.accent : Q.border}`,
              borderRadius: 9,
              fontFamily: F, fontSize: 14, fontWeight: 500,
              color: emailVal ? Q.text1 : Q.text3,
              display: 'flex', alignItems: 'center',
            }}>
              {emailVal || 'email@example.com, another@example.com'}
              {emailTyping && <Caret />}
            </div>
          </div>

          {/* SUBJECT */}
          <div>
            <div style={{ fontFamily: F, fontSize: 10.5, color: Q.accentText, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>
              Subject
            </div>
            <div style={{
              padding: '12px 14px',
              background: Q.surface, border: `1px solid ${Q.border}`,
              borderRadius: 9,
              fontFamily: F, fontSize: 14, fontWeight: 500, color: Q.text1,
            }}>
              Your Quote from Biota Mfg — Quote #Q-2026-JX7B
            </div>
          </div>

          {/* MESSAGE */}
          <div>
            <div style={{ fontFamily: F, fontSize: 10.5, color: Q.accentText, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>
              Message
            </div>
            <div style={{
              padding: '12px 14px',
              background: Q.surface, border: `1px solid ${Q.border}`,
              borderRadius: 9,
              fontFamily: F, fontSize: 14, fontWeight: 500, color: Q.text1,
              lineHeight: 1.45, minHeight: 96,
            }}>
              Hi Derek, your quote is ready for review. Total: $1,275.92. Click below to view, approve, or pay online.
            </div>
            <div style={{ fontFamily: F, fontSize: 12, color: Q.text3, marginTop: 8 }}>
              Full quote details plus review, approval, and payment actions will be included automatically.
            </div>
          </div>

          {/* TOTALS */}
          <div style={{
            background: Q.surface2,
            border: `1px solid ${Q.border}`,
            borderRadius: 10,
            padding: '14px 16px',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <Row label="Subtotal" value="$1,178.52" />
            <Row label="Tax (8.265%)" value="$97.40" />
            <div style={{ height: 1, background: Q.border, margin: '6px 0' }} />
            <Row label="Total" value="$1,275.92" bold />
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '20px 28px 22px',
          display: 'flex', justifyContent: 'space-between', gap: 12,
        }}>
          <button style={{
            flex: 1, padding: '12px 22px',
            background: '#F1F1F4', color: Q.text1,
            border: 'none', borderRadius: 10,
            fontFamily: F, fontSize: 14, fontWeight: 600,
          }}>Cancel</button>
          <button style={{
            flex: 1, padding: '12px 22px',
            background: Q.accent, color: '#fff',
            border: 'none', borderRadius: 10,
            fontFamily: F, fontSize: 14, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: sendT > 0
              ? `0 0 0 ${4 + sendT * 6}px rgba(79,70,229,${sendT * 0.20}), 0 6px 16px rgba(79,70,229,0.35)`
              : '0 4px 12px rgba(79,70,229,0.25)',
            transform: `scale(${1 + sendT * 0.03})`,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/>
            </svg>
            Send
          </button>
        </div>
      </div>

      {/* Cursor while modal is up */}
      {modalT > 0.2 && <Cursor x={cx} y={cy} label={sendT > 0.5 ? 'Click' : null} />}

      {/* Sent toast */}
      {sentT > 0 && (
        <div style={{
          position: 'absolute',
          left: '50%', top: 80,
          transform: `translateX(-50%) translateY(${(1 - sentT) * -20}px)`,
          opacity: sentT,
          background: '#16A34A',
          color: '#fff',
          padding: '14px 22px',
          borderRadius: 12,
          boxShadow: '0 14px 32px rgba(22,163,74,0.35)',
          display: 'inline-flex', alignItems: 'center', gap: 12,
          fontFamily: F, fontSize: 15, fontWeight: 600,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Quote emailed to Riverside Surf Club
        </div>
      )}

      {/* Caption */}
      <div style={{
        position: 'absolute',
        right: 36, top: '50%',
        transform: `translateY(-50%) translateY(${(1 - capT) * 8}px)`,
        width: 240,
        opacity: capT * (modalT > 0.4 ? 1 : 0),
        zIndex: 5,
        pointerEvents: 'none',
      }}>
        <div style={{
          fontFamily: F, fontSize: 11.5, color: '#A5B4FC', fontWeight: 800,
          textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 8,
        }}>Step 07</div>
        <div style={{
          fontFamily: F, fontSize: 22, fontWeight: 700,
          color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.2,
        }}>Send it to the client.</div>
      </div>
    </div>
  );
}

function Row({ label, value, bold }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      fontFamily: F,
    }}>
      <span style={{ fontSize: bold ? 15 : 13.5, fontWeight: bold ? 700 : 500, color: bold ? Q.text1 : Q.text2 }}>{label}</span>
      <span style={{ fontSize: bold ? 22 : 14, fontWeight: bold ? 800 : 600, color: Q.text1, fontVariantNumeric: 'tabular-nums', letterSpacing: bold ? '-0.01em' : 0 }}>{value}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
function QuoteDemo() {
  return (
    <>
      <Sprite start={0}     end={3.0}>   <SceneList /></Sprite>
      <Sprite start={3.0}   end={13.5}>  <SceneBuilder /></Sprite>
      <Sprite start={13.5}  end={19.5}>  <SceneEmail /></Sprite>
      <Sprite start={19.5}  end={23.5}>  <SceneOutro /></Sprite>
    </>
  );
}

window.QuoteDemo = QuoteDemo;
