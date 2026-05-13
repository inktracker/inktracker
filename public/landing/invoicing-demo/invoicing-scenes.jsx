// invoicing-scenes.jsx — InkTracker Invoicing & Payments demo (~22s)
// Same visual system as the other demos. Demo clients only.

const IV = {
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
  rose: '#E11D48',
  roseSoft: '#FFE4E6',
  roseBorder: '#FBCFE8',
  amber: '#D97706',
  amberSoft: '#FEF3C7',
  slate: '#64748B',
  slateSoft: '#F1F5F9',
  qbGreen: '#2CA01C',
};
const IVF = '"Inter", system-ui, -apple-system, sans-serif';
const IVM = '"JetBrains Mono", ui-monospace, monospace';

function ivclamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function iveaseOut(t) { return 1 - Math.pow(1 - t, 3); }
function iveaseIn(t) { return t * t; }

function IVLogo({ size = 32 }) {
  return <img src="assets/inktracker-logo.png" alt="" style={{ width: size, height: size, display: 'block', objectFit: 'contain', flexShrink: 0 }} />;
}

// ─── Demo invoice data (reuses customer-demo names for continuity) ─────────
const DEMO_INVOICES = [
  { id: 'INV-2026-014', client: 'Cypress Ridge HS',        initials: 'CR', color: '#DBEAFE', date: 'May 12', due: 'May 26', amount: '$1,840.50', status: 'sent'    },
  { id: 'INV-2026-013', client: 'Greenbriar Athletics',     initials: 'GA', color: '#E0E7FF', date: 'May 10', due: 'May 24', amount: '$3,210.00', status: 'paid'    },
  { id: 'INV-2026-012', client: 'Foxtail Brewing',          initials: 'FB', color: '#FFE4E6', date: 'May 09', due: 'May 09', amount: '$920.00',   status: 'overdue' },
  { id: 'INV-2026-011', client: 'Bayside Coffee Roasters',  initials: 'BC', color: '#FEF3C7', date: 'May 08', due: 'May 22', amount: '$1,260.00', status: 'paid'    },
  { id: 'INV-2026-010', client: 'Lakeshore Film Festival',  initials: 'LF', color: '#DBEAFE', date: 'May 06', due: 'May 20', amount: '$4,560.00', status: 'sent'    },
  { id: 'INV-2026-009', client: 'Driftwood Theatre Co.',    initials: 'DT', color: '#FCE7F3', date: 'May 05', due: 'May 19', amount: '$780.00',   status: 'paid'    },
  { id: 'INV-2026-008', client: 'Aldenwood Bookstore',      initials: 'AB', color: '#EEF2FF', date: 'May 03', due: 'May 17', amount: '$540.00',   status: 'draft'   },
];

// Sidebar nav (Invoices active)
const IV_NAV = [
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

function IVNavIcon({ kind, color }) {
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

function IVSidebar() {
  return (
    <div style={{
      position: 'absolute', left: 0, top: 0, bottom: 0, width: 232,
      borderRight: `1px solid ${IV.border}`, background: IV.surface,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 20px 18px' }}>
        <IVLogo size={36} />
        <div>
          <div style={{ fontFamily: IVF, fontSize: 16, fontWeight: 800, color: IV.text1, letterSpacing: '-0.015em' }}>Northwind Print</div>
          <div style={{ fontFamily: IVF, fontSize: 11.5, color: IV.text3, marginTop: 1 }}>Shop Manager</div>
        </div>
      </div>
      <div style={{ padding: '0 10px', flex: 1 }}>
        {IV_NAV.map((it) => {
          const a = it.label === 'Invoices';
          return (
            <div key={it.label} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '11px 14px', borderRadius: 8, marginBottom: 2,
              background: a ? IV.accent : 'transparent',
            }}>
              <IVNavIcon kind={it.icon} color={a ? '#fff' : IV.text3} />
              <div style={{ fontFamily: IVF, fontSize: 14, fontWeight: a ? 700 : 500, color: a ? '#fff' : IV.text2 }}>{it.label}</div>
            </div>
          );
        })}
      </div>
      <div style={{ padding: '14px 16px', borderTop: `1px solid ${IV.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 34, background: IV.surface2, border: `1px solid ${IV.border}`, borderRadius: 8, display: 'flex', alignItems: 'center', padding: '0 10px', gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={IV.text3} strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
          <span style={{ fontFamily: IVF, fontSize: 12, color: IV.text3 }}>Search…</span>
        </div>
      </div>
    </div>
  );
}

function IVApp({ children, opacity = 1 }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: IV.appBg, opacity }}>
      <IVSidebar />
      <div style={{ position: 'absolute', left: 232, right: 0, top: 0, bottom: 0, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

// ─── Status pill ───────────────────────────────────────────────────────────
function StatusPill({ status }) {
  const map = {
    paid:    { label: 'Paid',    bg: IV.greenSoft, fg: IV.green,  br: IV.greenBorder },
    sent:    { label: 'Sent',    bg: IV.accentSoft, fg: IV.accent, br: IV.accentBorder },
    overdue: { label: 'Overdue', bg: IV.roseSoft,  fg: IV.rose,   br: IV.roseBorder },
    draft:   { label: 'Draft',   bg: IV.slateSoft, fg: IV.slate,  br: IV.border },
  };
  const s = map[status] || map.draft;
  return (
    <div style={{
      padding: '4px 10px', background: s.bg, color: s.fg,
      border: `1px solid ${s.br}`,
      borderRadius: 999, fontFamily: IVF, fontSize: 11.5, fontWeight: 700, letterSpacing: '0.02em',
      whiteSpace: 'nowrap',
    }}>{s.label}</div>
  );
}

// ─── Invoice row ───────────────────────────────────────────────────────────
function InvoiceRow({ inv, highlight, dim, statusOverride, flashEmerald }) {
  const status = statusOverride || inv.status;
  return (
    <div style={{
      background: flashEmerald ? IV.greenSoft : IV.surface,
      border: highlight ? `2px solid ${IV.accent}` : `1px solid ${IV.border}`,
      borderRadius: 12, padding: '14px 18px',
      boxShadow: highlight ? '0 14px 32px rgba(79,70,229,0.18)' : '0 1px 2px rgba(15,23,42,0.04)',
      opacity: dim ? 0.42 : 1,
      transition: 'background 0.4s',
      display: 'grid',
      gridTemplateColumns: '52px 200px 1fr 110px 110px 130px 100px',
      alignItems: 'center', gap: 16,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 10, background: inv.color,
        display: 'grid', placeItems: 'center',
        fontFamily: IVF, fontSize: 13, fontWeight: 800, color: IV.text1, letterSpacing: '0.02em',
      }}>{inv.initials}</div>
      <div style={{ fontFamily: IVM, fontSize: 13, fontWeight: 600, color: IV.text2, letterSpacing: '-0.005em' }}>{inv.id}</div>
      <div style={{ fontFamily: IVF, fontSize: 14.5, fontWeight: 700, color: IV.text1, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{inv.client}</div>
      <div style={{ fontFamily: IVF, fontSize: 13, color: IV.text3, fontWeight: 500 }}>{inv.date}</div>
      <div style={{ fontFamily: IVF, fontSize: 13, color: status === 'overdue' ? IV.rose : IV.text3, fontWeight: status === 'overdue' ? 700 : 500 }}>{inv.due}</div>
      <div style={{ fontFamily: IVF, fontSize: 15, fontWeight: 800, color: IV.text1, letterSpacing: '-0.01em', textAlign: 'right' }}>{inv.amount}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><StatusPill status={status} /></div>
    </div>
  );
}

// ─── Caption ───────────────────────────────────────────────────────────────
function IVCaption({ text, time, duration, delay = 0.3, fade = 0.4 }) {
  const local = time - delay;
  const tIn = ivclamp(local / fade, 0, 1);
  const tOut = ivclamp((duration - delay - local) / fade, 0, 1);
  const op = iveaseOut(Math.min(tIn, tOut));
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 36, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{
        opacity: op,
        background: 'rgba(11,11,14,0.92)', color: '#F4F4F5',
        fontFamily: IVF, fontSize: 17, fontWeight: 500, letterSpacing: '-0.005em',
        padding: '12px 22px', borderRadius: 999,
        boxShadow: '0 12px 32px rgba(0,0,0,0.25)', whiteSpace: 'nowrap',
      }}>{text}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 1 — HOOK (0–3s)
// ═══════════════════════════════════════════════════════════════════════════
function SceneIVHook() {
  const { localTime } = useSprite();
  const t = localTime;
  const logoT = ivclamp(t / 0.6, 0, 1);
  const h1T = ivclamp((t - 0.5) / 0.5, 0, 1);
  const h2T = ivclamp((t - 0.95) / 0.5, 0, 1);
  const subT = ivclamp((t - 1.6) / 0.5, 0, 1);
  return (
    <div style={{ position: 'absolute', inset: 0, background: IV.darkBg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ opacity: logoT, transform: `translateY(${(1-logoT)*8}px)`, display: 'flex', alignItems: 'center', gap: 14, marginBottom: 38 }}>
        <IVLogo size={40} />
        <div style={{ fontFamily: IVF, fontSize: 22, fontWeight: 700, color: IV.darkText1, letterSpacing: '-0.015em' }}>InkTracker</div>
      </div>
      <div style={{ opacity: h1T, transform: `translateY(${(1-h1T)*10}px)`, fontFamily: IVF, fontSize: 96, fontWeight: 800, color: IV.darkText1, letterSpacing: '-0.045em', lineHeight: 1, textAlign: 'center' }}>Send. Track.</div>
      <div style={{ opacity: h2T, transform: `translateY(${(1-h2T)*10}px)`, fontFamily: IVF, fontSize: 96, fontWeight: 800, color: '#86EFAC', letterSpacing: '-0.045em', lineHeight: 1.02, textAlign: 'center', marginTop: 10 }}>Get paid.</div>
      <div style={{ opacity: subT, transform: `translateY(${(1-subT)*8}px)`, fontFamily: IVF, fontSize: 20, color: IV.darkText2, marginTop: 36, textAlign: 'center' }}>Invoices, QuickBooks sync, and one-click payment links.</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 2 — INVOICE LIST (3–9s)
// ═══════════════════════════════════════════════════════════════════════════
function SceneIVList() {
  const { localTime, duration } = useSprite();
  const t = localTime;
  const pageT = ivclamp(t / 0.4, 0, 1);
  const headerT = ivclamp((t - 0.2) / 0.4, 0, 1);
  const statsT = ivclamp((t - 0.4) / 0.45, 0, 1);

  return (
    <IVApp opacity={pageT}>
      <div style={{ padding: '36px 56px 0', opacity: headerT }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontFamily: IVF, fontSize: 38, fontWeight: 800, color: IV.text1, letterSpacing: '-0.03em' }}>Invoices</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
            <button style={{ padding: '10px 18px', background: '#fff', border: `1px solid ${IV.border}`, borderRadius: 8, fontFamily: IVF, fontSize: 14, fontWeight: 600, color: IV.text2, display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={IV.text2} strokeWidth="1.8"><path d="M12 5v14M5 12h14"/></svg>
              Export to QuickBooks
            </button>
            <button style={{ padding: '10px 18px', background: IV.accent, color: '#fff', border: 'none', borderRadius: 8, fontFamily: IVF, fontSize: 14, fontWeight: 700, boxShadow: '0 6px 16px rgba(79,70,229,0.32)' }}>+ New Invoice</button>
          </div>
        </div>
      </div>

      <div style={{ padding: '24px 56px 0', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, opacity: statsT }}>
        <StatCard label="Outstanding"        value="$7,361.00"  trend="3 invoices" color={IV.accent} />
        <StatCard label="Collected (May)"    value="$5,250.00"  trend="3 paid"     color={IV.green} />
        <StatCard label="Overdue"            value="$920.00"    trend="1 invoice"  color={IV.rose} alert />
      </div>

      <div style={{ padding: '20px 56px 6px', display: 'grid', gridTemplateColumns: '52px 200px 1fr 110px 110px 130px 100px', gap: 16, alignItems: 'center' }}>
        <div />
        <div style={{ fontFamily: IVF, fontSize: 11.5, fontWeight: 700, color: IV.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Invoice</div>
        <div style={{ fontFamily: IVF, fontSize: 11.5, fontWeight: 700, color: IV.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Client</div>
        <div style={{ fontFamily: IVF, fontSize: 11.5, fontWeight: 700, color: IV.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Issued</div>
        <div style={{ fontFamily: IVF, fontSize: 11.5, fontWeight: 700, color: IV.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Due</div>
        <div style={{ fontFamily: IVF, fontSize: 11.5, fontWeight: 700, color: IV.text3, letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'right' }}>Amount</div>
        <div style={{ fontFamily: IVF, fontSize: 11.5, fontWeight: 700, color: IV.text3, letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'right' }}>Status</div>
      </div>

      <div style={{ padding: '0 56px 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {DEMO_INVOICES.map((inv, i) => {
          const start = 0.85 + i * 0.07;
          const tt = ivclamp((t - start) / 0.35, 0, 1);
          const e = iveaseOut(tt);
          return (
            <div key={inv.id} style={{ opacity: e, transform: `translateY(${(1-e)*12}px)` }}>
              <InvoiceRow inv={inv} />
            </div>
          );
        })}
      </div>

      <IVCaption text="Every invoice — issued, paid, and overdue — at a glance." time={localTime} duration={duration} delay={0.7} />
    </IVApp>
  );
}

function StatCard({ label, value, trend, color, alert }) {
  return (
    <div style={{
      background: IV.surface, border: `1px solid ${alert ? IV.roseBorder : IV.border}`,
      borderRadius: 12, padding: '18px 22px',
      boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ fontFamily: IVF, fontSize: 12, fontWeight: 700, color: IV.text3, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontFamily: IVF, fontSize: 32, fontWeight: 800, color, letterSpacing: '-0.025em' }}>{value}</div>
      <div style={{ fontFamily: IVF, fontSize: 12.5, color: IV.text3, fontWeight: 500 }}>{trend}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 3 — SEND TO CUSTOMER (9–15s)
// ═══════════════════════════════════════════════════════════════════════════
function SceneIVSend() {
  const { localTime, duration } = useSprite();
  const t = localTime;
  // Modal entry (0–0.5s), QB toggle pulse (~2.0s), send-click (~3.4s),
  // sending spinner (3.4–4.0s), sent toast (4.0–end).
  const modalT = ivclamp(t / 0.5, 0, 1);
  const modalE = iveaseOut(modalT);

  const qbCheckedAt = 2.0;
  const qbChecked = t >= qbCheckedAt;
  const qbPulse = ivclamp((t - qbCheckedAt) / 0.35, 0, 1);

  const sendClickAt = 3.4;
  const sending = t >= sendClickAt && t < sendClickAt + 0.7;
  const sent = t >= sendClickAt + 0.7;
  const sentT = ivclamp((t - sendClickAt - 0.7) / 0.4, 0, 1);

  return (
    <IVApp opacity={1}>
      {/* Dimmed list behind the modal */}
      <div style={{ padding: '36px 56px 0', opacity: 0.35 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontFamily: IVF, fontSize: 38, fontWeight: 800, color: IV.text1, letterSpacing: '-0.03em' }}>Invoices</div>
        </div>
      </div>

      {/* Modal backdrop */}
      <div style={{ position: 'absolute', inset: 0, background: `rgba(15,23,42,${0.42 * modalE})`, pointerEvents: 'none' }} />

      {/* Modal */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: `translate(-50%, calc(-50% + ${(1 - modalE) * 24}px))`,
        opacity: modalE,
        width: 940, maxHeight: 920,
        background: IV.surface, border: `1px solid ${IV.border}`,
        borderRadius: 18, boxShadow: '0 32px 96px rgba(15,23,42,0.32)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Modal header */}
        <div style={{ padding: '24px 32px', borderBottom: `1px solid ${IV.border}`, display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 46, height: 46, borderRadius: 10, background: '#DBEAFE',
            display: 'grid', placeItems: 'center',
            fontFamily: IVF, fontSize: 15, fontWeight: 800, color: IV.text1,
          }}>CR</div>
          <div>
            <div style={{ fontFamily: IVF, fontSize: 22, fontWeight: 800, color: IV.text1, letterSpacing: '-0.02em' }}>Cypress Ridge HS</div>
            <div style={{ fontFamily: IVM, fontSize: 12.5, color: IV.text3, marginTop: 2 }}>INV-2026-014 · Issued May 12 · Due May 26</div>
          </div>
          <div style={{ marginLeft: 'auto' }}><StatusPill status={sent ? 'sent' : 'draft'} /></div>
        </div>

        {/* Line items */}
        <div style={{ padding: '20px 32px 12px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 110px 120px', gap: 16, padding: '0 4px 10px', borderBottom: `1px solid ${IV.border}` }}>
            <div style={{ fontFamily: IVF, fontSize: 11.5, fontWeight: 700, color: IV.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Item</div>
            <div style={{ fontFamily: IVF, fontSize: 11.5, fontWeight: 700, color: IV.text3, letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'center' }}>Qty</div>
            <div style={{ fontFamily: IVF, fontSize: 11.5, fontWeight: 700, color: IV.text3, letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'right' }}>Unit</div>
            <div style={{ fontFamily: IVF, fontSize: 11.5, fontWeight: 700, color: IV.text3, letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'right' }}>Total</div>
          </div>
          {[
            { item: "Bella 3001 — 2-color screen print",  qty: 84,  unit: '$13.50', total: '$1,134.00' },
            { item: "Champion S700 hoodie — embroidery", qty: 24,  unit: '$22.00', total: '$528.00' },
            { item: "Setup fee — 2 screens",              qty: 1,   unit: '$45.00', total: '$45.00' },
          ].map((row, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 110px 120px', gap: 16, padding: '12px 4px', borderBottom: `1px solid ${IV.border}` }}>
              <div style={{ fontFamily: IVF, fontSize: 14, color: IV.text1, fontWeight: 600 }}>{row.item}</div>
              <div style={{ fontFamily: IVF, fontSize: 14, color: IV.text2, fontWeight: 500, textAlign: 'center' }}>{row.qty}</div>
              <div style={{ fontFamily: IVF, fontSize: 14, color: IV.text2, fontWeight: 500, textAlign: 'right' }}>{row.unit}</div>
              <div style={{ fontFamily: IVF, fontSize: 14, color: IV.text1, fontWeight: 700, textAlign: 'right' }}>{row.total}</div>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div style={{ padding: '8px 32px 20px', display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { label: 'Subtotal', value: '$1,707.00' },
              { label: 'Sales tax (7.8%)', value: '$133.50' },
            ].map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ fontFamily: IVF, fontSize: 13, color: IV.text3, fontWeight: 500 }}>{r.label}</div>
                <div style={{ marginLeft: 'auto', fontFamily: IVF, fontSize: 14, color: IV.text2, fontWeight: 600 }}>{r.value}</div>
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', borderTop: `1px solid ${IV.border}`, paddingTop: 10, marginTop: 4 }}>
              <div style={{ fontFamily: IVF, fontSize: 14, color: IV.text1, fontWeight: 700, letterSpacing: '0.02em' }}>Total</div>
              <div style={{ marginLeft: 'auto', fontFamily: IVF, fontSize: 22, color: IV.text1, fontWeight: 800, letterSpacing: '-0.02em' }}>$1,840.50</div>
            </div>
          </div>
        </div>

        {/* Send controls */}
        <div style={{ padding: '20px 32px 24px', background: IV.surface2, borderTop: `1px solid ${IV.border}`, display: 'flex', alignItems: 'center', gap: 18 }}>
          {/* QuickBooks payment link toggle */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px',
            background: qbChecked ? IV.greenSoft : '#fff',
            border: `1px solid ${qbChecked ? IV.greenBorder : IV.border}`,
            borderRadius: 8,
            transform: `scale(${1 + qbPulse * (1 - qbPulse) * 0.4})`,
            transition: 'background 0.2s, border-color 0.2s',
          }}>
            <div style={{
              width: 18, height: 18, borderRadius: 4,
              background: qbChecked ? IV.qbGreen : '#fff',
              border: `1.5px solid ${qbChecked ? IV.qbGreen : IV.borderStrong}`,
              display: 'grid', placeItems: 'center',
            }}>
              {qbChecked && (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11"/></svg>
              )}
            </div>
            <div style={{ fontFamily: IVF, fontSize: 13.5, fontWeight: 700, color: IV.text1 }}>Include QuickBooks payment link</div>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {sent && (
              <div style={{ opacity: sentT, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: IV.greenSoft, color: IV.green, border: `1px solid ${IV.greenBorder}`, borderRadius: 8, fontFamily: IVF, fontSize: 13, fontWeight: 700 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={IV.green} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11"/></svg>
                Sent to billing@cypressridge.example.edu
              </div>
            )}
            <button style={{
              padding: '11px 22px',
              background: sent ? IV.greenSoft : IV.accent,
              color: sent ? IV.green : '#fff',
              border: sent ? `1px solid ${IV.greenBorder}` : 'none',
              borderRadius: 9,
              fontFamily: IVF, fontSize: 14.5, fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: 10,
              boxShadow: sent ? 'none' : '0 6px 16px rgba(79,70,229,0.32)',
              transition: 'all 0.25s',
            }}>
              {sending && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" style={{ animation: 'none', transform: `rotate(${t * 720}deg)` }}><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
              )}
              {sent ? 'Sent ✓' : (sending ? 'Sending…' : 'Send to Customer')}
            </button>
          </div>
        </div>
      </div>

      <IVCaption text="One-click QuickBooks payment link. Sent in seconds." time={localTime} duration={duration} delay={0.6} />
    </IVApp>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 4 — PAYMENT RECEIVED (15–20s)
// ═══════════════════════════════════════════════════════════════════════════
function SceneIVReceived() {
  const { localTime, duration } = useSprite();
  const t = localTime;
  const pageT = ivclamp(t / 0.3, 0, 1);

  // Toast slides in at 0.5s, the CR row flips sent→paid at 1.5s and flashes,
  // collected counter ticks up 1.7s–2.6s.
  const toastT = ivclamp((t - 0.5) / 0.4, 0, 1);
  const flipAt = 1.5;
  const flipped = t >= flipAt;
  const flashT = ivclamp((t - flipAt) / 1.2, 0, 1); // green-soft flash lifetime

  // Counter tick: 5250.00 → 7090.50
  const counterStart = 1.7, counterEnd = 2.6;
  const cT = ivclamp((t - counterStart) / (counterEnd - counterStart), 0, 1);
  const cE = iveaseOut(cT);
  const counterValue = 5250 + (1840.50 * cE);
  const outstandingValue = 7361 - (1840.50 * cE);

  // Update the invoice list: CR is now paid
  const invs = DEMO_INVOICES.map((inv) =>
    inv.id === 'INV-2026-014' && flipped ? { ...inv, status: 'paid' } : inv,
  );

  return (
    <IVApp opacity={pageT}>
      <div style={{ padding: '36px 56px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontFamily: IVF, fontSize: 38, fontWeight: 800, color: IV.text1, letterSpacing: '-0.03em' }}>Invoices</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
            <button style={{ padding: '10px 18px', background: '#fff', border: `1px solid ${IV.border}`, borderRadius: 8, fontFamily: IVF, fontSize: 14, fontWeight: 600, color: IV.text2 }}>Export to QuickBooks</button>
            <button style={{ padding: '10px 18px', background: IV.accent, color: '#fff', border: 'none', borderRadius: 8, fontFamily: IVF, fontSize: 14, fontWeight: 700, boxShadow: '0 6px 16px rgba(79,70,229,0.32)' }}>+ New Invoice</button>
          </div>
        </div>
      </div>

      <div style={{ padding: '24px 56px 0', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        <StatCard label="Outstanding"     value={`$${outstandingValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} trend={flipped ? "2 invoices" : "3 invoices"} color={IV.accent} />
        <StatCard label="Collected (May)" value={`$${counterValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}       trend={flipped ? "4 paid" : "3 paid"}      color={IV.green} />
        <StatCard label="Overdue"         value="$920.00" trend="1 invoice"  color={IV.rose} alert />
      </div>

      <div style={{ padding: '20px 56px 6px', display: 'grid', gridTemplateColumns: '52px 200px 1fr 110px 110px 130px 100px', gap: 16, alignItems: 'center' }}>
        <div />
        <div style={{ fontFamily: IVF, fontSize: 11.5, fontWeight: 700, color: IV.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Invoice</div>
        <div style={{ fontFamily: IVF, fontSize: 11.5, fontWeight: 700, color: IV.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Client</div>
        <div style={{ fontFamily: IVF, fontSize: 11.5, fontWeight: 700, color: IV.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Issued</div>
        <div style={{ fontFamily: IVF, fontSize: 11.5, fontWeight: 700, color: IV.text3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Due</div>
        <div style={{ fontFamily: IVF, fontSize: 11.5, fontWeight: 700, color: IV.text3, letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'right' }}>Amount</div>
        <div style={{ fontFamily: IVF, fontSize: 11.5, fontWeight: 700, color: IV.text3, letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'right' }}>Status</div>
      </div>

      <div style={{ padding: '0 56px 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {invs.map((inv) => {
          const isCR = inv.id === 'INV-2026-014';
          // Flash green for the CR row only, fading back to white over ~1.2s
          const flashing = isCR && flipped && flashT < 1;
          return (
            <InvoiceRow
              key={inv.id}
              inv={inv}
              flashEmerald={flashing}
              highlight={isCR && flipped && flashT < 0.4}
            />
          );
        })}
      </div>

      {/* Payment received toast */}
      <div style={{
        position: 'absolute', top: 32, right: 56,
        transform: `translateX(${(1 - iveaseOut(toastT)) * 40}px)`,
        opacity: toastT,
        background: IV.surface,
        border: `1px solid ${IV.greenBorder}`,
        borderRadius: 12,
        padding: '14px 18px',
        display: 'flex', alignItems: 'center', gap: 14,
        boxShadow: '0 18px 48px rgba(22,163,74,0.18)',
        minWidth: 360,
      }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: IV.greenSoft, display: 'grid', placeItems: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={IV.green} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11"/></svg>
        </div>
        <div>
          <div style={{ fontFamily: IVF, fontSize: 14, fontWeight: 800, color: IV.text1, letterSpacing: '-0.005em' }}>Payment received · $1,840.50</div>
          <div style={{ fontFamily: IVF, fontSize: 12.5, color: IV.text3, marginTop: 2 }}>Cypress Ridge HS · via QuickBooks Payments</div>
        </div>
      </div>

      <IVCaption text="Customer pays. Numbers update. QuickBooks reconciled." time={localTime} duration={duration} delay={2.2} />
    </IVApp>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 5 — LOCKUP (20–22s)
// ═══════════════════════════════════════════════════════════════════════════
function SceneIVLockup() {
  const { localTime } = useSprite();
  const t = localTime;
  const logoT = ivclamp(t / 0.6, 0, 1);
  const textT = ivclamp((t - 0.4) / 0.6, 0, 1);
  return (
    <div style={{ position: 'absolute', inset: 0, background: IV.darkBg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ opacity: logoT, transform: `translateY(${(1-logoT)*8}px)`, display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <IVLogo size={56} />
        <div style={{ fontFamily: IVF, fontSize: 36, fontWeight: 800, color: IV.darkText1, letterSpacing: '-0.025em' }}>InkTracker</div>
      </div>
      <div style={{ opacity: textT, transform: `translateY(${(1-textT)*8}px)`, fontFamily: IVF, fontSize: 26, color: IV.darkText2, marginTop: 8, textAlign: 'center', letterSpacing: '-0.01em' }}>Invoicing built into the workflow.</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Demo wrapper
// ═══════════════════════════════════════════════════════════════════════════
function InvoicingDemo() {
  return (
    <>
      <Sprite start={0}  end={3}>   <SceneIVHook />     </Sprite>
      <Sprite start={3}  end={9}>   <SceneIVList />     </Sprite>
      <Sprite start={9}  end={15}>  <SceneIVSend />     </Sprite>
      <Sprite start={15} end={20}>  <SceneIVReceived /> </Sprite>
      <Sprite start={20} end={22}>  <SceneIVLockup />   </Sprite>
    </>
  );
}
