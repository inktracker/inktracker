// broker-scenes.jsx — InkTracker Broker Integration demo (~22s)
// Demo brokers, shops, and clients only.

const BR = {
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
  // InkTracker brand (used on shop-side chrome)
  indigo: '#4F46E5',
  indigoSoft: '#EEF2FF',
  indigoBorder: '#C7D2FE',
  // Broker accent (teal — distinguishes broker portal from shop portal)
  teal: '#0D9488',
  tealSoft: '#CCFBF1',
  tealBorder: '#5EEAD4',
  tealDarker: '#0F766E',
  green: '#16A34A',
  greenSoft: '#DCFCE7',
  greenBorder: '#86EFAC',
  amber: '#D97706',
  amberSoft: '#FEF3C7',
  slate: '#64748B',
  slateSoft: '#F1F5F9',
};
const BRF = '"Inter", system-ui, -apple-system, sans-serif';
const BRM = '"JetBrains Mono", ui-monospace, monospace';

function brclamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function breaseOut(t) { return 1 - Math.pow(1 - t, 3); }

function BRLogo({ size = 32 }) {
  return <img src="assets/inktracker-logo.png" alt="" style={{ width: size, height: size, display: 'block', objectFit: 'contain', flexShrink: 0 }} />;
}

// ─── Demo: shops the broker reps + their recent activity ───────────────────
const BROKER_SHOPS = [
  { name: 'Northwind Print', initials: 'NP', color: '#FEF3C7', mtd: '$3,420', open: 4  },
  { name: 'Summit Threads',  initials: 'ST', color: '#DBEAFE', mtd: '$1,860', open: 2  },
  { name: 'Pinegrove Apparel', initials: 'PA', color: '#E9D5FF', mtd: '$5,210', open: 7 },
];

// Recent quotes the broker has submitted (shown on broker dashboard)
const BROKER_QUOTES = [
  { id: 'Q-2026-187', shop: 'Pinegrove Apparel', initials: 'PA', color: '#E9D5FF', client: 'Greenbriar Athletics',    amount: '$3,210.00', status: 'sent',    days: '2d ago' },
  { id: 'Q-2026-184', shop: 'Northwind Print',   initials: 'NP', color: '#FEF3C7', client: 'Bayside Coffee Roasters', amount: '$1,460.00', status: 'paid',    days: '3d ago' },
  { id: 'Q-2026-182', shop: 'Summit Threads',    initials: 'ST', color: '#DBEAFE', client: 'Cypress Ridge HS',        amount: '$4,080.50', status: 'open',    days: '5d ago' },
  { id: 'Q-2026-180', shop: 'Pinegrove Apparel', initials: 'PA', color: '#E9D5FF', client: 'Driftwood Theatre Co.',   amount: '$780.00',   status: 'paid',    days: '1w ago' },
  { id: 'Q-2026-176', shop: 'Northwind Print',   initials: 'NP', color: '#FEF3C7', client: 'Foxtail Brewing',         amount: '$920.00',   status: 'sent',    days: '1w ago' },
];

// Broker nav (Clients / Quotes / Orders / Commissions / Messages)
const BR_NAV = [
  { label: 'Dashboard',   icon: 'home',  active: true  },
  { label: 'Clients',     icon: 'users'                },
  { label: 'Quotes',      icon: 'doc'                  },
  { label: 'Orders',      icon: 'box'                  },
  { label: 'Commissions', icon: 'percent'              },
  { label: 'Messages',    icon: 'mail'                 },
  { label: 'Profile',     icon: 'gear'                 },
];

// Shop-side nav (matches the rest of the demos)
const SHOP_NAV = [
  { label: 'Dashboard',   icon: 'home' },
  { label: 'Quotes',      icon: 'doc',   active: true },
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
    case 'percent': return <svg {...p}><path d="M5 19L19 5M7 7a2 2 0 100-4 2 2 0 000 4zM17 21a2 2 0 100-4 2 2 0 000 4z"/></svg>;
    case 'mail':    return <svg {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>;
    default:        return null;
  }
}

// ─── Sidebars ──────────────────────────────────────────────────────────────
function BrokerSidebar() {
  return (
    <div style={{
      position: 'absolute', left: 0, top: 0, bottom: 0, width: 232,
      borderRight: `1px solid ${BR.border}`, background: '#0F172A',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 20px 18px' }}>
        <BRLogo size={36} />
        <div>
          <div style={{ fontFamily: BRF, fontSize: 15, fontWeight: 800, color: '#F4F4F5', letterSpacing: '-0.015em' }}>Marcus Chen</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
            <div style={{ padding: '2px 7px', background: BR.tealSoft, color: BR.tealDarker, fontFamily: BRF, fontSize: 10, fontWeight: 800, letterSpacing: '0.05em', borderRadius: 4, textTransform: 'uppercase' }}>Broker</div>
            <div style={{ fontFamily: BRF, fontSize: 10.5, color: 'rgba(244,244,245,0.55)' }}>3 shops</div>
          </div>
        </div>
      </div>
      <div style={{ padding: '0 10px', flex: 1 }}>
        {BR_NAV.map((it) => {
          const a = it.active;
          return (
            <div key={it.label} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '11px 14px', borderRadius: 8, marginBottom: 2,
              background: a ? BR.teal : 'transparent',
            }}>
              <NavIcon kind={it.icon} color={a ? '#fff' : 'rgba(244,244,245,0.55)'} />
              <div style={{ fontFamily: BRF, fontSize: 14, fontWeight: a ? 700 : 500, color: a ? '#fff' : 'rgba(244,244,245,0.72)' }}>{it.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ShopSidebar() {
  return (
    <div style={{
      position: 'absolute', left: 0, top: 0, bottom: 0, width: 232,
      borderRight: `1px solid ${BR.border}`, background: BR.surface,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 20px 18px' }}>
        <BRLogo size={36} />
        <div>
          <div style={{ fontFamily: BRF, fontSize: 16, fontWeight: 800, color: BR.text1, letterSpacing: '-0.015em' }}>Pinegrove Apparel</div>
          <div style={{ fontFamily: BRF, fontSize: 11.5, color: BR.text3, marginTop: 1 }}>Shop Manager</div>
        </div>
      </div>
      <div style={{ padding: '0 10px', flex: 1 }}>
        {SHOP_NAV.map((it) => {
          const a = it.active;
          return (
            <div key={it.label} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '11px 14px', borderRadius: 8, marginBottom: 2,
              background: a ? BR.indigo : 'transparent',
            }}>
              <NavIcon kind={it.icon} color={a ? '#fff' : BR.text3} />
              <div style={{ fontFamily: BRF, fontSize: 14, fontWeight: a ? 700 : 500, color: a ? '#fff' : BR.text2 }}>{it.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BrokerApp({ children, opacity = 1 }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: BR.appBg, opacity }}>
      <BrokerSidebar />
      <div style={{ position: 'absolute', left: 232, right: 0, top: 0, bottom: 0, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

function ShopApp({ children, opacity = 1 }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: BR.appBg, opacity }}>
      <ShopSidebar />
      <div style={{ position: 'absolute', left: 232, right: 0, top: 0, bottom: 0, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

// ─── Status pill ───────────────────────────────────────────────────────────
function StatusPill({ status }) {
  const map = {
    sent:  { label: 'Sent',  bg: BR.indigoSoft, fg: BR.indigo, br: BR.indigoBorder },
    paid:  { label: 'Paid',  bg: BR.greenSoft,  fg: BR.green,  br: BR.greenBorder  },
    open:  { label: 'Open',  bg: BR.amberSoft,  fg: BR.amber,  br: '#FCD34D'       },
    draft: { label: 'Draft', bg: BR.slateSoft,  fg: BR.slate,  br: BR.border       },
    new:   { label: 'New from broker', bg: BR.tealSoft, fg: BR.tealDarker, br: BR.tealBorder },
  };
  const s = map[status] || map.draft;
  return (
    <div style={{
      padding: '4px 10px', background: s.bg, color: s.fg,
      border: `1px solid ${s.br}`,
      borderRadius: 999, fontFamily: BRF, fontSize: 11.5, fontWeight: 700, letterSpacing: '0.02em',
      whiteSpace: 'nowrap',
    }}>{s.label}</div>
  );
}

// ─── Caption ───────────────────────────────────────────────────────────────
function BRCaption({ text, time, duration, delay = 0.3, fade = 0.4 }) {
  const local = time - delay;
  const tIn = brclamp(local / fade, 0, 1);
  const tOut = brclamp((duration - delay - local) / fade, 0, 1);
  const op = breaseOut(Math.min(tIn, tOut));
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 36, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{
        opacity: op,
        background: 'rgba(11,11,14,0.92)', color: '#F4F4F5',
        fontFamily: BRF, fontSize: 17, fontWeight: 500, letterSpacing: '-0.005em',
        padding: '12px 22px', borderRadius: 999,
        boxShadow: '0 12px 32px rgba(0,0,0,0.25)', whiteSpace: 'nowrap',
      }}>{text}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 1 — HOOK (0–3s)
// ═══════════════════════════════════════════════════════════════════════════
function SceneBRHook() {
  const { localTime } = useSprite();
  const t = localTime;
  const logoT = brclamp(t / 0.6, 0, 1);
  const h1T = brclamp((t - 0.5) / 0.5, 0, 1);
  const h2T = brclamp((t - 0.95) / 0.5, 0, 1);
  const subT = brclamp((t - 1.6) / 0.5, 0, 1);
  return (
    <div style={{ position: 'absolute', inset: 0, background: BR.darkBg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ opacity: logoT, transform: `translateY(${(1-logoT)*8}px)`, display: 'flex', alignItems: 'center', gap: 14, marginBottom: 38 }}>
        <BRLogo size={40} />
        <div style={{ fontFamily: BRF, fontSize: 22, fontWeight: 700, color: BR.darkText1, letterSpacing: '-0.015em' }}>InkTracker</div>
      </div>
      <div style={{ opacity: h1T, transform: `translateY(${(1-h1T)*10}px)`, fontFamily: BRF, fontSize: 96, fontWeight: 800, color: BR.darkText1, letterSpacing: '-0.045em', lineHeight: 1, textAlign: 'center' }}>Your sales team.</div>
      <div style={{ opacity: h2T, transform: `translateY(${(1-h2T)*10}px)`, fontFamily: BRF, fontSize: 96, fontWeight: 800, color: '#5EEAD4', letterSpacing: '-0.045em', lineHeight: 1.02, textAlign: 'center', marginTop: 10 }}>Their own portal.</div>
      <div style={{ opacity: subT, transform: `translateY(${(1-subT)*8}px)`, fontFamily: BRF, fontSize: 20, color: BR.darkText2, marginTop: 36, textAlign: 'center' }}>Brokers submit. Shops fulfill. Commissions tracked automatically.</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 2 — BROKER DASHBOARD (3–9s)
// ═══════════════════════════════════════════════════════════════════════════
function SceneBRDashboard() {
  const { localTime, duration } = useSprite();
  const t = localTime;
  const pageT = brclamp(t / 0.4, 0, 1);
  const headerT = brclamp((t - 0.2) / 0.4, 0, 1);
  const statsT = brclamp((t - 0.4) / 0.45, 0, 1);

  // Commission counter ticks from $0 to $1,847.20 between 0.6–1.8s
  const ctT = brclamp((t - 0.6) / 1.2, 0, 1);
  const ctE = breaseOut(ctT);
  const commission = 1847.20 * ctE;

  return (
    <BrokerApp opacity={pageT}>
      <div style={{ padding: '36px 56px 0', opacity: headerT }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: BRF, fontSize: 38, fontWeight: 800, color: BR.text1, letterSpacing: '-0.03em' }}>Welcome, Marcus</div>
            <div style={{ fontFamily: BRF, fontSize: 14, color: BR.text3, marginTop: 4 }}>Broker portal · May 2026</div>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <button style={{ padding: '11px 22px', background: BR.teal, color: '#fff', border: 'none', borderRadius: 9, fontFamily: BRF, fontSize: 14.5, fontWeight: 700, boxShadow: '0 6px 16px rgba(13,148,136,0.32)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              Submit a Quote
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding: '24px 56px 0', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, opacity: statsT }}>
        <StatCard label="Commission MTD"  value={`$${commission.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} trend="across 3 shops" color={BR.teal} />
        <StatCard label="Quotes sent"      value="14"      trend="this month" color={BR.text1} />
        <StatCard label="Open quotes"      value="6"       trend="awaiting customer" color={BR.amber} />
        <StatCard label="Paid"             value="8"       trend="$10,490 collected" color={BR.green} />
      </div>

      {/* Two columns: assigned shops + recent quotes */}
      <div style={{ padding: '20px 56px 28px', display: 'grid', gridTemplateColumns: '340px 1fr', gap: 20 }}>
        {/* My shops */}
        <div style={{ background: BR.surface, border: `1px solid ${BR.border}`, borderRadius: 14, padding: '18px 20px', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
          <div style={{ fontFamily: BRF, fontSize: 12, fontWeight: 700, color: BR.text3, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 14 }}>My Shops</div>
          {BROKER_SHOPS.map((s, i) => {
            const startT = 0.85 + i * 0.12;
            const k = brclamp((t - startT) / 0.4, 0, 1);
            const e = breaseOut(k);
            return (
              <div key={s.name} style={{ opacity: e, transform: `translateY(${(1-e)*8}px)`, display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: i < BROKER_SHOPS.length - 1 ? `1px solid ${BR.border}` : 'none' }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: s.color, display: 'grid', placeItems: 'center', fontFamily: BRF, fontSize: 12, fontWeight: 800, color: BR.text1 }}>{s.initials}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: BRF, fontSize: 14, fontWeight: 700, color: BR.text1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                  <div style={{ fontFamily: BRF, fontSize: 11.5, color: BR.text3, marginTop: 2 }}>{s.open} open · {s.mtd} MTD</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Recent quotes */}
        <div style={{ background: BR.surface, border: `1px solid ${BR.border}`, borderRadius: 14, padding: '18px 20px', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontFamily: BRF, fontSize: 12, fontWeight: 700, color: BR.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Recent Quotes</div>
            <div style={{ marginLeft: 'auto', fontFamily: BRF, fontSize: 12, fontWeight: 600, color: BR.teal }}>View all →</div>
          </div>
          {BROKER_QUOTES.map((q, i) => {
            const startT = 1.0 + i * 0.1;
            const k = brclamp((t - startT) / 0.4, 0, 1);
            const e = breaseOut(k);
            return (
              <div key={q.id} style={{ opacity: e, transform: `translateY(${(1-e)*8}px)`, display: 'grid', gridTemplateColumns: '90px 36px 1fr 140px 110px 80px', gap: 14, alignItems: 'center', padding: '10px 0', borderBottom: i < BROKER_QUOTES.length - 1 ? `1px solid ${BR.border}` : 'none' }}>
                <div style={{ fontFamily: BRM, fontSize: 12, color: BR.text2, fontWeight: 600 }}>{q.id}</div>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: q.color, display: 'grid', placeItems: 'center', fontFamily: BRF, fontSize: 10.5, fontWeight: 800, color: BR.text1 }}>{q.initials}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: BRF, fontSize: 13, fontWeight: 700, color: BR.text1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.client}</div>
                  <div style={{ fontFamily: BRF, fontSize: 11.5, color: BR.text3, marginTop: 1 }}>{q.shop} · {q.days}</div>
                </div>
                <div style={{ fontFamily: BRF, fontSize: 14, fontWeight: 800, color: BR.text1, letterSpacing: '-0.01em', textAlign: 'right' }}>{q.amount}</div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}><StatusPill status={q.status} /></div>
                <div style={{ fontFamily: BRF, fontSize: 12, color: BR.teal, fontWeight: 700, textAlign: 'right' }}>+ {(parseFloat(q.amount.replace(/[$,]/g, '')) * 0.1).toFixed(2)}</div>
              </div>
            );
          })}
        </div>
      </div>

      <BRCaption text="Brokers see their shops, their quotes, their commissions — all in one portal." time={localTime} duration={duration} delay={1.8} />
    </BrokerApp>
  );
}

function StatCard({ label, value, trend, color }) {
  return (
    <div style={{
      background: BR.surface, border: `1px solid ${BR.border}`,
      borderRadius: 12, padding: '16px 20px',
      boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ fontFamily: BRF, fontSize: 11.5, fontWeight: 700, color: BR.text3, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontFamily: BRF, fontSize: 28, fontWeight: 800, color, letterSpacing: '-0.025em' }}>{value}</div>
      <div style={{ fontFamily: BRF, fontSize: 12, color: BR.text3, fontWeight: 500 }}>{trend}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 3 — BROKER QUOTE BUILDER (9–15s)
// ═══════════════════════════════════════════════════════════════════════════
// Mirrors the real BrokerQuoteEditor modal: live S&S/AS Colour style lookup,
// size-breakdown with per-size availability, and the broker's signature
// two-column pricing pane — "Your Broker Price" (wholesale + markup) next to
// "Shop Rate" (what the client pays), with Total Broker Profit in violet.
//
// Beats:
//   0–0.5s   Modal slides in
//   0.5–1.4s Style number typed: "G500" → live lookup spinner → "Gildan 5000" resolves
//   1.4–2.2s Size qty cells fill (S=24, M=48, L=48, XL=24, 2XL=6 → 150 pcs)
//            Availability row reveals live stock numbers per size
//   2.4–3.4s Pricing pane: Broker price + Shop rate counters tick up, profit cell flashes
//   3.4s+    Submit button → spinner → "Submitted ✓"
function SceneBRSubmit() {
  const { localTime, duration } = useSprite();
  const t = localTime;
  const modalT = brclamp(t / 0.5, 0, 1);
  const modalE = breaseOut(modalT);

  // Style-number lookup beats
  const styleTyped     = brclamp((t - 0.55) / 0.35, 0, 1);  // characters appearing
  const lookupStartAt  = 0.95;
  const lookupDoneAt   = 1.25;
  const lookupRunning  = t >= lookupStartAt && t < lookupDoneAt;
  const lookupResolved = t >= lookupDoneAt;

  // Size qty fill (one cell at a time, left to right)
  const sizes = [
    { label: 'S',   qty: 24, start: 1.35 },
    { label: 'M',   qty: 48, start: 1.50 },
    { label: 'L',   qty: 48, start: 1.65 },
    { label: 'XL',  qty: 24, start: 1.80 },
    { label: '2XL', qty: 6,  start: 1.95 },
  ];
  const totalQty = sizes.reduce((acc, s) => {
    const k = brclamp((t - s.start) / 0.2, 0, 1);
    return acc + Math.round(s.qty * k);
  }, 0);

  // Availability row (live S&S inventory) fades in after sizes
  const availT = brclamp((t - 2.2) / 0.4, 0, 1);

  // Totals counter — both broker price and client total tick up between 2.4–3.2s
  const totalStart = 2.4;
  const totalT = brclamp((t - totalStart) / 0.8, 0, 1);
  const totalE = breaseOut(totalT);
  const brokerTotal = 2250 * totalE;     // wholesale + broker markup
  const clientTotal = 3210 * totalE;     // shop's retail price
  const brokerProfit = clientTotal - brokerTotal;

  // Profit cell pulses around 3.0s
  const profitPulse = brclamp((t - 3.0) / 0.5, 0, 1);
  const profitScale = 1 + profitPulse * (1 - profitPulse) * 0.3;

  // Submit beats
  const submitAt = 4.4;
  const submitting = t >= submitAt && t < submitAt + 0.7;
  const submitted = t >= submitAt + 0.7;
  const submittedT = brclamp((t - submitAt - 0.7) / 0.4, 0, 1);

  return (
    <BrokerApp opacity={1}>
      <div style={{ padding: '24px 36px 0', opacity: 0.35 }}>
        <div style={{ fontFamily: BRF, fontSize: 30, fontWeight: 800, color: BR.text1, letterSpacing: '-0.03em' }}>Quotes</div>
      </div>

      <div style={{ position: 'absolute', inset: 0, background: `rgba(15,23,42,${0.42 * modalE})`, pointerEvents: 'none' }} />

      {/* Quote Builder modal */}
      <div style={{
        position: 'absolute', top: 24, left: '50%',
        transform: `translate(-50%, ${(1 - modalE) * 24}px)`,
        opacity: modalE,
        width: 1340,
        background: BR.surface, border: `1px solid ${BR.border}`,
        borderRadius: 18, boxShadow: '0 32px 96px rgba(15,23,42,0.32)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header (matches BrokerQuoteEditor: tiny QUOTE label + big title) */}
        <div style={{ padding: '18px 28px', borderBottom: `1px solid ${BR.border}`, background: BR.surface2, display: 'flex', alignItems: 'center', gap: 16 }}>
          <div>
            <div style={{ fontFamily: BRF, fontSize: 10.5, fontWeight: 800, color: BR.text3, letterSpacing: '0.18em', textTransform: 'uppercase' }}>Q-2026-187 · Pinegrove Apparel</div>
            <div style={{ fontFamily: BRF, fontSize: 22, fontWeight: 800, color: BR.text1, letterSpacing: '-0.02em', marginTop: 2 }}>Quote Builder</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontFamily: BRF, fontSize: 11.5, color: BR.text3 }}>
            <div style={{ width: 8, height: 8, borderRadius: 999, background: BR.green }} />
            Auto-saving
          </div>
        </div>

        {/* Customer / Date strip */}
        <div style={{ padding: '14px 28px 0', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
          <SmallField label="Customer" value="Greenbriar Athletics — diego@greenbriar.example" />
          <SmallField label="Date"     value="May 13, 2026" />
          <SmallField label="In-Hands" value="May 27, 2026" />
        </div>

        {/* Line Items header */}
        <div style={{ padding: '16px 28px 8px', display: 'flex', alignItems: 'center' }}>
          <div style={{ fontFamily: BRF, fontSize: 11.5, fontWeight: 800, color: BR.text3, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Line Items</div>
          <div style={{ marginLeft: 'auto', padding: '5px 11px', border: `1px solid ${BR.indigoBorder}`, color: BR.indigo, borderRadius: 8, fontFamily: BRF, fontSize: 11.5, fontWeight: 700 }}>+ Add Garment Group</div>
        </div>

        {/* Line item card — mirrors BrokerLineItemEditor */}
        <div style={{ margin: '0 28px', border: `1px solid ${BR.border}`, borderRadius: 14, overflow: 'hidden', background: BR.surface }}>
          {/* Top strip: style/category/brand/color/cost */}
          <div style={{ background: BR.surface2, padding: '14px 18px', borderBottom: `1px solid ${BR.border}` }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr 0.9fr', gap: 12, alignItems: 'end' }}>
              <BLECell label={<>Style #
                {lookupRunning && <span style={{ marginLeft: 6, color: BR.indigo, fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>Looking up…</span>}
                {lookupResolved && <span style={{ marginLeft: 6, color: BR.green, fontWeight: 700, textTransform: 'none', letterSpacing: 0 }}>✓ Live</span>}
              </>}>
                <div style={{ position: 'relative' }}>
                  <div style={{
                    padding: '8px 11px',
                    background: '#fff',
                    border: `1.5px solid ${lookupResolved ? BR.greenBorder : BR.border}`,
                    borderRadius: 8,
                    fontFamily: BRM, fontSize: 13, color: BR.text1, fontWeight: 600,
                    transition: 'border-color 0.3s',
                  }}>
                    {'G500'.slice(0, Math.floor(4 * styleTyped))}
                  </div>
                  {lookupRunning && (
                    <div style={{ position: 'absolute', right: 10, top: '50%', transform: `translateY(-50%) rotate(${t * 720}deg)` }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={BR.indigo} strokeWidth="2.4" strokeLinecap="round"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
                    </div>
                  )}
                </div>
              </BLECell>

              <BLECell label="Category">
                <ChipValue text={lookupResolved ? 'Tees' : '—'} />
              </BLECell>
              <BLECell label="Brand">
                <ChipValue text={lookupResolved ? 'Gildan' : '—'} />
              </BLECell>
              <BLECell label="Garment Color">
                <ChipValue text={lookupResolved ? 'Black' : '—'} swatch={lookupResolved ? '#0F172A' : null} />
              </BLECell>
              <BLECell label="Garment Cost">
                <ChipValue text={lookupResolved ? '$2.34' : '—'} mono />
              </BLECell>
            </div>
            {lookupResolved && (
              <div style={{ marginTop: 10, fontFamily: BRF, fontSize: 11.5, color: BR.text2, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ padding: '2px 8px', background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE', fontFamily: BRF, fontSize: 10.5, fontWeight: 700, borderRadius: 5, letterSpacing: '0.02em' }}>S&S Activewear</div>
                Gildan 5000 — Heavy Cotton T-Shirt · 5.3 oz · Black · live pricing from S&S API
              </div>
            )}
          </div>

          {/* Split: size breakdown | per-piece price */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', borderTop: `1px solid ${BR.border}` }}>
            {/* Left: size breakdown + availability row */}
            <div style={{ padding: '16px 18px', borderRight: `1px solid ${BR.border}` }}>
              <div style={{ fontFamily: BRF, fontSize: 11, fontWeight: 800, color: BR.text3, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Size Breakdown</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${BR.border}` }}>
                    <td style={{ padding: '0 0 6px', fontFamily: BRF, fontSize: 10.5, color: BR.text3, fontWeight: 700 }}>Size</td>
                    {sizes.map((s) => (
                      <td key={s.label} style={{ padding: '0 0 6px', fontFamily: BRF, fontSize: 10.5, color: BR.text3, fontWeight: 700, textAlign: 'center', width: 56 }}>{s.label}</td>
                    ))}
                    <td style={{ padding: '0 0 6px', fontFamily: BRF, fontSize: 10.5, color: BR.text2, fontWeight: 800, textAlign: 'center', width: 64 }}>Total</td>
                  </tr>
                </thead>
                <tbody>
                  {/* Qty row */}
                  <tr>
                    <td style={{ padding: '8px 0', fontFamily: BRF, fontSize: 12, color: BR.text2, fontWeight: 600 }}>Qty</td>
                    {sizes.map((s) => {
                      const k = brclamp((t - s.start) / 0.2, 0, 1);
                      const filled = k > 0;
                      const big = s.label === '2XL';
                      return (
                        <td key={s.label} style={{ padding: '6px 4px' }}>
                          <div style={{
                            padding: '5px 0',
                            background: filled ? (big ? '#FFFBEB' : '#fff') : '#fff',
                            border: `1px solid ${big ? '#FCD34D' : BR.border}`,
                            borderRadius: 6,
                            fontFamily: BRM, fontSize: 12.5, color: BR.text1, fontWeight: 700,
                            textAlign: 'center',
                            transition: 'background 0.2s',
                          }}>{Math.round(s.qty * k) || ''}</div>
                        </td>
                      );
                    })}
                    <td style={{ padding: '6px 0', fontFamily: BRF, fontSize: 14, color: BR.text1, fontWeight: 800, textAlign: 'center' }}>{totalQty}</td>
                  </tr>
                  {/* Availability row */}
                  <tr style={{ opacity: availT }}>
                    <td style={{ padding: '6px 0', fontFamily: BRF, fontSize: 11, color: BR.indigo, fontWeight: 700 }}>Avail</td>
                    {[{ sz: 'S', n: 380 }, { sz: 'M', n: 540 }, { sz: 'L', n: 620 }, { sz: 'XL', n: 410 }, { sz: '2XL', n: 28 }].map((a) => (
                      <td key={a.sz} style={{ padding: '6px 4px', fontFamily: BRM, fontSize: 11.5, color: a.n < 50 ? '#D97706' : BR.green, fontWeight: 700, textAlign: 'center' }}>{a.n}</td>
                    ))}
                    <td />
                  </tr>
                </tbody>
              </table>
              <div style={{ marginTop: 8, fontFamily: BRF, fontSize: 11, color: BR.text3 }}>Live S&amp;S stock · checked just now</div>
            </div>

            {/* Right: per-piece price + imprint */}
            <div style={{ padding: '16px 18px' }}>
              <div style={{ fontFamily: BRF, fontSize: 11, fontWeight: 800, color: BR.text3, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Imprint &amp; Price</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <BLESmall label="Print Type"     value={lookupResolved ? 'Screen print · 2-color' : '—'} />
                <BLESmall label="Location"       value={lookupResolved ? 'Full Front' : '—'} />
                <BLESmall label="Garment Cost"   value={lookupResolved ? '$2.34' : '—'} mono />
                <BLESmall label="Print Cost"     value={lookupResolved ? '$4.16' : '—'} mono />
              </div>
              <div style={{ marginTop: 14, padding: '12px 14px', background: BR.indigoSoft, border: `1px solid ${BR.indigoBorder}`, borderRadius: 10, display: 'flex', alignItems: 'center' }}>
                <div>
                  <div style={{ fontFamily: BRF, fontSize: 11, fontWeight: 800, color: BR.indigo, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Per piece</div>
                  <div style={{ fontFamily: BRM, fontSize: 11, color: BR.text3, marginTop: 1 }}>cost $6.50 + markup</div>
                </div>
                <div style={{ marginLeft: 'auto', fontFamily: BRF, fontSize: 24, color: BR.indigo, fontWeight: 800, letterSpacing: '-0.02em' }}>${(15.0 * totalE).toFixed(2)}</div>
              </div>
              <div style={{ marginTop: 10, fontFamily: BRF, fontSize: 12, color: BR.text3, display: 'flex', justifyContent: 'space-between' }}>
                <span>Line total ({totalQty} pcs)</span>
                <span style={{ fontFamily: BRF, fontSize: 14, color: BR.text1, fontWeight: 800 }}>${(15.0 * totalQty).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom: notes + two-column pricing pane */}
        <div style={{ padding: '16px 28px 0', display: 'grid', gridTemplateColumns: '1fr 1.05fr', gap: 16 }}>
          <div>
            <div style={{ fontFamily: BRF, fontSize: 11.5, fontWeight: 800, color: BR.text3, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Job Notes</div>
            <div style={{
              padding: '14px 16px', height: 188,
              border: `1px solid ${BR.border}`, borderRadius: 12, background: BR.surface,
              fontFamily: BRF, fontSize: 13, color: BR.text2, lineHeight: 1.55,
            }}>
              Spring training tees. Two screens, navy / white ink. Pack by size, drop-ship to facility. In-hands May 27.
            </div>
          </div>

          {/* The signature two-column pricing pane */}
          <div style={{ background: BR.surface2, border: `1px solid ${BR.border}`, borderRadius: 14, padding: '16px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
            {/* Left: Your Broker Price */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontFamily: BRF, fontSize: 10.5, fontWeight: 800, color: BR.text3, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Your Broker Price</div>
              <PriceRow label="Subtotal"        value={fmt(brokerTotal)} />
              <PriceRow label="Discount"        value="0%"  muted />
              <PriceRow label="Tax"             value="$0.00" muted italic />
              <div style={{ borderTop: `1px solid ${BR.border}`, margin: '4px 0 0' }} />
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontFamily: BRF, fontSize: 13, fontWeight: 800, color: BR.text1 }}>Your Price</span>
                <span style={{ fontFamily: BRF, fontSize: 26, fontWeight: 800, color: BR.text1, letterSpacing: '-0.02em' }}>{fmt(brokerTotal)}</span>
              </div>
              <div style={{ marginTop: 6, padding: '8px 11px', background: BR.indigoSoft, border: `1px solid ${BR.indigoBorder}`, borderRadius: 8, display: 'flex', alignItems: 'center' }}>
                <span style={{ fontFamily: BRF, fontSize: 11, fontWeight: 800, color: BR.indigo, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Deposit · 50%</span>
                <span style={{ marginLeft: 'auto', fontFamily: BRF, fontSize: 13.5, fontWeight: 800, color: BR.indigo }}>{fmt(brokerTotal * 0.5)}</span>
              </div>
            </div>

            {/* Right: Shop Rate */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderLeft: `1px solid ${BR.border}`, paddingLeft: 18 }}>
              <div style={{ fontFamily: BRF, fontSize: 10.5, fontWeight: 800, color: BR.text3, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Shop Rate</div>
              <PriceRow label="Subtotal"   value={fmt(clientTotal / 1.078)} small />
              <PriceRow label="Tax (7.8%)" value={fmt(clientTotal - clientTotal / 1.078)} small />
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 2 }}>
                <span style={{ fontFamily: BRF, fontSize: 11.5, fontWeight: 800, color: BR.green, letterSpacing: '0.02em' }}>Client Total</span>
                <span style={{ fontFamily: BRF, fontSize: 18, fontWeight: 800, color: BR.green, letterSpacing: '-0.02em' }}>{fmt(clientTotal)}</span>
              </div>
              <PriceRow label="Deposit"           value={fmt(clientTotal * 0.5)} small />
              <PriceRow label="Remaining Balance" value={fmt(clientTotal * 0.5)} small />
              <div style={{ borderTop: `1px solid ${BR.border}`, margin: '4px 0 0' }} />
              <div style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                marginTop: 6, padding: '8px 11px',
                background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 8,
                transform: `scale(${profitScale})`, transformOrigin: 'center',
                transition: 'transform 0.2s',
              }}>
                <span style={{ fontFamily: BRF, fontSize: 11, fontWeight: 800, color: '#6D28D9', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Total Broker Profit</span>
                <span style={{ fontFamily: BRF, fontSize: 18, fontWeight: 800, color: '#6D28D9', letterSpacing: '-0.02em' }}>{fmt(brokerProfit)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 18, padding: '14px 28px', background: BR.surface2, borderTop: `1px solid ${BR.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={{
            flex: 1, padding: '10px 14px',
            background: BR.indigo, color: '#fff', border: 'none',
            borderRadius: 9, fontFamily: BRF, fontSize: 13.5, fontWeight: 700,
            opacity: 0.9,
          }}>Save Draft</button>
          {submitted && (
            <div style={{ opacity: submittedT, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: BR.greenSoft, color: BR.green, border: `1px solid ${BR.greenBorder}`, borderRadius: 8, fontFamily: BRF, fontSize: 12.5, fontWeight: 700 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={BR.green} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11"/></svg>
              Routed to Pinegrove Apparel
            </div>
          )}
          <button style={{
            padding: '11px 22px',
            background: submitted ? BR.greenSoft : BR.teal,
            color: submitted ? BR.green : '#fff',
            border: submitted ? `1px solid ${BR.greenBorder}` : 'none',
            borderRadius: 9,
            fontFamily: BRF, fontSize: 14, fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: submitted ? 'none' : '0 6px 16px rgba(13,148,136,0.32)',
            transition: 'all 0.25s',
          }}>
            {submitting && (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" style={{ transform: `rotate(${t * 720}deg)` }}><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
            )}
            {submitted ? 'Submitted ✓' : (submitting ? 'Submitting…' : 'Submit to Shop')}
          </button>
        </div>
      </div>

      <BRCaption text="Live vendor pricing. Broker price next to shop price. Profit in real time." time={localTime} duration={duration} delay={3.6} />
    </BrokerApp>
  );
}

// ─── Quote-builder helpers ─────────────────────────────────────────────────
function SmallField({ label, value }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontFamily: BRF, fontSize: 10.5, fontWeight: 800, color: BR.text3, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{
        padding: '8px 11px',
        background: '#fff', border: `1px solid ${BR.border}`, borderRadius: 8,
        fontFamily: BRF, fontSize: 13, color: BR.text1, fontWeight: 600,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{value}</div>
    </div>
  );
}

function BLECell({ label, children }) {
  return (
    <div>
      <div style={{ fontFamily: BRF, fontSize: 10, fontWeight: 800, color: BR.text3, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}

function BLESmall({ label, value, mono }) {
  return (
    <div>
      <div style={{ fontFamily: BRF, fontSize: 10, fontWeight: 800, color: BR.text3, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>{label}</div>
      <div style={{
        padding: '7px 10px', background: '#fff',
        border: `1px solid ${BR.border}`, borderRadius: 7,
        fontFamily: mono ? BRM : BRF, fontSize: 12.5, color: BR.text1, fontWeight: 600,
      }}>{value}</div>
    </div>
  );
}

function ChipValue({ text, swatch, mono }) {
  return (
    <div style={{
      padding: '8px 11px', background: '#fff',
      border: `1px solid ${BR.border}`, borderRadius: 8,
      fontFamily: mono ? BRM : BRF, fontSize: 13, color: BR.text1, fontWeight: 600,
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      {swatch && <div style={{ width: 14, height: 14, borderRadius: 4, background: swatch, border: `1px solid ${BR.border}`, flexShrink: 0 }} />}
      {text}
    </div>
  );
}

function PriceRow({ label, value, muted, italic, small }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
      <span style={{ fontFamily: BRF, fontSize: small ? 11.5 : 12.5, color: BR.text3, fontWeight: 500, fontStyle: italic ? 'italic' : 'normal' }}>{label}</span>
      <span style={{ fontFamily: BRF, fontSize: small ? 12 : 13, color: muted ? BR.text3 : BR.text2, fontWeight: muted ? 500 : 700 }}>{value}</span>
    </div>
  );
}

function fmt(n) {
  return `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 4 — SHOP RECEIVES (15–20s)
// ═══════════════════════════════════════════════════════════════════════════
// Cut to the shop's Quotes page. The broker-submitted quote is at the top
// with a "New from broker" badge, flashing teal-soft on entry. Toast
// confirms "New quote from Marcus Chen (broker)".
function SceneBRShop() {
  const { localTime, duration } = useSprite();
  const t = localTime;
  const pageT = brclamp(t / 0.4, 0, 1);
  const toastT = brclamp((t - 0.5) / 0.4, 0, 1);
  const newRowT = brclamp((t - 0.9) / 0.5, 0, 1);
  const newRowE = breaseOut(newRowT);

  // Flash teal-soft on the new row, fades back to white over 1.5s after it lands
  const flashRemain = brclamp(1 - (t - 0.9 - 0.3) / 1.5, 0, 1);

  const otherQuotes = [
    { id: 'Q-2026-186', client: 'Aldenwood Bookstore',     initials: 'AB', color: '#EEF2FF', amount: '$540.00',   status: 'paid' },
    { id: 'Q-2026-185', client: 'Foxtail Brewing',         initials: 'FB', color: '#FFE4E6', amount: '$920.00',   status: 'sent' },
    { id: 'Q-2026-184', client: 'Driftwood Theatre Co.',   initials: 'DT', color: '#FCE7F3', amount: '$780.00',   status: 'paid' },
    { id: 'Q-2026-183', client: 'Harborview Yacht Club',   initials: 'HV', color: '#CFFAFE', amount: '$1,440.00', status: 'open' },
    { id: 'Q-2026-182', client: 'Cypress Ridge HS',        initials: 'CR', color: '#DBEAFE', amount: '$4,080.50', status: 'sent' },
  ];

  return (
    <ShopApp opacity={pageT}>
      <div style={{ padding: '36px 56px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontFamily: BRF, fontSize: 38, fontWeight: 800, color: BR.text1, letterSpacing: '-0.03em' }}>Quotes</div>
          <div style={{ marginLeft: 'auto' }}>
            <button style={{ padding: '10px 18px', background: BR.indigo, color: '#fff', border: 'none', borderRadius: 8, fontFamily: BRF, fontSize: 14, fontWeight: 700, boxShadow: '0 6px 16px rgba(79,70,229,0.32)' }}>+ New Quote</button>
          </div>
        </div>
      </div>

      <div style={{ padding: '20px 56px 6px', display: 'grid', gridTemplateColumns: '110px 36px 1fr 130px 110px', gap: 16, alignItems: 'center' }}>
        <div style={{ fontFamily: BRF, fontSize: 11.5, fontWeight: 700, color: BR.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Quote</div>
        <div />
        <div style={{ fontFamily: BRF, fontSize: 11.5, fontWeight: 700, color: BR.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Client</div>
        <div style={{ fontFamily: BRF, fontSize: 11.5, fontWeight: 700, color: BR.text3, letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'right' }}>Amount</div>
        <div style={{ fontFamily: BRF, fontSize: 11.5, fontWeight: 700, color: BR.text3, letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'right' }}>Status</div>
      </div>

      <div style={{ padding: '0 56px 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* The newly-arrived broker quote at the top */}
        <div style={{
          opacity: newRowE,
          transform: `translateY(${(1 - newRowE) * -16}px)`,
          background: flashRemain > 0 ? BR.tealSoft : BR.surface,
          border: `2px solid ${flashRemain > 0.6 ? BR.teal : BR.tealBorder}`,
          borderRadius: 12, padding: '14px 18px',
          boxShadow: '0 14px 32px rgba(13,148,136,0.18)',
          transition: 'background 0.6s, border-color 0.6s',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '110px 36px 1fr 130px 110px', gap: 16, alignItems: 'center' }}>
            <div style={{ fontFamily: BRM, fontSize: 13, fontWeight: 600, color: BR.text2 }}>Q-2026-187</div>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: '#E0E7FF', display: 'grid', placeItems: 'center', fontFamily: BRF, fontSize: 10.5, fontWeight: 800, color: BR.text1 }}>GA</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: BRF, fontSize: 14, fontWeight: 700, color: BR.text1, letterSpacing: '-0.01em' }}>Greenbriar Athletics</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={BR.tealDarker} strokeWidth="2"><circle cx="12" cy="8" r="3"/><path d="M6 20c0-3 3-5 6-5s6 2 6 5"/></svg>
                <div style={{ fontFamily: BRF, fontSize: 11.5, color: BR.tealDarker, fontWeight: 700, letterSpacing: '0.01em' }}>From broker · Marcus Chen</div>
              </div>
            </div>
            <div style={{ fontFamily: BRF, fontSize: 15, fontWeight: 800, color: BR.text1, letterSpacing: '-0.01em', textAlign: 'right' }}>$3,210.00</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><StatusPill status="new" /></div>
          </div>
        </div>

        {/* Existing quotes underneath */}
        {otherQuotes.map((q, i) => (
          <div key={q.id} style={{
            background: BR.surface, border: `1px solid ${BR.border}`,
            borderRadius: 12, padding: '14px 18px',
            boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
            opacity: 0.85,
            display: 'grid', gridTemplateColumns: '110px 36px 1fr 130px 110px', gap: 16, alignItems: 'center',
          }}>
            <div style={{ fontFamily: BRM, fontSize: 13, fontWeight: 600, color: BR.text2 }}>{q.id}</div>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: q.color, display: 'grid', placeItems: 'center', fontFamily: BRF, fontSize: 10.5, fontWeight: 800, color: BR.text1 }}>{q.initials}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: BRF, fontSize: 14, fontWeight: 700, color: BR.text1, letterSpacing: '-0.01em' }}>{q.client}</div>
            </div>
            <div style={{ fontFamily: BRF, fontSize: 15, fontWeight: 800, color: BR.text1, letterSpacing: '-0.01em', textAlign: 'right' }}>{q.amount}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><StatusPill status={q.status} /></div>
          </div>
        ))}
      </div>

      {/* Toast */}
      <div style={{
        position: 'absolute', top: 32, right: 56,
        transform: `translateX(${(1 - breaseOut(toastT)) * 40}px)`,
        opacity: toastT,
        background: BR.surface,
        border: `1px solid ${BR.tealBorder}`,
        borderRadius: 12,
        padding: '14px 18px',
        display: 'flex', alignItems: 'center', gap: 14,
        boxShadow: '0 18px 48px rgba(13,148,136,0.18)',
        minWidth: 360,
      }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: BR.tealSoft, display: 'grid', placeItems: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={BR.tealDarker} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3"/><path d="M6 20c0-3 3-5 6-5s6 2 6 5"/></svg>
        </div>
        <div>
          <div style={{ fontFamily: BRF, fontSize: 14, fontWeight: 800, color: BR.text1, letterSpacing: '-0.005em' }}>New quote from your broker</div>
          <div style={{ fontFamily: BRF, fontSize: 12.5, color: BR.text3, marginTop: 2 }}>Marcus Chen · Greenbriar Athletics · $3,210.00</div>
        </div>
      </div>

      <BRCaption text="Shows up in the shop's queue with the broker tagged. Commission auto-tracked." time={localTime} duration={duration} delay={1.6} />
    </ShopApp>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 5 — LOCKUP (20–22s)
// ═══════════════════════════════════════════════════════════════════════════
function SceneBRLockup() {
  const { localTime } = useSprite();
  const t = localTime;
  const logoT = brclamp(t / 0.6, 0, 1);
  const textT = brclamp((t - 0.4) / 0.6, 0, 1);
  return (
    <div style={{ position: 'absolute', inset: 0, background: BR.darkBg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ opacity: logoT, transform: `translateY(${(1-logoT)*8}px)`, display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <BRLogo size={56} />
        <div style={{ fontFamily: BRF, fontSize: 36, fontWeight: 800, color: BR.darkText1, letterSpacing: '-0.025em' }}>InkTracker</div>
      </div>
      <div style={{ opacity: textT, transform: `translateY(${(1-textT)*8}px)`, fontFamily: BRF, fontSize: 26, color: BR.darkText2, marginTop: 8, textAlign: 'center', letterSpacing: '-0.01em' }}>Brokers built in. Commissions tracked.</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
function BrokerDemo() {
  return (
    <>
      <Sprite start={0}  end={3}>   <SceneBRHook />      </Sprite>
      <Sprite start={3}  end={9}>   <SceneBRDashboard /> </Sprite>
      <Sprite start={9}  end={15}>  <SceneBRSubmit />    </Sprite>
      <Sprite start={15} end={20}>  <SceneBRShop />      </Sprite>
      <Sprite start={20} end={22}>  <SceneBRLockup />    </Sprite>
    </>
  );
}
