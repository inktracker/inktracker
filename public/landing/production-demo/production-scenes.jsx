// production-scenes.jsx — InkTracker 25s Production Tracking demo
// Self-contained: defines its own chrome, scenes, lockup.
// Visual system mirrors the real app screenshots.

const PC = {
  // Dark hook / lockup
  darkBg: '#0B0B0E',
  darkText1: '#F4F4F5',
  darkText2: 'rgba(244,244,245,0.62)',
  darkText3: 'rgba(244,244,245,0.40)',

  // App chrome (light)
  appBg: '#F5F5F8',
  surface: '#FFFFFF',
  surface2: '#FAFAFC',
  surfaceHover: '#F8F9FB',
  border: '#E5E7EB',
  borderStrong: '#CBD5E1',
  text1: '#0F172A',
  text2: '#475569',
  text3: '#94A3B8',
  text4: '#CBD5E1',

  // Brand indigo
  accent: '#4F46E5',
  accentSoft: '#EEF2FF',
  accentSofter: '#F5F3FF',
  accentText: '#4338CA',

  // Stage colours from screenshots
  artBg:   '#F5F3FF', artFg:   '#6D28D9',                // Art Approval — light purple
  orderBg: '#FEF3C7', orderFg: '#92400E',                // Order Goods — amber
  prepBg:  '#EFF6FF', prepFg:  '#1D4ED8',                // Pre-Press — light blue
  printBg: '#FEE2E2', printFg: '#B91C1C',                // Printing — red
  finBg:   '#FFF7ED', finFg:   '#9A3412',                // Finishing — orange
  qcBg:    '#FEF9C3', qcFg:    '#854D0E',                // QC — yellow
  readyBg: '#ECFEFF', readyFg: '#0E7490',                // Ready — cyan
  doneBg:  '#DCFCE7', doneFg:  '#166534',                // Completed — green

  // Calendar pill tones
  calRed:    { bg: '#FEE2E2', br: '#FCA5A5', fg: '#B91C1C' }, // Due
  calAmber:  { bg: '#FEF3C7', br: '#FCD34D', fg: '#92400E' }, // Order Goods
  calPurple: { bg: '#F5F3FF', br: '#C4B5FD', fg: '#6D28D9' }, // Art Approval
  calBlue:   { bg: '#EFF6FF', br: '#93C5FD', fg: '#1D4ED8' }, // Pre-Press
  calOrange: { bg: '#FFF7ED', br: '#FDBA74', fg: '#9A3412' }, // Finishing
  calGreen:  { bg: '#DCFCE7', br: '#86EFAC', fg: '#166534' }, // Completed
};

const PFONT = '"Inter", system-ui, -apple-system, sans-serif';
const PMONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace';

// ────────────────────────────────────────────────────────────────────────────
// Fake client roster (used across calendar + table + floor list)
// ────────────────────────────────────────────────────────────────────────────

const CLIENTS = [
  { id: 'ORD-2026-RVRST', name: 'Riverstone Apparel',       due: 'May 18', pcs: 76,  stage: 'art'   },
  { id: 'ORD-2026-NLPCF', name: 'North Loop Coffee',        due: 'May 19', pcs: 41,  stage: 'order' },
  { id: 'ORD-2026-SMACL', name: 'Summit Athletic Club',     due: 'May 20', pcs: 24,  stage: 'art'   },
  { id: 'ORD-2026-BLHGL', name: 'Blue Heron Gallery',       due: 'May 21', pcs: 50,  stage: 'art'   },
  { id: 'ORD-2026-PCTRD', name: 'Pacific Trade Co.',        due: 'May 22', pcs: 101, stage: 'prep'  },
  { id: 'ORD-2026-GRPKO', name: 'Granite Peak Outfitters',  due: 'May 22', pcs: 48,  stage: 'prep'  },
  { id: 'ORD-2026-LSSDR', name: 'Lakeside School District', due: 'May 23', pcs: 196, stage: 'prep'  },
  { id: 'ORD-2026-CPCBR', name: 'Copper Canyon Brewing',    due: 'May 25', pcs: 60,  stage: 'print' },
  { id: 'ORD-2026-EASTC', name: 'Eastside FC',              due: 'May 25', pcs: 35,  stage: 'print' },
  { id: 'ORD-2026-FXGLV', name: 'Foxglove Florist',         due: 'May 26', pcs: 84,  stage: 'fin'   },
  { id: 'ORD-2026-HLDDG', name: 'Highland Dental Group',    due: 'May 27', pcs: 120, stage: 'qc'    },
  { id: 'ORD-2026-CBCYC', name: 'Cobalt Cycling',           due: 'May 27', pcs: 32,  stage: 'qc'    },
  { id: 'ORD-2026-MGRVC', name: 'Maple Grove Camp',         due: 'May 13', pcs: 18,  stage: 'art'   },
  { id: 'ORD-2026-IRWDG', name: 'Ironwood Gym',             due: 'May 28', pcs: 96,  stage: 'print' },
  { id: 'ORD-2026-SRBKY', name: 'Sunset Ridge Bakery',      due: 'May 21', pcs: 14,  stage: 'ready' },
  { id: 'ORD-2026-TDWSF', name: 'Tidewater Surf Co.',       due: 'May 19', pcs: 88,  stage: 'order' },
  { id: 'ORD-2026-BAYCN', name: 'Bayview Construction',     due: 'May 28', pcs: 22,  stage: 'fin'   },
];

const STAGE_MAP = {
  art:   { label: 'Art Approval',    bg: PC.artBg,   fg: PC.artFg,   pillTone: 'purple' },
  order: { label: 'Order Goods',     bg: PC.orderBg, fg: PC.orderFg, pillTone: 'amber'  },
  prep:  { label: 'Pre-Press',       bg: PC.prepBg,  fg: PC.prepFg,  pillTone: 'blue'   },
  print: { label: 'Printing',        bg: PC.printBg, fg: PC.printFg, pillTone: 'red'    },
  fin:   { label: 'Finishing',       bg: PC.finBg,   fg: PC.finFg,   pillTone: 'orange' },
  qc:    { label: 'QC',              bg: PC.qcBg,    fg: PC.qcFg,    pillTone: 'yellow' },
  ready: { label: 'Ready for Pickup',bg: PC.readyBg, fg: PC.readyFg, pillTone: 'cyan'   },
  done:  { label: 'Completed',       bg: PC.doneBg,  fg: PC.doneFg,  pillTone: 'green'  },
};

// ────────────────────────────────────────────────────────────────────────────
// Logo (reuses the real PNG asset)
// ────────────────────────────────────────────────────────────────────────────

function PFlameMark({ size = 32, animate = false, time = 0, ripple = false }) {
  const bobY = animate ? Math.sin(time * 1.2) * 1.4 : 0;
  const breathe = animate ? 1 + Math.sin(time * 1.4) * 0.012 : 1;
  const rPhase = ripple ? ((time % 2.4) / 1.6) : -1;
  const rT = rPhase >= 0 && rPhase <= 1 ? rPhase : -1;
  const rOp = rT >= 0 ? (1 - rT) * 0.45 : 0;
  const rScale = rT >= 0 ? 1 + rT * 0.55 : 1;
  return (
    <div style={{
      position: 'relative', width: size, height: size,
      display: 'inline-block', flexShrink: 0,
    }}>
      {rT >= 0 && (
        <div style={{
          position: 'absolute', inset: -size * 0.18, borderRadius: '50%',
          border: '1.5px solid #F09173',
          opacity: rOp, transform: `scale(${rScale})`, pointerEvents: 'none',
        }} />
      )}
      <img
        src="assets/inktracker-logo.png"
        alt="InkTracker"
        style={{
          width: '100%', height: '100%', objectFit: 'contain',
          transform: `translateY(${bobY}px) scale(${breathe})`,
          transformOrigin: 'center 60%',
          display: 'block',
        }}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sidebar — matches the real Production nav layout
// ────────────────────────────────────────────────────────────────────────────

const PSIDEBAR = [
  { label: 'Dashboard',   icon: 'home'  },
  { label: 'Quotes',      icon: 'doc'   },
  { label: 'Production',  icon: 'box'   },
  { label: 'Customers',   icon: 'users' },
  { label: 'Inventory',   icon: 'arch'  },
  { label: 'Invoices',    icon: 'cash'  },
  { label: 'Performance', icon: 'chart' },
  { label: 'Mockups',     icon: 'paint' },
  { label: 'Wizard',      icon: 'wand'  },
  { label: 'Embed',       icon: 'code'  },
  { label: 'Account',     icon: 'cog'   },
  { label: 'Admin',       icon: 'shield', special: true },
];

function PNavIcon({ kind, active }) {
  const c = active ? '#fff' : PC.text3;
  const p = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: c, strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (kind) {
    case 'home':   return <svg {...p}><path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-4v-7H8v7H4a1 1 0 01-1-1z"/></svg>;
    case 'doc':    return <svg {...p}><path d="M7 3h8l4 4v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1zM14 3v5h5"/></svg>;
    case 'box':    return <svg {...p}><path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>;
    case 'users':  return <svg {...p}><circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="8" r="2.6"/><path d="M15 14c2 0 6 2 6 5"/></svg>;
    case 'arch':   return <svg {...p}><rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v12a1 1 0 001 1h12a1 1 0 001-1V8M9 12h6"/></svg>;
    case 'cash':   return <svg {...p}><rect x="2" y="6" width="20" height="12" rx="1"/><circle cx="12" cy="12" r="3"/><path d="M6 10v4M18 10v4"/></svg>;
    case 'chart':  return <svg {...p}><path d="M3 21h18M5 17V9M11 17V5M17 17v-6"/></svg>;
    case 'paint':  return <svg {...p}><path d="M19 11a8 8 0 11-16 0c0-4.4 3.6-8 8-8 4 0 6 2 6 4s-2 2-2 4 4 1 4 0z"/></svg>;
    case 'wand':   return <svg {...p}><path d="M15 4l5 5-9 11-5-5z"/><path d="M3 21l3-3M14 5l5 5"/></svg>;
    case 'code':   return <svg {...p}><path d="M8 6L2 12l6 6M16 6l6 6-6 6M14 4l-4 16"/></svg>;
    case 'cog':    return <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>;
    case 'shield': return <svg {...p}><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z"/><path d="M9 12l2 2 4-4"/></svg>;
    default: return null;
  }
}

function PSidebar() {
  return (
    <div style={{
      position: 'absolute', left: 0, top: 0, bottom: 0, width: 240,
      borderRight: `1px solid ${PC.border}`,
      background: PC.surface,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Brand header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '18px 18px 16px',
        borderBottom: `1px solid ${PC.border}`,
      }}>
        <PFlameMark size={28} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontFamily: PFONT, fontSize: 14, fontWeight: 700, color: PC.text1, letterSpacing: '-0.01em' }}>Biota Mfg</span>
          <span style={{ fontFamily: PFONT, fontSize: 11, color: PC.text3, letterSpacing: '0.02em' }}>Shop Manager</span>
        </div>
      </div>
      {/* Nav */}
      <div style={{ padding: 10, flex: 1 }}>
        {PSIDEBAR.map(it => {
          const isActive = it.label === 'Production';
          const isSpecial = it.special;
          return (
            <div key={it.label} style={{
              display: 'flex', alignItems: 'center', gap: 11,
              padding: '9px 10px',
              margin: '1px 0',
              borderRadius: 8,
              background: isActive ? PC.accent : 'transparent',
              color: isActive ? '#fff' : (isSpecial ? '#7C3AED' : PC.text2),
              fontFamily: PFONT, fontSize: 13.5, fontWeight: isActive ? 600 : (isSpecial ? 600 : 500),
            }}>
              <PNavIcon kind={it.icon} active={isActive} />
              <span>{it.label}</span>
            </div>
          );
        })}
      </div>
      {/* Search */}
      <div style={{ padding: 10, borderTop: `1px solid ${PC.border}` }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 10px',
          background: PC.surface2,
          border: `1px solid ${PC.border}`,
          borderRadius: 8,
          fontFamily: PFONT, fontSize: 13, color: PC.text3,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={PC.text3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          Search…
        </div>
      </div>
      <div style={{
        padding: '6px 14px 10px',
        fontFamily: PMONO, fontSize: 10, color: PC.text4, letterSpacing: '0.06em',
      }}>v1.0</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// App window chrome
// ────────────────────────────────────────────────────────────────────────────

function PAppWindow({ width, height, x, y, title = 'InkTracker', children, opacity = 1, transform = '' }) {
  return (
    <div style={{
      position: 'absolute',
      left: x, top: y, width, height,
      transform, opacity,
      background: PC.surface,
      border: `1px solid ${PC.border}`,
      borderRadius: 14,
      overflow: 'hidden',
      boxShadow: '0 24px 60px rgba(15,23,42,0.18), 0 4px 12px rgba(15,23,42,0.06)',
    }}>
      <div style={{
        height: 38, display: 'flex', alignItems: 'center',
        padding: '0 14px', gap: 12,
        borderBottom: `1px solid ${PC.border}`,
        background: PC.surface2,
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ width: 11, height: 11, borderRadius: 6, background: '#FF6058' }} />
          <div style={{ width: 11, height: 11, borderRadius: 6, background: '#FFBE2F' }} />
          <div style={{ width: 11, height: 11, borderRadius: 6, background: '#28C940' }} />
        </div>
        <div style={{ fontFamily: PFONT, fontSize: 12, color: PC.text3 }}>{title}</div>
      </div>
      <div style={{ position: 'relative', width: '100%', height: 'calc(100% - 38px)', background: PC.appBg }}>
        {children}
      </div>
    </div>
  );
}

// View toggle (Calendar / Table / Floor) — top-right pill cluster
function PViewToggle({ active = 'calendar' }) {
  const items = [
    { id: 'calendar', label: 'Calendar', icon: 'cal'   },
    { id: 'table',    label: 'Table',    icon: 'rows'  },
    { id: 'floor',    label: 'Floor',    icon: 'hammer'},
  ];
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      {items.map(it => {
        const on = it.id === active;
        return (
          <div key={it.id} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 16px',
            borderRadius: 10,
            background: on ? PC.accent : PC.surface,
            color: on ? '#fff' : PC.text2,
            border: `1px solid ${on ? PC.accent : PC.border}`,
            fontFamily: PFONT, fontSize: 14, fontWeight: 600,
            whiteSpace: 'nowrap',
            boxShadow: on ? '0 4px 14px rgba(79,70,229,0.30)' : 'none',
          }}>
            <ViewIcon kind={it.icon} active={on} />
            {it.label}
          </div>
        );
      })}
    </div>
  );
}

function ViewIcon({ kind, active }) {
  const c = active ? '#fff' : PC.text2;
  const p = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: c, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (kind === 'cal')   return <svg {...p}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>;
  if (kind === 'rows')  return <svg {...p}><path d="M3 6h18M3 12h18M3 18h18"/></svg>;
  if (kind === 'hammer')return <svg {...p}><path d="M14 4l6 6-3 3-6-6zM11 7l-7 7v4h4l7-7"/></svg>;
  return null;
}

// Page title block, repeated across views
function PageHeader({ view = 'calendar' }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      padding: '32px 44px 18px',
    }}>
      <div>
        <div style={{
          fontFamily: PFONT, fontSize: 30, fontWeight: 700,
          color: PC.text1, letterSpacing: '-0.025em', marginBottom: 6,
        }}>Production</div>
        <div style={{ fontFamily: PFONT, fontSize: 14, color: PC.text3 }}>
          View and manage orders in calendar or table view
        </div>
      </div>
      <PViewToggle active={view} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SCENE 1 — HOOK (0:00–0:03)
// ────────────────────────────────────────────────────────────────────────────

function ScenePHook() {
  const { localTime } = useSprite();
  const head1 = 'Every job.';
  const head2 = 'Every stage.';

  const t1Start = 0.4, t1End = 1.5;
  const t2Start = 1.6, t2End = 2.4;
  const t1 = clamp((localTime - t1Start) / (t1End - t1Start), 0, 1);
  const t2 = clamp((localTime - t2Start) / (t2End - t2Start), 0, 1);
  const visible1 = head1.slice(0, Math.floor(t1 * head1.length));
  const visible2 = head2.slice(0, Math.floor(t2 * head2.length));

  const blink = (localTime % 0.9) < 0.5;
  const cursorOnLine2 = localTime >= t1End - 0.05;
  const showCursor = localTime < t2End ? true : blink;

  const brand = clamp((localTime - 0.15) / 0.5, 0, 1);

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: PC.darkBg,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <PBgGrid dark />

      <div style={{
        opacity: brand,
        transform: `translateY(${(1 - brand) * 6}px)`,
        display: 'flex', alignItems: 'center', gap: 10,
        marginBottom: 36,
      }}>
        <PFlameMark size={26} animate time={localTime} />
        <span style={{
          fontFamily: PFONT, fontSize: 16, fontWeight: 600,
          color: PC.darkText1, letterSpacing: '-0.01em',
        }}>InkTracker</span>
      </div>

      <div style={{
        fontFamily: PFONT, fontSize: 96, fontWeight: 700,
        letterSpacing: '-0.04em',
        lineHeight: 1.08,
        textAlign: 'center',
      }}>
        <div style={{ color: PC.darkText1, whiteSpace: 'nowrap' }}>
          <span>{visible1}</span>
          {!cursorOnLine2 && (
            <span style={{
              display: 'inline-block', width: 6, height: 84,
              marginLeft: 8, background: PC.accent,
              opacity: showCursor ? 1 : 0,
              transform: 'translateY(10px)',
              borderRadius: 1, verticalAlign: 'baseline',
            }} />
          )}
        </div>
        <div style={{ color: PC.accent, whiteSpace: 'nowrap', marginTop: 6 }}>
          <span>{visible2}</span>
          {cursorOnLine2 && (
            <span style={{
              display: 'inline-block', width: 6, height: 84,
              marginLeft: 8, background: PC.accent,
              opacity: showCursor ? 1 : 0,
              transform: 'translateY(10px)',
              borderRadius: 1, verticalAlign: 'baseline',
            }} />
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SCENE 2 — CALENDAR FILLING (0:03–0:10)
// May 2026 calendar. Jobs land in waves across weeks.
// ────────────────────────────────────────────────────────────────────────────

// May 2026: 1st is a Fri. Build the 6-row grid.
// Cells are indexed 0..41 where idx 5 = Fri May 1.
const MAY_FIRST_OFFSET = 5;
const MAY_DAYS = 31;
function dayInCell(idx) {
  const d = idx - MAY_FIRST_OFFSET + 1;
  if (d < 1 || d > MAY_DAYS) return null;
  return d;
}

// Calendar event scaffold — { day, label, tone, landAt }
// Stagger landing so calendar 'fills up' across 6 seconds.
// Today = May 11. No Due events before today; all on-track.
const CAL_EVENTS = [
  // Week 2 — upcoming prep work, no Dues yet
  { day: 4,  label: 'Riverstone · Order Goods',     tone: 'calAmber',  landAt: 0.10 },
  { day: 5,  label: 'North Loop Coffee · Art',      tone: 'calPurple', landAt: 0.25 },
  { day: 6,  label: 'Summit Athletic · Mockup',     tone: 'calPurple', landAt: 0.40 },
  { day: 7,  label: 'Maple Grove · Pre-Press',      tone: 'calBlue',   landAt: 0.55 },
  { day: 8,  label: 'Blue Heron · Art',             tone: 'calPurple', landAt: 0.70 },
  { day: 9,  label: 'Pacific Trade · Mockup',       tone: 'calPurple', landAt: 0.85 },
  // Week 3 — today is May 11
  { day: 11, label: 'Granite Peak · Pre-Press',     tone: 'calBlue',   landAt: 1.00 },
  { day: 12, label: 'Lakeside School · Pre-Press',  tone: 'calBlue',   landAt: 1.15 },
  { day: 13, label: 'Maple Grove · Due',            tone: 'calRed',    landAt: 1.30 },
  { day: 14, label: 'Copper Canyon · Print',        tone: 'calOrange', landAt: 1.45 },
  { day: 14, label: 'Eastside FC · Print',          tone: 'calOrange', landAt: 1.60 },
  { day: 15, label: 'Foxglove Florist · Finishing', tone: 'calOrange', landAt: 1.75 },
  { day: 15, label: 'Highland Dental · QC',         tone: 'calBlue',   landAt: 1.90 },
  { day: 16, label: 'Cobalt Cycling · QC',          tone: 'calBlue',   landAt: 2.05 },
  // Week 4
  { day: 18, label: 'Riverstone · Due',             tone: 'calRed',    landAt: 2.20 },
  { day: 19, label: 'North Loop · Due',             tone: 'calRed',    landAt: 2.30 },
  { day: 19, label: 'Tidewater Surf · Due',         tone: 'calRed',    landAt: 2.40 },
  { day: 20, label: 'Summit Athletic · Due',        tone: 'calRed',    landAt: 2.50 },
  { day: 20, label: 'Bayview Const. · Pickup',      tone: 'calGreen',  landAt: 2.60 },
  { day: 21, label: 'Blue Heron · Due',             tone: 'calRed',    landAt: 2.70 },
  { day: 21, label: 'Sunset Ridge · Pickup',        tone: 'calGreen',  landAt: 2.80 },
  { day: 22, label: 'Pacific Trade · Due',          tone: 'calRed',    landAt: 2.90 },
  { day: 22, label: 'Granite Peak · Due',           tone: 'calRed',    landAt: 3.00 },
  { day: 23, label: 'Lakeside School · Due',        tone: 'calRed',    landAt: 3.10 },
  // Week 5
  { day: 25, label: 'Copper Canyon · Due',          tone: 'calRed',    landAt: 3.20 },
  { day: 25, label: 'Eastside FC · Due',            tone: 'calRed',    landAt: 3.30 },
  { day: 26, label: 'Foxglove Florist · Due',       tone: 'calRed',    landAt: 3.40 },
  { day: 27, label: 'Highland Dental · Due',        tone: 'calRed',    landAt: 3.50 },
  { day: 27, label: 'Cobalt Cycling · Due',         tone: 'calRed',    landAt: 3.60 },
  { day: 28, label: 'Ironwood Gym · Finishing',     tone: 'calOrange', landAt: 3.70 },
  { day: 28, label: 'Bayview Const. · Due',         tone: 'calRed',    landAt: 3.80 },
];

function SceneCalendar() {
  const { localTime, duration } = useSprite();
  const winFade = clamp(localTime / 0.5, 0, 1);
  const winOut = clamp((localTime - duration + 0.4) / 0.4, 0, 1);
  const winOpacity = winFade * (1 - winOut);

  // Subtle slide-out toward the table view
  const slideOut = clamp((localTime - duration + 0.5) / 0.5, 0, 1);
  const slideX = -slideOut * 80;

  // Build a day → events map for layout
  const byDay = {};
  for (const ev of CAL_EVENTS) {
    (byDay[ev.day] = byDay[ev.day] || []).push(ev);
  }

  return (
    <div style={{
      position: 'absolute', inset: 0, background: PC.appBg,
      transform: `translateX(${slideX}px)`,
    }}>
      <PAppWindow
        x={120} y={70}
        width={1680} height={940}
        title="InkTracker — Production · Calendar"
        opacity={winOpacity}
      >
        <PSidebar />

        <div style={{ position: 'absolute', left: 240, top: 0, right: 0, bottom: 0 }}>
          <PageHeader view="calendar" />

          {/* Month strip */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 18,
            padding: '4px 44px 14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ArrowBtn dir="left" />
              <div style={{
                padding: '8px 16px', borderRadius: 10,
                background: PC.surface, border: `1px solid ${PC.border}`,
                fontFamily: PFONT, fontSize: 13.5, fontWeight: 600, color: PC.accent,
              }}>Today</div>
              <ArrowBtn dir="right" />
            </div>
            <div style={{
              fontFamily: PFONT, fontSize: 22, fontWeight: 600,
              color: PC.text1, letterSpacing: '-0.02em',
            }}>May 2026</div>
          </div>

          {/* Calendar grid */}
          <div style={{
            position: 'absolute',
            left: 44, right: 44, top: 200, bottom: 32,
            background: PC.surface,
            border: `1px solid ${PC.border}`,
            borderRadius: 12,
            overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Day-of-week header */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
              borderBottom: `1px solid ${PC.border}`,
              background: PC.surface2,
            }}>
              {['SUN','MON','TUE','WED','THU','FRI','SAT'].map(d => (
                <div key={d} style={{
                  padding: '10px 14px',
                  fontFamily: PFONT, fontSize: 11, fontWeight: 600,
                  color: PC.text3, letterSpacing: '0.14em',
                }}>{d}</div>
              ))}
            </div>
            {/* 6-row grid */}
            <div style={{
              flex: 1,
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gridAutoRows: '1fr',
            }}>
              {Array.from({ length: 42 }).map((_, idx) => {
                const day = dayInCell(idx);
                const isToday = day === 11;
                const events = day ? (byDay[day] || []) : [];
                return (
                  <div key={idx} style={{
                    borderRight: `1px solid ${PC.border}`,
                    borderBottom: `1px solid ${PC.border}`,
                    padding: '6px 8px',
                    position: 'relative',
                    background: PC.surface,
                  }}>
                    {day != null && (
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
                        marginBottom: 4,
                      }}>
                        <div style={{
                          width: isToday ? 22 : 'auto',
                          height: isToday ? 22 : 'auto',
                          borderRadius: 11,
                          background: isToday ? PC.accent : 'transparent',
                          color: isToday ? '#fff' : PC.text2,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          padding: isToday ? 0 : '0 2px',
                          fontFamily: PFONT, fontSize: 12.5, fontWeight: isToday ? 700 : 500,
                          fontVariantNumeric: 'tabular-nums',
                        }}>{day}</div>
                      </div>
                    )}
                    {/* Events */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {events.map((ev, i) => {
                        const t = clamp((localTime - ev.landAt) / 0.25, 0, 1);
                        const e = Easing.easeOutBack ? Easing.easeOutBack(t) : t;
                        const tone = PC[ev.tone];
                        return (
                          <div key={i} style={{
                            opacity: t,
                            transform: `translateY(${(1 - e) * -6}px) scale(${0.92 + 0.08 * e})`,
                            transformOrigin: 'left center',
                            background: tone.bg,
                            border: `1px solid ${tone.br}`,
                            color: tone.fg,
                            borderRadius: 5,
                            padding: '3px 7px',
                            fontFamily: PFONT, fontSize: 10.5, fontWeight: 600,
                            letterSpacing: '-0.005em',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>{ev.label}</div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </PAppWindow>

      {/* Caption */}
      <SceneCaption text="See every job across the month — one glance." time={localTime} duration={duration} delay={0.6} />
    </div>
  );
}

function ArrowBtn({ dir }) {
  return (
    <div style={{
      width: 34, height: 34, borderRadius: 8,
      background: PC.surface, border: `1px solid ${PC.border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={PC.text2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {dir === 'left'
          ? <polyline points="15 18 9 12 15 6"/>
          : <polyline points="9 18 15 12 9 6"/>}
      </svg>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SCENE 3 — TABLE VIEW (0:10–0:16)
// Status filter chips · order rows · late ones highlighted in red
// ────────────────────────────────────────────────────────────────────────────

const STATUS_CHIPS = ['All','Art Approval','Order Goods','Pre-Press','Printing','Finishing','QC','Ready for Pickup','Completed'];

function SceneTable() {
  const { localTime, duration } = useSprite();
  const inT = clamp(localTime / 0.5, 0, 1);
  const outT = clamp((localTime - duration + 0.5) / 0.5, 0, 1);
  const opacity = inT * (1 - outT);

  // Subtle slide-in from right at scene start (continuation of calendar slide)
  const slideIn = 1 - inT;
  const slideX = slideIn * 80;

  // Filter "Pre-Press" gets clicked at ~2.0s — late rows light up
  const filterClickAt = 2.0;
  const filterT = clamp((localTime - filterClickAt) / 0.25, 0, 1);
  const isPrePress = filterT > 0.5;

  // Rows stagger in over the first second
  const rowStart = 0.4;
  const rowStep = 0.07;

  // Subset of clients to show (10 rows fits comfortably)
  const rows = [
    CLIENTS[0],  // Tahoe Gift Co · Art
    CLIENTS[1],  // OTRA · Order
    CLIENTS[2],  // PSTRM · Art
    CLIENTS[3],  // Alex Cordova · Art (late)
    CLIENTS[4],  // Kilroy VTG · Prep (late)
    CLIENTS[5],  // Pinion School · Prep (late)
    CLIENTS[6],  // Beloved's · Prep (late)
    CLIENTS[7],  // Marigold · Print
    CLIENTS[8],  // Coastline · Print
    CLIENTS[10], // Halverson · QC
  ];

  return (
    <div style={{
      position: 'absolute', inset: 0, background: PC.appBg,
      transform: `translateX(${slideX}px)`,
      opacity,
    }}>
      <PAppWindow
        x={120} y={70}
        width={1680} height={940}
        title="InkTracker — Production · Table"
      >
        <PSidebar />

        <div style={{ position: 'absolute', left: 240, top: 0, right: 0, bottom: 0 }}>
          <PageHeader view="table" />

          {/* Status filter chips */}
          <div style={{
            padding: '10px 44px 8px',
            display: 'flex', flexWrap: 'wrap', gap: 8,
          }}>
            {STATUS_CHIPS.map((label, i) => {
              const isAll = label === 'All';
              const isPrep = label === 'Pre-Press';
              const on = isPrePress ? isPrep : isAll;
              // Click animation pulse around filterClickAt
              const pulse = isPrep && Math.abs(localTime - filterClickAt) < 0.3
                ? 1 - Math.abs(localTime - filterClickAt) / 0.3 : 0;
              return (
                <div key={label} style={{
                  padding: '8px 14px',
                  borderRadius: 999,
                  background: on ? PC.text1 : PC.surface,
                  border: `1px solid ${on ? PC.text1 : PC.border}`,
                  color: on ? '#fff' : PC.text2,
                  fontFamily: PFONT, fontSize: 13, fontWeight: 600,
                  whiteSpace: 'nowrap',
                  boxShadow: pulse > 0 ? `0 0 0 ${4 * pulse}px rgba(79,70,229,0.18)` : 'none',
                  position: 'relative',
                  transition: 'background 200ms, color 200ms, border-color 200ms',
                }}>
                  {label}
                  {/* Click cursor on Pre-Press */}
                  {isPrep && localTime > filterClickAt - 0.3 && localTime < filterClickAt + 0.2 && (
                    <div style={{
                      position: 'absolute',
                      right: -18, top: 16,
                      pointerEvents: 'none',
                    }}>
                      <CursorPointerSmall />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Internal/Broker */}
          <div style={{
            padding: '8px 44px 12px',
            display: 'flex', gap: 8,
          }}>
            {['All','Internal','Broker'].map((l, i) => (
              <div key={l} style={{
                padding: '7px 14px',
                borderRadius: 999,
                background: i === 0 ? PC.text1 : PC.surface,
                color: i === 0 ? '#fff' : PC.text2,
                border: `1px solid ${i === 0 ? PC.text1 : PC.border}`,
                fontFamily: PFONT, fontSize: 12.5, fontWeight: 600,
                whiteSpace: 'nowrap',
              }}>{l}</div>
            ))}
          </div>

          {/* Table */}
          <div style={{
            position: 'absolute',
            left: 44, right: 44, top: 280, bottom: 32,
            background: PC.surface,
            border: `1px solid ${PC.border}`,
            borderRadius: 12,
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '50px 220px 1fr 180px 120px 180px 90px',
              padding: '14px 22px',
              borderBottom: `1px solid ${PC.border}`,
              fontFamily: PFONT, fontSize: 11.5, fontWeight: 600,
              color: PC.text3, letterSpacing: '0.12em',
            }}>
              <div></div>
              <div>ORDER ID</div>
              <div>CUSTOMER</div>
              <div>DUE</div>
              <div>PRESS</div>
              <div>STATUS</div>
              <div></div>
            </div>
            {/* Rows */}
            {rows.map((r, i) => {
              const t = clamp((localTime - rowStart - i * rowStep) / 0.3, 0, 1);
              const e = Easing.easeOutCubic(t);
              const dim = isPrePress && r.stage !== 'prep';
              const highlight = isPrePress && r.stage === 'prep';
              const stage = STAGE_MAP[r.stage];
              return (
                <div key={r.id} style={{
                  display: 'grid',
                  gridTemplateColumns: '50px 220px 1fr 180px 120px 180px 90px',
                  alignItems: 'center',
                  padding: '14px 22px',
                  borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${PC.border}`,
                  fontFamily: PFONT, fontSize: 14,
                  background: r.late ? '#FEF2F2' : (highlight ? PC.accentSofter : PC.surface),
                  opacity: t * (dim ? 0.35 : 1),
                  transform: `translateY(${(1 - e) * 8}px)`,
                  transition: 'background 250ms, opacity 250ms',
                }}>
                  <div>
                    <div style={{
                      width: 18, height: 18, borderRadius: 4,
                      border: `1.5px solid ${PC.borderStrong}`,
                      background: PC.surface,
                    }} />
                  </div>
                  <div style={{ fontFamily: PMONO, fontSize: 12.5, color: PC.text3, fontWeight: 500 }}>
                    {r.id}
                  </div>
                  <div style={{ fontWeight: 700, color: PC.text1 }}>{r.name}</div>
                  <div style={{
                    fontVariantNumeric: 'tabular-nums',
                    color: r.late ? '#DC2626' : PC.text2,
                    fontWeight: r.late ? 700 : 500,
                  }}>
                    {r.due}, 2026
                    {r.late && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 800, letterSpacing: '0.08em' }}>LATE</span>}
                  </div>
                  <div style={{ color: PC.text4, fontWeight: 600 }}>—</div>
                  <div>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center',
                      padding: '4px 12px',
                      borderRadius: 999,
                      background: stage.bg, color: stage.fg,
                      fontFamily: PFONT, fontSize: 12, fontWeight: 600,
                    }}>{stage.label}</span>
                  </div>
                  <div style={{
                    color: PC.accent, fontWeight: 600, fontSize: 13,
                    textAlign: 'right',
                  }}>View →</div>
                </div>
              );
            })}
          </div>
        </div>
      </PAppWindow>

      <SceneCaption
        text={isPrePress
          ? 'Filter by stage — find every Pre-Press job instantly.'
          : 'One table. Every order. Every status.'}
        time={localTime} duration={duration} delay={0.6}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SCENE 4 — FLOOR / JOB TICKET (0:16–0:21)
// Side list of orders + job ticket panel with size breakdowns & progress dots
// ────────────────────────────────────────────────────────────────────────────

function SceneFloor() {
  const { localTime, duration } = useSprite();
  const inT = clamp(localTime / 0.5, 0, 1);
  const outT = clamp((localTime - duration + 0.5) / 0.5, 0, 1);
  const opacity = inT * (1 - outT);

  // The list animates in first (~0.4s), then a click selects Coastline Surf Club (~1.3s),
  // ticket panel slides in (~1.5s), garment cards stagger in (~1.8s),
  // progress dots fill in (~2.5s onward).
  const clickAt = 1.3;
  const ticketAt = 1.5;
  const cardStart = 1.8;
  const dotStart = 2.6;

  const ticketT = clamp((localTime - ticketAt) / 0.5, 0, 1);

  // Floor list shows 7 clients
  const list = [
    CLIENTS[0], CLIENTS[1], CLIENTS[2], CLIENTS[3], CLIENTS[4],
    CLIENTS[5], CLIENTS[6], CLIENTS[8], // Coastline at idx 7 — selected
  ];
  const selectedIdx = 7;

  return (
    <div style={{ position: 'absolute', inset: 0, background: PC.appBg, opacity }}>
      <PAppWindow
        x={120} y={70}
        width={1680} height={940}
        title="InkTracker — Production · Floor"
      >
        <PSidebar />

        <div style={{ position: 'absolute', left: 240, top: 0, right: 0, bottom: 0 }}>
          <PageHeader view="floor" />

          {/* Tabs */}
          <div style={{
            padding: '6px 44px 14px',
            display: 'flex', gap: 8,
          }}>
            <div style={{
              padding: '8px 16px', borderRadius: 999,
              background: PC.surface, border: `1px solid ${PC.border}`,
              fontFamily: PFONT, fontSize: 13.5, color: PC.text2, fontWeight: 600,
            }}>Active (8)</div>
            <div style={{
              padding: '8px 16px', borderRadius: 999,
              background: PC.accent, color: '#fff',
              fontFamily: PFONT, fontSize: 13.5, fontWeight: 600,
            }}>All</div>
            <div style={{
              padding: '8px 16px', borderRadius: 999,
              background: PC.surface, border: `1px solid ${PC.border}`,
              fontFamily: PFONT, fontSize: 13.5, color: PC.text2, fontWeight: 600,
            }}>Completed</div>
          </div>

          {/* Two-pane area */}
          <div style={{
            position: 'absolute',
            left: 44, right: 44, top: 250, bottom: 32,
            background: PC.surface,
            border: `1px solid ${PC.border}`,
            borderRadius: 12,
            display: 'grid',
            gridTemplateColumns: '420px 1fr',
            overflow: 'hidden',
          }}>
            {/* Left: order list */}
            <div style={{
              borderRight: `1px solid ${PC.border}`,
              overflow: 'hidden',
              position: 'relative',
            }}>
              {list.map((r, i) => {
                const t = clamp((localTime - 0.3 - i * 0.05) / 0.3, 0, 1);
                const e = Easing.easeOutCubic(t);
                const isSel = i === selectedIdx && localTime > clickAt;
                const stage = STAGE_MAP[r.stage];
                return (
                  <div key={r.id} style={{
                    position: 'relative',
                    padding: '16px 18px',
                    borderBottom: i === list.length - 1 ? 'none' : `1px solid ${PC.border}`,
                    background: isSel ? PC.accentSofter : (r.late ? '#FEF2F2' : PC.surface),
                    opacity: t,
                    transform: `translateX(${(1 - e) * -10}px)`,
                  }}>
                    {/* Selected accent bar */}
                    {isSel && (
                      <div style={{
                        position: 'absolute', left: 0, top: 0, bottom: 0,
                        width: 3, background: PC.accent,
                      }} />
                    )}
                    <div style={{
                      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                      marginBottom: 6, gap: 12,
                    }}>
                      <div style={{
                        fontFamily: PFONT, fontSize: 15, fontWeight: 700, color: PC.text1,
                      }}>{r.name}</div>
                      <span style={{
                        flexShrink: 0,
                        padding: '3px 10px', borderRadius: 999,
                        background: stage.bg, color: stage.fg,
                        fontFamily: PFONT, fontSize: 11.5, fontWeight: 600,
                      }}>{stage.label}</span>
                    </div>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      fontFamily: PFONT, fontSize: 12.5, color: PC.text3,
                      whiteSpace: 'nowrap',
                    }}>
                      <span style={{ fontFamily: PMONO, fontSize: 11.5 }}>
                        {r.id} · {r.pcs} pcs
                      </span>
                      <span style={{ color: r.late ? '#DC2626' : PC.text3, fontWeight: r.late ? 700 : 500 }}>
                        {r.late ? `LATE · Due ${r.due}` : `Due ${r.due}, 2026`}
                      </span>
                    </div>
                    {/* Click cursor on Coastline */}
                    {i === selectedIdx && localTime > clickAt - 0.3 && localTime < clickAt + 0.2 && (
                      <div style={{
                        position: 'absolute',
                        right: 30, top: 24,
                        pointerEvents: 'none',
                      }}>
                        <CursorPointerSmall />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Right: ticket panel */}
            <div style={{
              position: 'relative',
              padding: '24px 28px',
              overflow: 'hidden',
              opacity: ticketT,
              transform: `translateX(${(1 - ticketT) * 20}px)`,
            }}>
              <div style={{
                fontFamily: PFONT, fontSize: 11, color: PC.text3,
                textTransform: 'uppercase', letterSpacing: '0.16em', fontWeight: 600,
                marginBottom: 16,
              }}>Job Ticket — Coastline Surf Club · ORD-2026-CSTLN</div>

              {/* Garment cards */}
              <GarmentCard
                idx={0} cardStart={cardStart} dotStart={dotStart} localTime={localTime}
                title="American Apparel 307gd"
                color="Faded Navy"
                decos={['Left Chest · 1c · Screen Print', 'Back · 1c · Screen Print']}
                sizes={[
                  { s: 'S', qty: 4, dots: 2, total: 2 },
                  { s: 'M', qty: 4, dots: 2, total: 2 },
                  { s: 'L', qty: 3, dots: 2, total: 2 },
                  { s: 'XL', qty: 1, dots: 2, total: 2 },
                  { s: '2XL', qty: 1, dots: 2, total: 2 },
                ]}
              />
              <GarmentCard
                idx={1} cardStart={cardStart + 0.2} dotStart={dotStart + 0.3} localTime={localTime}
                title="AS Colour 5161"
                color="PINE GREEN"
                decos={['Left Chest · 1c · Screen Print', 'Back · 1c · Screen Print', 'Right Sleeve · 1c · Screen Print']}
                sizes={[
                  { s: 'S', qty: 4, dots: 2, total: 3 },
                  { s: 'M', qty: 3, dots: 2, total: 3 },
                  { s: 'L', qty: 2, dots: 2, total: 3 },
                  { s: 'XL', qty: 1, dots: 2, total: 3 },
                ]}
              />
            </div>
          </div>
        </div>
      </PAppWindow>

      <SceneCaption
        text="Pop open any job — sizes, decorations, real-time progress."
        time={localTime} duration={duration} delay={2.4}
      />
    </div>
  );
}

function GarmentCard({ idx, cardStart, dotStart, localTime, title, color, decos, sizes }) {
  const cardT = clamp((localTime - cardStart - idx * 0.15) / 0.4, 0, 1);
  const cardE = Easing.easeOutCubic(cardT);
  const totalQty = sizes.reduce((a, b) => a + b.qty, 0);

  return (
    <div style={{
      background: PC.surface,
      border: `1px solid ${PC.border}`,
      borderRadius: 12,
      padding: '18px 20px',
      marginBottom: 14,
      opacity: cardT,
      transform: `translateY(${(1 - cardE) * 14}px)`,
      boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12,
      }}>
        <div style={{
          fontFamily: PFONT, fontSize: 18, fontWeight: 700, color: PC.text1,
        }}>{title} — <span style={{ color: PC.text2, fontWeight: 600 }}>{color}</span></div>
        <div style={{
          fontFamily: PFONT, fontSize: 22, fontWeight: 700, color: PC.accent,
          fontVariantNumeric: 'tabular-nums',
        }}>{totalQty}</div>
      </div>

      {/* Decoration chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {decos.map(d => (
          <div key={d} style={{
            padding: '5px 12px',
            border: `1px solid ${PC.border}`,
            background: PC.surface2,
            borderRadius: 999,
            fontFamily: PFONT, fontSize: 12, color: PC.text2, fontWeight: 500,
            whiteSpace: 'nowrap',
          }}>{d}</div>
        ))}
      </div>

      {/* Size pills */}
      <div style={{ display: 'flex', gap: 12 }}>
        {sizes.map((sz, i) => {
          const filled = Math.min(sz.dots, Math.floor((localTime - dotStart - i * 0.15) / 0.18));
          const done = filled >= sz.total;
          return (
            <div key={sz.s} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            }}>
              <div style={{
                minWidth: 72, padding: '8px 14px',
                background: done ? '#DCFCE7' : '#FEF3C7',
                border: `1.5px solid ${done ? '#86EFAC' : '#FDE68A'}`,
                borderRadius: 10,
                fontFamily: PFONT, fontSize: 15, fontWeight: 700,
                color: done ? '#166534' : '#92400E',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
              }}>
                {sz.s}: {sz.qty}
                {done && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </div>
              {/* Progress dots */}
              <div style={{ display: 'flex', gap: 4 }}>
                {Array.from({ length: sz.total }).map((_, k) => {
                  const on = k < Math.max(0, filled);
                  return (
                    <div key={k} style={{
                      width: 9, height: 9, borderRadius: 5,
                      background: on ? '#22C55E' : '#E5E7EB',
                      transition: 'background 200ms',
                    }} />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SCENE 5 — LOCKUP (0:21–0:25)
// ────────────────────────────────────────────────────────────────────────────

function ScenePLockup() {
  const { localTime } = useSprite();
  const logoT = clamp(localTime / 0.7, 0, 1);
  const logoE = Easing.easeOutBack ? Easing.easeOutBack(logoT) : logoT;
  const tagT = clamp((localTime - 0.7) / 0.5, 0, 1);
  const btnT = clamp((localTime - 1.2) / 0.5, 0, 1);
  const footT = clamp((localTime - 1.6) / 0.4, 0, 1);
  const pulse = 0.5 + 0.5 * Math.sin(localTime * 3);

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: PC.darkBg,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <PBgGrid dark intense />

      <div style={{
        position: 'absolute',
        left: '50%', top: '42%',
        width: 1300, height: 700,
        transform: `translate(-50%, -50%) scale(${0.6 + 0.4 * logoE})`,
        background: 'radial-gradient(ellipse at center, rgba(79,70,229,0.30), transparent 60%)',
        opacity: logoE,
        filter: 'blur(20px)',
        pointerEvents: 'none',
      }} />

      {/* Pill */}
      <div style={{
        opacity: clamp((localTime - 1.55) / 0.4, 0, 1),
        marginBottom: 24,
        padding: '7px 14px',
        background: 'rgba(34,197,94,0.10)',
        border: '1px solid rgba(34,197,94,0.25)',
        borderRadius: 999,
        display: 'flex', alignItems: 'center', gap: 8,
        fontFamily: PFONT, fontSize: 13.5, fontWeight: 500, color: '#86EFAC',
        whiteSpace: 'nowrap',
      }}>
        <span style={{ width: 7, height: 7, borderRadius: 4, background: '#22C55E' }} />
        14-day free trial · No credit card required
      </div>

      {/* Logo + wordmark */}
      <div style={{
        opacity: logoE,
        transform: `scale(${0.85 + 0.15 * logoE})`,
        display: 'flex', alignItems: 'center', gap: 18,
        marginBottom: 28,
      }}>
        <PFlameMark size={88} animate time={localTime} ripple />
        <span style={{
          fontFamily: PFONT, fontSize: 80, fontWeight: 700,
          color: PC.darkText1, letterSpacing: '-0.04em',
        }}>InkTracker</span>
      </div>

      {/* Tagline */}

      <div style={{
        opacity: footT,
        marginTop: 48,
        fontFamily: PFONT, fontSize: 13,
        color: PC.darkText3,
        letterSpacing: '0.01em',
        whiteSpace: 'nowrap',
      }}>
        $99/mo after trial · Cancel anytime
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function PBgGrid({ dark = false, intense = false }) {
  const lineColor = dark
    ? `rgba(255,255,255,${intense ? 0.025 : 0.015})`
    : `rgba(15,23,42,${intense ? 0.04 : 0.025})`;
  return (
    <div style={{
      position: 'absolute', inset: 0,
      backgroundImage: `
        linear-gradient(${lineColor} 1px, transparent 1px),
        linear-gradient(90deg, ${lineColor} 1px, transparent 1px)
      `,
      backgroundSize: '64px 64px',
      pointerEvents: 'none',
      maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)',
      WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)',
    }} />
  );
}

function CursorPointer() {
  return (
    <svg width="22" height="28" viewBox="0 0 24 30" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.25))' }}>
      <path d="M2 2L22 14L13 16L10 26L2 2Z" fill="#0F172A" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  );
}
function CursorPointerSmall() {
  return (
    <svg width="18" height="22" viewBox="0 0 24 30" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.25))' }}>
      <path d="M2 2L22 14L13 16L10 26L2 2Z" fill="#0F172A" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  );
}

function SceneCaption({ text, time, duration, delay = 0.5 }) {
  const t = clamp((time - delay) / 0.4, 0, 1);
  const out = clamp((time - duration + 0.4) / 0.4, 0, 1);
  const op = t * (1 - out);
  return (
    <div style={{
      position: 'absolute',
      left: 0, right: 0, bottom: 36,
      display: 'flex', justifyContent: 'center',
      pointerEvents: 'none',
      opacity: op,
      transform: `translateY(${(1 - t) * 6}px)`,
    }}>
      <div style={{
        padding: '10px 22px',
        background: 'rgba(15,23,42,0.92)',
        borderRadius: 999,
        color: '#fff',
        fontFamily: PFONT, fontSize: 15, fontWeight: 500,
        letterSpacing: '-0.005em',
        boxShadow: '0 12px 36px rgba(15,23,42,0.30)',
        whiteSpace: 'nowrap',
      }}>{text}</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Top-level demo
// ────────────────────────────────────────────────────────────────────────────

function ProductionDemo() {
  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <Sprite start={0}    end={3.0}>  <ScenePHook /></Sprite>
      <Sprite start={3.0}  end={10.0}> <SceneCalendar /></Sprite>
      <Sprite start={10.0} end={16.0}> <SceneTable /></Sprite>
      <Sprite start={16.0} end={21.0}> <SceneFloor /></Sprite>
      <Sprite start={21.0} end={25.0}> <ScenePLockup /></Sprite>

      <ProdSceneIndicator />
    </>
  );
}

function ProdSceneIndicator() {
  const time = useTime();
  let label = '';
  if (time < 3) label = '';
  else if (time < 10) label = '01';
  else if (time < 16) label = '02';
  else if (time < 21) label = '03';
  else label = '';
  if (!label) return null;
  const isLight = time >= 3 && time < 21;
  return (
    <div style={{
      position: 'absolute',
      top: 32, right: 44,
      fontFamily: PMONO, fontSize: 11.5,
      color: isLight ? PC.text3 : PC.darkText3,
      letterSpacing: '0.18em',
      textTransform: 'uppercase',
      pointerEvents: 'none',
      zIndex: 100,
    }}>{label} / 03</div>
  );
}

window.ProductionDemo = ProductionDemo;
