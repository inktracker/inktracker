// customers-scenes.jsx — InkTracker Customer Management demo (~22s)
// Uses the same visual system as the other demos. Demo clients only.

const CM = {
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
  amber: '#D97706',
  amberSoft: '#FEF3C7',
  navy: '#0F172A',
  tagPurple: '#EDE9FE',
  tagPurpleText: '#5B21B6',
};
const CMF = '"Inter", system-ui, -apple-system, sans-serif';
const CMM = '"JetBrains Mono", ui-monospace, monospace';

function cmclamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function cmeaseOut(t) { return 1 - Math.pow(1 - t, 3); }

function CMLogo({ size = 32 }) {
  return <img src="assets/inktracker-logo.png" alt="" style={{ width: size, height: size, display: 'block', objectFit: 'contain', flexShrink: 0 }} />;
}

// ─── Demo customer roster (12 fictional) ───────────────────────────────────
const DEMO_CUSTOMERS = [
  { initials: 'AB', name: 'Aldenwood Bookstore',     contact: '',                       email: 'orders@aldenwood.example',     invoices: 4,  collected: '$2,840.00', tax: false, color: '#EEF2FF' },
  { initials: 'BC', name: 'Bayside Coffee Roasters', contact: 'Jonas Vega',             email: 'jonas@baysideroasters.example', invoices: 12, collected: '$9,402.50', tax: false, color: '#FEF3C7' },
  { initials: 'CR', name: 'Cypress Ridge HS',        contact: 'Erin Holloway',          email: 'eholloway@cypressridge.example.edu', invoices: 18, collected: '$24,108.75', tax: true,  color: '#DBEAFE' },
  { initials: 'DT', name: 'Driftwood Theatre Co.',   contact: 'Sasha Pham',             email: 'sasha@driftwoodtheatre.example', invoices: 6,  collected: '$3,915.00', tax: true,  color: '#FCE7F3' },
  { initials: 'EM', name: 'Evergreen Mountaineering', contact: 'Wes Carrillo',          email: 'wes@evergreenmtn.example',     invoices: 9,  collected: '$11,260.00', tax: false, color: '#DCFCE7' },
  { initials: 'FB', name: 'Foxtail Brewing',         contact: 'Hana Ito',               email: 'hana@foxtailbrew.example',     invoices: 7,  collected: '$5,830.20', tax: false, color: '#FFE4E6' },
  { initials: 'GA', name: 'Greenbriar Athletics',    contact: 'Diego Salas',            email: 'diego@greenbriar.example',     invoices: 22, collected: '$31,540.00', tax: false, color: '#E0E7FF' },
  { initials: 'HV', name: 'Harborview Yacht Club',   contact: 'Priya Mehta',            email: 'priya@harborviewyc.example',   invoices: 3,  collected: '$1,440.00', tax: true,  color: '#CFFAFE' },
  { initials: 'IB', name: 'Ironbark Cycling',        contact: 'Theo Brandt',            email: 'theo@ironbarkcycling.example', invoices: 5,  collected: '$2,275.00', tax: false, color: '#FED7AA' },
  { initials: 'JM', name: 'Juniper Montessori',      contact: 'Naomi Park',             email: 'naomi@junipermontessori.example', invoices: 14, collected: '$13,990.00', tax: true,  color: '#E9D5FF' },
  { initials: 'KH', name: 'Kestrel Hardware Co-op',  contact: 'Marcus Lin',             email: 'marcus@kestrelhardware.example', invoices: 8,  collected: '$4,610.00', tax: false, color: '#FEF3C7' },
  { initials: 'LF', name: 'Lakeshore Film Festival', contact: 'Brielle Okafor',         email: 'b.okafor@lakeshorefilm.example', invoices: 11, collected: '$18,775.50', tax: true,  color: '#DBEAFE' },
];

// ─── Sidebar (Customers active) ────────────────────────────────────────────
const CM_NAV = [
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
function CMNavIcon({ kind, color }) {
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
    case 'code':    return <svg {...p}><path d="M8 6L2 12l6 6M16 6l6 6-6 6M14 4l-4 16"/></svg>;
    case 'gear':    return <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M5 5l2 2M17 17l2 2M2 12h3M19 12h3M5 19l2-2M17 7l2-2"/></svg>;
    default: return null;
  }
}
function CMSidebar() {
  return (
    <div style={{
      position: 'absolute', left: 0, top: 0, bottom: 0, width: 232,
      borderRight: `1px solid ${CM.border}`, background: CM.surface,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 20px 18px' }}>
        <CMLogo size={36} />
        <div>
          <div style={{ fontFamily: CMF, fontSize: 16, fontWeight: 800, color: CM.text1, letterSpacing: '-0.015em' }}>Northwind Print</div>
          <div style={{ fontFamily: CMF, fontSize: 11.5, color: CM.text3, marginTop: 1 }}>Shop Manager</div>
        </div>
      </div>
      <div style={{ padding: '0 10px', flex: 1 }}>
        {CM_NAV.map((it) => {
          const a = it.label === 'Customers';
          return (
            <div key={it.label} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '11px 14px', borderRadius: 8, marginBottom: 2,
              background: a ? CM.accent : 'transparent',
            }}>
              <CMNavIcon kind={it.icon} color={a ? '#fff' : CM.text3} />
              <div style={{ fontFamily: CMF, fontSize: 14, fontWeight: a ? 700 : 500, color: a ? '#fff' : CM.text2 }}>{it.label}</div>
            </div>
          );
        })}
      </div>
      <div style={{ padding: '14px 16px', borderTop: `1px solid ${CM.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 34, background: CM.surface2, border: `1px solid ${CM.border}`, borderRadius: 8, display: 'flex', alignItems: 'center', padding: '0 10px', gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={CM.text3} strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
          <span style={{ fontFamily: CMF, fontSize: 12, color: CM.text3 }}>Search…</span>
        </div>
      </div>
    </div>
  );
}

// ─── App chrome wrapper ────────────────────────────────────────────────────
function CMApp({ children, opacity = 1 }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: CM.appBg, opacity }}>
      <CMSidebar />
      <div style={{ position: 'absolute', left: 232, right: 0, top: 0, bottom: 0, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

// ─── Customer card ─────────────────────────────────────────────────────────
function CustCard({ c, highlight, dim }) {
  return (
    <div style={{
      background: CM.surface, border: highlight ? `2px solid ${CM.accent}` : `1px solid ${CM.border}`,
      borderRadius: 14, padding: '20px 22px',
      boxShadow: highlight ? '0 14px 32px rgba(79,70,229,0.18)' : '0 1px 2px rgba(15,23,42,0.04)',
      opacity: dim ? 0.42 : 1,
      transition: 'all 0.25s',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12, background: c.color,
          display: 'grid', placeItems: 'center',
          fontFamily: CMF, fontSize: 15, fontWeight: 800, color: CM.text1, letterSpacing: '0.02em',
        }}>{c.initials}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: CMF, fontSize: 16, fontWeight: 800, color: CM.text1, letterSpacing: '-0.015em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
          {c.contact && <div style={{ fontFamily: CMF, fontSize: 12.5, color: CM.text3, marginTop: 1 }}>{c.contact}</div>}
        </div>
      </div>
      <div style={{ background: CM.surface2, border: `1px solid ${CM.border}`, borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={CM.text3} strokeWidth="1.8"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 8l9 6 9-6"/></svg>
        <div style={{ fontFamily: CMF, fontSize: 12.5, color: CM.text2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.email}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ fontFamily: CMF, fontSize: 22, fontWeight: 800, color: CM.accent, letterSpacing: '-0.02em' }}>{c.invoices}</div>
          <div style={{ fontFamily: CMF, fontSize: 11, color: CM.text3, fontWeight: 500 }}>invoices</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
          <div style={{ fontFamily: CMF, fontSize: 18, fontWeight: 800, color: CM.green, letterSpacing: '-0.015em' }}>{c.collected}</div>
          <div style={{ fontFamily: CMF, fontSize: 11, color: CM.text3, fontWeight: 500 }}>collected</div>
        </div>
        {c.tax && (
          <div style={{ padding: '5px 10px', background: CM.tagPurple, color: CM.tagPurpleText, borderRadius: 999, fontFamily: CMF, fontSize: 11, fontWeight: 700, letterSpacing: '0.02em' }}>Tax Exempt</div>
        )}
        <button style={{
          padding: '6px 14px', border: `1px solid ${CM.border}`, background: '#fff',
          borderRadius: 8, fontFamily: CMF, fontSize: 12.5, fontWeight: 600, color: CM.text2,
        }}>Edit</button>
      </div>
    </div>
  );
}

// ─── Caption ───────────────────────────────────────────────────────────────
function CMCaption({ text, time, duration, delay = 0.3, fade = 0.4 }) {
  const local = time - delay;
  const tIn = cmclamp(local / fade, 0, 1);
  const tOut = cmclamp((duration - delay - local) / fade, 0, 1);
  const op = cmeaseOut(Math.min(tIn, tOut));
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 36, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{
        opacity: op,
        background: 'rgba(11,11,14,0.92)', color: '#F4F4F5',
        fontFamily: CMF, fontSize: 17, fontWeight: 500, letterSpacing: '-0.005em',
        padding: '12px 22px', borderRadius: 999,
        boxShadow: '0 12px 32px rgba(0,0,0,0.25)', whiteSpace: 'nowrap',
      }}>{text}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 1 — HOOK (0–3s)
// ═══════════════════════════════════════════════════════════════════════════
function SceneCMHook() {
  const { localTime } = useSprite();
  const t = localTime;
  const logoT = cmclamp(t / 0.6, 0, 1);
  const h1T = cmclamp((t - 0.5) / 0.5, 0, 1);
  const h2T = cmclamp((t - 0.95) / 0.5, 0, 1);
  const subT = cmclamp((t - 1.6) / 0.5, 0, 1);
  return (
    <div style={{ position: 'absolute', inset: 0, background: CM.darkBg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ opacity: logoT, transform: `translateY(${(1-logoT)*8}px)`, display: 'flex', alignItems: 'center', gap: 14, marginBottom: 38 }}>
        <CMLogo size={40} />
        <div style={{ fontFamily: CMF, fontSize: 22, fontWeight: 700, color: CM.darkText1, letterSpacing: '-0.015em' }}>InkTracker</div>
      </div>
      <div style={{ opacity: h1T, transform: `translateY(${(1-h1T)*10}px)`, fontFamily: CMF, fontSize: 96, fontWeight: 800, color: CM.darkText1, letterSpacing: '-0.045em', lineHeight: 1, textAlign: 'center' }}>Every customer.</div>
      <div style={{ opacity: h2T, transform: `translateY(${(1-h2T)*10}px)`, fontFamily: CMF, fontSize: 96, fontWeight: 800, color: '#A5B4FC', letterSpacing: '-0.045em', lineHeight: 1.02, textAlign: 'center', marginTop: 10 }}>One source of truth.</div>
      <div style={{ opacity: subT, transform: `translateY(${(1-subT)*8}px)`, fontFamily: CMF, fontSize: 20, color: CM.darkText2, marginTop: 36, textAlign: 'center' }}>Contacts, history, artwork — all in one place.</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 2 — CUSTOMER GRID (3–10s)
// ═══════════════════════════════════════════════════════════════════════════
function SceneCMGrid() {
  const { localTime, duration } = useSprite();
  const t = localTime;
  const pageT = cmclamp(t / 0.4, 0, 1);
  const headerT = cmclamp((t - 0.2) / 0.4, 0, 1);
  const filtersT = cmclamp((t - 0.45) / 0.35, 0, 1);
  return (
    <CMApp opacity={pageT}>
      <div style={{ padding: '36px 56px 0', opacity: headerT }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontFamily: CMF, fontSize: 38, fontWeight: 800, color: CM.text1, letterSpacing: '-0.03em' }}>Customers</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
            <button style={{ padding: '10px 18px', background: '#fff', border: `1px solid ${CM.border}`, borderRadius: 8, fontFamily: CMF, fontSize: 14, fontWeight: 600, color: CM.text2, display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={CM.text2} strokeWidth="1.8"><path d="M9 12h6M3 8l6 4-6 4M21 8l-6 4 6 4"/></svg>
              Merge Duplicates
            </button>
            <button style={{ padding: '10px 18px', background: CM.accent, color: '#fff', border: 'none', borderRadius: 8, fontFamily: CMF, fontSize: 14, fontWeight: 700, boxShadow: '0 6px 16px rgba(79,70,229,0.32)' }}>+ Add Customer</button>
          </div>
        </div>
        <div style={{ opacity: filtersT, marginTop: 22, display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={CM.text3} strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
          <div style={{ fontFamily: CMF, fontSize: 14, color: CM.text3, fontWeight: 500 }}>Advanced Filters</div>
        </div>
      </div>
      <div style={{
        padding: '20px 56px 28px', display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)', gap: 20,
      }}>
        {DEMO_CUSTOMERS.map((c, i) => {
          const start = 0.7 + i * 0.08;
          const tt = cmclamp((t - start) / 0.4, 0, 1);
          const e = cmeaseOut(tt);
          return (
            <div key={c.name} style={{ opacity: e, transform: `translateY(${(1-e)*16}px)` }}>
              <CustCard c={c} />
            </div>
          );
        })}
      </div>
      <CMCaption text="All your customers — invoices, totals, tax status at a glance." time={localTime} duration={duration} delay={0.6} />
    </CMApp>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 3 — ADD CUSTOMER (10–15s)
// ═══════════════════════════════════════════════════════════════════════════
function SceneCMAdd() {
  const { localTime, duration } = useSprite();
  const t = localTime;
  const panelT = cmclamp(t / 0.45, 0, 1);
  const panelE = cmeaseOut(panelT);

  const typedSlice = (text, startT, durT) => {
    const k = cmclamp((t - startT) / durT, 0, 1);
    return text.slice(0, Math.floor(text.length * k));
  };
  const name    = typedSlice('Marina Cole',                       0.7, 0.5);
  const company = typedSlice('Coastline Outdoor Co.',             1.1, 0.55);
  const email   = typedSlice('marina@coastlineoutdoor.example',   1.55, 0.7);
  const phone   = typedSlice('(415) 555-0182',                    2.15, 0.45);
  const address = typedSlice('220 Harbor Way, Sausalito, CA',     2.6, 0.65);
  const notes   = typedSlice('Net-15. Prefers eco-blanks.',       3.25, 0.6);

  const taxT = cmclamp((t - 3.9) / 0.25, 0, 1);
  const depT = cmclamp((t - 4.15) / 0.25, 0, 1);
  const saveT = cmclamp((t - 4.45) / 0.4, 0, 1);
  const saveGlow = 0.5 + 0.5 * Math.sin(t * 6) * (saveT > 0.5 ? 1 : 0);

  const caretOn = Math.floor(t * 2) % 2 === 0;

  // Active field highlight schedule
  const active = (s, e) => t > s && t < e;
  const aName = active(0.7, 1.2);
  const aComp = active(1.1, 1.7);
  const aEmail = active(1.55, 2.3);
  const aPhone = active(2.15, 2.65);
  const aAddr = active(2.6, 3.3);
  const aNotes = active(3.25, 3.9);

  return (
    <CMApp opacity={1}>
      {/* Dim the grid behind */}
      <div style={{ padding: '36px 56px 0', filter: 'blur(0px)', opacity: 0.5 }}>
        <div style={{ fontFamily: CMF, fontSize: 38, fontWeight: 800, color: CM.text1 }}>Customers</div>
      </div>

      {/* Add Customer panel */}
      <div style={{
        position: 'absolute', left: 56, right: 56, top: 100,
        background: '#fff', border: `1px solid ${CM.accentBorder}`,
        borderRadius: 16,
        opacity: panelE, transform: `translateY(${(1-panelE)*-16}px)`,
        boxShadow: '0 24px 60px rgba(79,70,229,0.18), 0 4px 12px rgba(15,23,42,0.05)',
        padding: '28px 32px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 22 }}>
          <div style={{ fontFamily: CMF, fontSize: 12, fontWeight: 800, letterSpacing: '0.14em', color: CM.accent }}>NEW CUSTOMER</div>
          <button style={{ marginLeft: 'auto', padding: '8px 14px', background: CM.accent, color: '#fff', border: 'none', borderRadius: 8, fontFamily: CMF, fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>✕ Cancel</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22, columnGap: 28, rowGap: 22 }}>
          <CMField label="NAME *"           value={name}    active={aName}  caretOn={caretOn} />
          <CMField label="COMPANY / ORG"    value={company} active={aComp}  caretOn={caretOn} />
          <CMField label="EMAIL"            value={email}   active={aEmail} caretOn={caretOn} />
          <CMField label="PHONE"            value={phone}   active={aPhone} caretOn={caretOn} />
          <CMField label="ADDRESS"          value={address} active={aAddr}  caretOn={caretOn} />
          <CMField label="NOTES"            value={notes}   active={aNotes} caretOn={caretOn} />
        </div>

        <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 18, height: 18, borderRadius: 4,
              border: `1.5px solid ${taxT > 0.5 ? CM.accent : CM.borderStrong}`,
              background: taxT > 0.5 ? CM.accent : '#fff',
              display: 'grid', placeItems: 'center',
            }}>
              {taxT > 0.5 && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4 10-12"/></svg>}
            </div>
            <div style={{ fontFamily: CMF, fontSize: 14, fontWeight: 600, color: CM.text1 }}>Tax Exempt</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div style={{ fontFamily: CMF, fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: CM.text3 }}>DEFAULT PAYMENT TERMS</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 16, height: 16, borderRadius: 8, border: `1.5px solid ${depT < 0.5 ? CM.accent : CM.borderStrong}`, display: 'grid', placeItems: 'center' }}>
                {depT < 0.5 && <div style={{ width: 8, height: 8, borderRadius: 4, background: CM.accent }} />}
              </div>
              <div style={{ fontFamily: CMF, fontSize: 13.5, fontWeight: 600, color: CM.text1 }}>Pay in full</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 16, height: 16, borderRadius: 8, border: `1.5px solid ${depT > 0.5 ? CM.accent : CM.borderStrong}`, display: 'grid', placeItems: 'center' }}>
                {depT > 0.5 && <div style={{ width: 8, height: 8, borderRadius: 4, background: CM.accent }} />}
              </div>
              <div style={{ fontFamily: CMF, fontSize: 13.5, fontWeight: 600, color: CM.text1 }}>Deposit</div>
            </div>
          </div>
        </div>

        <button style={{
          marginTop: 22, padding: '14px 26px',
          background: saveT > 0.5 ? CM.accent : '#E2E8F0',
          color: saveT > 0.5 ? '#fff' : CM.text3,
          border: 'none', borderRadius: 8,
          fontFamily: CMF, fontSize: 15, fontWeight: 700,
          boxShadow: saveT > 0.5 ? `0 8px 22px rgba(79,70,229,${0.28 + 0.18*saveGlow})` : 'none',
          transition: 'all 0.2s',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>Add Customer</button>
      </div>

      <CMCaption text="Add new customers in seconds — full record from day one." time={localTime} duration={duration} delay={0.6} />
    </CMApp>
  );
}

function CMField({ label, value, active, caretOn }) {
  return (
    <div>
      <div style={{ fontFamily: CMF, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: CM.text3, marginBottom: 8 }}>{label}</div>
      <div style={{
        height: 48, border: `1px solid ${active ? CM.accentBorder : CM.borderStrong}`,
        background: active ? CM.accentSoft : '#fff',
        borderRadius: 8, padding: '0 14px',
        display: 'flex', alignItems: 'center',
        fontFamily: CMF, fontSize: 15, color: CM.text1, fontWeight: 500,
      }}>
        {value}
        {active && caretOn && <span style={{ display: 'inline-block', width: 2, height: 18, marginLeft: 1, background: CM.text1 }} />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 4 — EDIT CUSTOMER (artwork + imprints) (15–20s)
// ═══════════════════════════════════════════════════════════════════════════
function SceneCMEdit() {
  const { localTime, duration } = useSprite();
  const t = localTime;

  const dimT = cmclamp(t / 0.4, 0, 1);
  const modalT = cmclamp((t - 0.15) / 0.5, 0, 1);
  const modalE = cmeaseOut(modalT);

  const imprintT = cmclamp((t - 1.2) / 0.4, 0, 1);
  const imprintCardT = cmclamp((t - 1.6) / 0.4, 0, 1);

  const artT = cmclamp((t - 2.3) / 0.4, 0, 1);
  const fileSelectT = cmclamp((t - 2.7) / 0.3, 0, 1);
  const uploadProgT = cmclamp((t - 3.1) / 0.8, 0, 1);
  const artTileT = cmclamp((t - 4.0) / 0.4, 0, 1);

  const saveT = cmclamp((t - 4.5) / 0.3, 0, 1);
  const saveGlow = 0.5 + 0.5 * Math.sin(t * 6);

  return (
    <CMApp opacity={1}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.45)', opacity: dimT }} />

      {/* Edit Customer modal */}
      <div style={{
        position: 'absolute', left: '50%', top: 60, bottom: 60,
        width: 980, transform: `translateX(-50%) translateY(${(1-modalE)*20}px) scale(${0.97 + 0.03*modalE})`,
        opacity: modalE,
        background: '#fff', borderRadius: 16,
        boxShadow: '0 32px 80px rgba(15,23,42,0.35), 0 8px 24px rgba(15,23,42,0.12)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '24px 32px 18px', display: 'flex', alignItems: 'center', borderBottom: `1px solid ${CM.border}` }}>
          <div style={{ fontFamily: CMF, fontSize: 24, fontWeight: 800, color: CM.text1, letterSpacing: '-0.02em' }}>Edit Customer</div>
          <div style={{ marginLeft: 'auto', width: 32, height: 32, borderRadius: 16, background: CM.surface2, display: 'grid', placeItems: 'center', color: CM.text3 }}>✕</div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'hidden', padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Name/Company row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
            <CMField label="NAME *"        value="Greenbriar Athletics" active={false} caretOn={false} />
            <CMField label="COMPANY / ORG" value="Greenbriar Athletics" active={false} caretOn={false} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
            <CMField label="EMAIL" value="diego@greenbriar.example" active={false} caretOn={false} />
            <CMField label="PHONE" value="(312) 555-0144" active={false} caretOn={false} />
          </div>

          {/* Saved imprints */}
          <div style={{
            opacity: imprintT, transform: `translateY(${(1-imprintT)*8}px)`,
            border: `1px solid ${CM.border}`, borderRadius: 12, padding: '18px 20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ fontFamily: CMF, fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', color: CM.text3 }}>SAVED IMPRINTS</div>
              <button style={{ marginLeft: 'auto', padding: '6px 12px', border: `1.5px dashed ${CM.accentBorder}`, background: 'transparent', color: CM.accent, borderRadius: 8, fontFamily: CMF, fontSize: 12.5, fontWeight: 700 }}>+ Add Imprint</button>
            </div>
            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, opacity: imprintCardT, transform: `translateY(${(1-imprintCardT)*8}px)` }}>
              {[
                { name: 'Front Chest Logo', colors: 1, w: '4"', h: '4"' },
                { name: 'Full Back Print',  colors: 3, w: '11"', h: '13"' },
              ].map((im, i) => {
                const ct = cmclamp((t - 1.7 - i * 0.15) / 0.35, 0, 1);
                return (
                  <div key={im.name} style={{
                    opacity: ct, transform: `translateY(${(1-ct)*8}px)`,
                    border: `1px solid ${CM.border}`, background: CM.surface2, borderRadius: 10,
                    padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
                  }}>
                    <div style={{ width: 38, height: 38, borderRadius: 8, background: '#fff', border: `1px solid ${CM.border}`, display: 'grid', placeItems: 'center' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={CM.text3} strokeWidth="1.6"><path d="M6 4h12l2 4v10a2 2 0 01-2 2H6a2 2 0 01-2-2V8z"/><path d="M9 4v4h6V4"/></svg>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: CMF, fontSize: 14, fontWeight: 700, color: CM.text1, letterSpacing: '-0.005em' }}>{im.name}</div>
                      <div style={{ fontFamily: CMF, fontSize: 12, color: CM.text3, marginTop: 2 }}>{im.colors}c · {im.w} × {im.h}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Artwork library */}
          <div style={{
            opacity: artT, transform: `translateY(${(1-artT)*8}px)`,
            border: `1px solid ${CM.border}`, borderRadius: 12, padding: '18px 20px',
          }}>
            <div style={{ fontFamily: CMF, fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', color: CM.text3 }}>CUSTOMER ARTWORK LIBRARY</div>
            <div style={{ fontFamily: CMF, fontSize: 12.5, color: CM.text2, marginTop: 4 }}>Files survive page reloads — pulled into new quotes automatically.</div>

            <div style={{ marginTop: 14, padding: '14px 16px', background: CM.surface2, border: `1px solid ${CM.border}`, borderRadius: 10 }}>
              <div style={{ height: 38, border: `1px solid ${CM.borderStrong}`, borderRadius: 8, background: '#fff', display: 'flex', alignItems: 'center', padding: '0 12px', fontFamily: CMF, fontSize: 13, color: fileSelectT > 0.5 ? CM.text1 : CM.text3 }}>
                {fileSelectT > 0.5 ? 'Front Chest Logo (3c version)' : 'Optional note (example: Front chest logo)'}
              </div>
              <div style={{ marginTop: 10, height: 38, border: `1px solid ${CM.borderStrong}`, borderRadius: 8, background: '#fff', display: 'flex', alignItems: 'center', padding: '0 12px', fontFamily: CMF, fontSize: 13, color: fileSelectT > 0.5 ? CM.text1 : CM.text3 }}>
                {fileSelectT > 0.5 ? '3' : 'Production color count (example: 3)'}
              </div>

              <button style={{
                marginTop: 12, padding: '10px 18px',
                background: CM.accent, color: '#fff', border: 'none', borderRadius: 8,
                fontFamily: CMF, fontSize: 13, fontWeight: 700,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M12 4v12M6 10l6-6 6 6M4 20h16"/></svg>
                Choose File &amp; Upload Artwork
              </button>

              {/* Upload progress + tile */}
              {(uploadProgT > 0 || artTileT > 0) && (
                <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
                  {artTileT > 0 ? (
                    <div style={{
                      opacity: artTileT, transform: `scale(${0.94 + 0.06 * artTileT})`,
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', border: `1px solid ${CM.greenSoft}`,
                      background: '#F0FDF4', borderRadius: 10,
                    }}>
                      <div style={{ width: 36, height: 36, borderRadius: 6, background: '#fff', border: `1px solid ${CM.border}`, display: 'grid', placeItems: 'center' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={CM.accent} strokeWidth="1.6"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/></svg>
                      </div>
                      <div>
                        <div style={{ fontFamily: CMF, fontSize: 13, fontWeight: 700, color: CM.text1 }}>greenbriar-chest-3c.ai</div>
                        <div style={{ fontFamily: CMF, fontSize: 11.5, color: CM.green, fontWeight: 600 }}>✓ Uploaded · 1.2 MB</div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: CMF, fontSize: 12, color: CM.text2, marginBottom: 6 }}>Uploading greenbriar-chest-3c.ai…</div>
                      <div style={{ height: 6, background: CM.border, borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${uploadProgT * 100}%`, background: CM.accent, borderRadius: 3 }} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 32px', borderTop: `1px solid ${CM.border}`, display: 'flex', alignItems: 'center' }}>
          <button style={{ padding: '10px 18px', background: '#fff', border: `1px solid #FCA5A5`, borderRadius: 8, color: '#DC2626', fontFamily: CMF, fontSize: 13, fontWeight: 700 }}>Delete</button>
          <button style={{
            marginLeft: 'auto',
            padding: '12px 22px',
            background: saveT > 0.5 ? CM.accent : '#E2E8F0',
            color: saveT > 0.5 ? '#fff' : CM.text3,
            border: 'none', borderRadius: 8,
            fontFamily: CMF, fontSize: 14, fontWeight: 700,
            boxShadow: saveT > 0.5 ? `0 8px 22px rgba(79,70,229,${0.3 + 0.15*saveGlow})` : 'none',
          }}>Save Changes</button>
        </div>
      </div>

      <CMCaption text="Saved imprints and artwork — ready for the next quote." time={localTime} duration={duration} delay={0.6} />
    </CMApp>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 5 — LOCKUP (20–22s)
// ═══════════════════════════════════════════════════════════════════════════
function SceneCMLockup() {
  const { localTime } = useSprite();
  const t = localTime;
  const logoT = cmclamp(t / 0.5, 0, 1);
  const logoE = cmeaseOut(logoT);
  const footT = cmclamp((t - 0.8) / 0.5, 0, 1);
  return (
    <div style={{ position: 'absolute', inset: 0, background: CM.darkBg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ opacity: logoE, transform: `translateY(${(1-logoE)*10}px) scale(${0.95 + 0.05*logoE})`, display: 'flex', alignItems: 'center', gap: 18, marginBottom: 28 }}>
        <CMLogo size={72} />
        <div style={{ fontFamily: CMF, fontSize: 56, fontWeight: 800, color: CM.darkText1, letterSpacing: '-0.03em' }}>InkTracker</div>
      </div>
      <div style={{ opacity: footT, marginTop: 8, fontFamily: CMF, fontSize: 14, color: CM.darkText3, letterSpacing: '0.01em' }}>$99/mo after trial · Cancel anytime</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MASTER
// ═══════════════════════════════════════════════════════════════════════════
function CustomersDemo() {
  return (
    <>
      <Sprite start={0}  end={3}>  <SceneCMHook />   </Sprite>
      <Sprite start={3}  end={10}> <SceneCMGrid />   </Sprite>
      <Sprite start={10} end={15}> <SceneCMAdd />    </Sprite>
      <Sprite start={15} end={20}> <SceneCMEdit />   </Sprite>
      <Sprite start={20} end={22}> <SceneCMLockup />  </Sprite>
    </>
  );
}

window.CustomersDemo = CustomersDemo;
