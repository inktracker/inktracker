// shopfloor-scenes.jsx — InkTracker Shop Floor demo (~22s)
// Mirrors the real ShopFloor page: indigo header, job list, step badges,
// checklist per step (Pre-Press / Printing / etc.). Framed in a tablet
// bezel for scenes 2–3 to signal "tablet-ready"; scene 4 cuts to the
// shop's desktop Production view to show the real-time sync.

const SF = {
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
  indigo: '#4F46E5',
  indigoSoft: '#EEF2FF',
  indigoBorder: '#C7D2FE',
  // Production stage colors — match ShopFloor.jsx STEP_COLORS
  purple:    '#A855F7', purpleSoft:    '#FAF5FF', purpleBorder:    '#E9D5FF', // Art Approval
  amber:     '#F59E0B', amberSoft:     '#FFFBEB', amberBorder:     '#FDE68A', // Order Goods
  blue:      '#3B82F6', blueSoft:      '#EFF6FF', blueBorder:      '#BFDBFE', // Pre-Press
  indigoSt:  '#4F46E5', indigoStSoft:  '#EEF2FF', indigoStBorder:  '#C7D2FE', // Printing
  slate:     '#64748B', slateSoft:     '#F1F5F9', slateBorder:     '#CBD5E1', // Completed
  green:     '#16A34A',
  greenSoft: '#DCFCE7',
  greenBorder: '#86EFAC',
  // Demo accent
  orange:     '#F97316',
  orangeSoft: '#FFF7ED',
  orangeBorder: '#FED7AA',
};
const SFF = '"Inter", system-ui, -apple-system, sans-serif';
const SFM = '"JetBrains Mono", ui-monospace, monospace';

function sfclamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function sfeaseOut(t) { return 1 - Math.pow(1 - t, 3); }

function SFLogo({ size = 32 }) {
  return <img src="assets/inktracker-logo.png" alt="" style={{ width: size, height: size, display: 'block', objectFit: 'contain', flexShrink: 0 }} />;
}

// Stage colors mapped by name
function stepColor(step) {
  switch (step) {
    case 'Art Approval': return { bg: SF.purple,   soft: SF.purpleSoft,   br: SF.purpleBorder };
    case 'Order Goods':  return { bg: SF.amber,    soft: SF.amberSoft,    br: SF.amberBorder };
    case 'Pre-Press':    return { bg: SF.blue,     soft: SF.blueSoft,     br: SF.blueBorder };
    case 'Printing':     return { bg: SF.indigoSt, soft: SF.indigoStSoft, br: SF.indigoStBorder };
    case 'Completed':    return { bg: SF.slate,    soft: SF.slateSoft,    br: SF.slateBorder };
    default:             return { bg: SF.slate,    soft: SF.slateSoft,    br: SF.slateBorder };
  }
}

// ─── Demo job tickets (active orders on the floor) ─────────────────────────
const DEMO_JOBS = [
  { id: 'ORD-2026-122', client: 'Greenbriar Athletics',    initials: 'GA', color: '#E0E7FF', qty: 150, step: 'Printing',    due: 'May 27',  rush: false },
  { id: 'ORD-2026-121', client: 'Foxtail Brewing',          initials: 'FB', color: '#FFE4E6', qty: 80,  step: 'Pre-Press',   due: 'May 28',  rush: false },
  { id: 'ORD-2026-119', client: 'Cypress Ridge HS',         initials: 'CR', color: '#DBEAFE', qty: 240, step: 'Order Goods', due: 'Jun 04',  rush: true  },
  { id: 'ORD-2026-118', client: 'Driftwood Theatre Co.',    initials: 'DT', color: '#FCE7F3', qty: 60,  step: 'Art Approval',due: 'Jun 10',  rush: false },
];

// Real STEP_TASKS from ShopFloor.jsx (Printing stage subset)
const PRINTING_TASKS = [
  'Mount screens on press',
  'Run test prints',
  'Get test approval',
  'Run full batch',
  'Flash/cure prints',
  'Quality inspect',
  'Fold & tag',
  'Count pieces',
  'Bag/box order',
  'Stage for pickup',
];

// ─── Caption ───────────────────────────────────────────────────────────────
function SFCaption({ text, time, duration, delay = 0.3, fade = 0.4 }) {
  const local = time - delay;
  const tIn = sfclamp(local / fade, 0, 1);
  const tOut = sfclamp((duration - delay - local) / fade, 0, 1);
  const op = sfeaseOut(Math.min(tIn, tOut));
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 36, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{
        opacity: op,
        background: 'rgba(11,11,14,0.92)', color: '#F4F4F5',
        fontFamily: SFF, fontSize: 17, fontWeight: 500, letterSpacing: '-0.005em',
        padding: '12px 22px', borderRadius: 999,
        boxShadow: '0 12px 32px rgba(0,0,0,0.25)', whiteSpace: 'nowrap',
      }}>{text}</div>
    </div>
  );
}

// ─── Tablet bezel wrapper ──────────────────────────────────────────────────
// 4:3 device with a thick black bezel, camera dot, indicator light. Inner
// "screen" is the actual UI surface.
function TabletFrame({ children, entryProgress = 1 }) {
  const e = sfeaseOut(entryProgress);
  return (
    <div style={{ position: 'absolute', inset: 0, background: SF.darkBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        opacity: e,
        transform: `translateY(${(1-e) * 20}px) scale(${0.95 + 0.05 * e})`,
        width: 1340, height: 980,
        background: '#111315',
        borderRadius: 44,
        padding: 28,
        boxShadow: '0 40px 100px rgba(0,0,0,0.45), inset 0 0 0 2px rgba(255,255,255,0.04)',
        position: 'relative',
      }}>
        {/* Camera dot */}
        <div style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', width: 8, height: 8, borderRadius: 999, background: '#2A2D31' }} />
        {/* Inner screen */}
        <div style={{
          width: '100%', height: '100%',
          background: SF.appBg,
          borderRadius: 18, overflow: 'hidden',
          position: 'relative',
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── Shop Floor header (matches the indigo header from ShopFloor.jsx) ─────
function ShopFloorHeader({ employeeName = 'Aiden Vega' }) {
  return (
    <div style={{
      height: 72, background: SF.indigo, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 28px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <SFLogo size={36} />
        <div>
          <div style={{ fontFamily: SFF, fontSize: 19, fontWeight: 800, letterSpacing: '-0.015em' }}>Shop Floor</div>
          <div style={{ fontFamily: SFF, fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>Northwind Print · {employeeName}</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ padding: '7px 13px', background: 'rgba(255,255,255,0.12)', borderRadius: 999, fontFamily: SFF, fontSize: 12.5, fontWeight: 700 }}>4 active</div>
        <div style={{ width: 38, height: 38, borderRadius: 999, background: 'rgba(255,255,255,0.18)', display: 'grid', placeItems: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15A9 9 0 1 1 19 6.5L23 10"/></svg>
        </div>
      </div>
    </div>
  );
}

// ─── Step badge ───────────────────────────────────────────────────────────
function StepBadge({ step, large }) {
  const c = stepColor(step);
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: large ? '6px 14px' : '4px 10px',
      background: c.soft, color: c.bg.replace(/[0-9A-Fa-f]{6}/, () => c.bg.slice(1)),
      border: `1px solid ${c.br}`, borderRadius: 999,
      fontFamily: SFF, fontSize: large ? 13 : 11.5, fontWeight: 700, letterSpacing: '0.02em',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: c.bg }} />
      <span style={{ color: '#0F172A' }}>{step}</span>
    </div>
  );
}

// ─── Job card (touch-friendly) ────────────────────────────────────────────
function JobCard({ job, selected, dim }) {
  return (
    <div style={{
      background: selected ? SF.indigoSoft : SF.surface,
      border: `${selected ? 2 : 1}px solid ${selected ? SF.indigo : SF.border}`,
      borderRadius: 14,
      padding: '16px 18px',
      boxShadow: selected ? '0 10px 28px rgba(79,70,229,0.18)' : '0 1px 2px rgba(15,23,42,0.04)',
      display: 'flex', alignItems: 'center', gap: 14,
      opacity: dim ? 0.5 : 1,
      transition: 'all 0.25s',
    }}>
      <div style={{ width: 48, height: 48, borderRadius: 12, background: job.color, display: 'grid', placeItems: 'center', fontFamily: SFF, fontSize: 14, fontWeight: 800, color: SF.text1 }}>{job.initials}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontFamily: SFF, fontSize: 16, fontWeight: 800, color: SF.text1, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.client}</div>
          {job.rush && (
            <div style={{ padding: '2px 8px', background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FECACA', borderRadius: 5, fontFamily: SFF, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.04em' }}>RUSH</div>
          )}
        </div>
        <div style={{ fontFamily: SFM, fontSize: 12, color: SF.text3, marginTop: 3 }}>{job.id} · {job.qty} pcs · due {job.due}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
        <StepBadge step={job.step} />
      </div>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={SF.text4} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 1 — HOOK (0–3s)
// ═══════════════════════════════════════════════════════════════════════════
function SceneSFHook() {
  const { localTime } = useSprite();
  const t = localTime;
  const logoT = sfclamp(t / 0.6, 0, 1);
  const h1T = sfclamp((t - 0.5) / 0.5, 0, 1);
  const h2T = sfclamp((t - 0.95) / 0.5, 0, 1);
  const subT = sfclamp((t - 1.6) / 0.5, 0, 1);
  return (
    <div style={{ position: 'absolute', inset: 0, background: SF.darkBg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ opacity: logoT, transform: `translateY(${(1-logoT)*8}px)`, display: 'flex', alignItems: 'center', gap: 14, marginBottom: 38 }}>
        <SFLogo size={40} />
        <div style={{ fontFamily: SFF, fontSize: 22, fontWeight: 700, color: SF.darkText1, letterSpacing: '-0.015em' }}>InkTracker</div>
      </div>
      <div style={{ opacity: h1T, transform: `translateY(${(1-h1T)*10}px)`, fontFamily: SFF, fontSize: 96, fontWeight: 800, color: SF.darkText1, letterSpacing: '-0.045em', lineHeight: 1, textAlign: 'center' }}>Built for the floor.</div>
      <div style={{ opacity: h2T, transform: `translateY(${(1-h2T)*10}px)`, fontFamily: SFF, fontSize: 96, fontWeight: 800, color: '#FDBA74', letterSpacing: '-0.045em', lineHeight: 1.02, textAlign: 'center', marginTop: 10 }}>Real-time updates.</div>
      <div style={{ opacity: subT, transform: `translateY(${(1-subT)*8}px)`, fontFamily: SFF, fontSize: 20, color: SF.darkText2, marginTop: 36, textAlign: 'center' }}>Tablet-ready. Touch-friendly. Synced to the office in seconds.</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 2 — JOB QUEUE ON A TABLET (3–9s)
// ═══════════════════════════════════════════════════════════════════════════
function SceneSFQueue() {
  const { localTime, duration } = useSprite();
  const t = localTime;
  const frameT = sfclamp(t / 0.6, 0, 1);
  const headerT = sfclamp((t - 0.4) / 0.4, 0, 1);
  const filterT = sfclamp((t - 0.6) / 0.4, 0, 1);

  return (
    <TabletFrame entryProgress={frameT}>
      <ShopFloorHeader />
      <div style={{ opacity: headerT, padding: '20px 28px 0', display: 'flex', alignItems: 'baseline', gap: 18 }}>
        <div style={{ fontFamily: SFF, fontSize: 28, fontWeight: 800, color: SF.text1, letterSpacing: '-0.025em' }}>Your jobs</div>
        <div style={{ fontFamily: SFF, fontSize: 13, color: SF.text3, fontWeight: 500 }}>Tap a job to start working</div>
      </div>

      {/* Filter pills */}
      <div style={{ opacity: filterT, padding: '14px 28px 0', display: 'flex', gap: 8 }}>
        {[
          { label: 'Active', count: 4, active: true },
          { label: 'My Tasks', count: 2 },
          { label: 'Rush', count: 1 },
          { label: 'Completed', count: 28 },
        ].map((f) => (
          <div key={f.label} style={{
            padding: '8px 14px',
            background: f.active ? SF.indigo : '#fff',
            color: f.active ? '#fff' : SF.text2,
            border: `1px solid ${f.active ? SF.indigo : SF.border}`,
            borderRadius: 999,
            fontFamily: SFF, fontSize: 13.5, fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 7,
          }}>
            {f.label}
            <span style={{ fontFamily: SFM, fontSize: 11, fontWeight: 600, color: f.active ? 'rgba(255,255,255,0.7)' : SF.text3 }}>{f.count}</span>
          </div>
        ))}
      </div>

      <div style={{ padding: '18px 28px 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {DEMO_JOBS.map((job, i) => {
          const start = 0.9 + i * 0.15;
          const k = sfclamp((t - start) / 0.4, 0, 1);
          const e = sfeaseOut(k);
          return (
            <div key={job.id} style={{ opacity: e, transform: `translateY(${(1-e)*12}px)` }}>
              <JobCard job={job} />
            </div>
          );
        })}
      </div>

      <SFCaption text="Big, tappable job tickets. Color-coded by stage. Rush flagged in red." time={localTime} duration={duration} delay={1.6} />
    </TabletFrame>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 3 — JOB DETAIL + CHECKLIST (9–15s)
// ═══════════════════════════════════════════════════════════════════════════
// Employee opens ORD-2026-122 (Greenbriar Athletics — Printing stage),
// taps through 4 checklist items, then taps "Advance → Completed".
function SceneSFTicket() {
  const { localTime, duration } = useSprite();
  const t = localTime;

  // Checklist items get checked at staggered times
  const checks = [
    { task: 'Mount screens on press', at: 0.6 },
    { task: 'Run test prints',        at: 1.2 },
    { task: 'Get test approval',      at: 1.7 },
    { task: 'Run full batch',         at: 2.3 },
    { task: 'Flash/cure prints',      at: 2.9 },
    { task: 'Quality inspect',        at: 3.5 },
  ];

  const advanceAt = 4.6;
  const advancing = t >= advanceAt && t < advanceAt + 0.7;
  const advanced = t >= advanceAt + 0.7;
  const advancedT = sfclamp((t - advanceAt - 0.7) / 0.4, 0, 1);

  // Top-progress shows checks complete count animated
  const completeCount = checks.filter((c) => t >= c.at).length;
  const progressPct = (completeCount / PRINTING_TASKS.length) * 100;

  return (
    <TabletFrame entryProgress={1}>
      <ShopFloorHeader />

      <div style={{ padding: '20px 28px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button style={{
          width: 44, height: 44, borderRadius: 11, background: SF.surface, border: `1px solid ${SF.border}`,
          display: 'grid', placeItems: 'center', boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={SF.text2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontFamily: SFF, fontSize: 22, fontWeight: 800, color: SF.text1, letterSpacing: '-0.02em' }}>Greenbriar Athletics</div>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: '#E0E7FF', display: 'grid', placeItems: 'center', fontFamily: SFF, fontSize: 12, fontWeight: 800, color: SF.text1 }}>GA</div>
          </div>
          <div style={{ fontFamily: SFM, fontSize: 12.5, color: SF.text3, marginTop: 2 }}>ORD-2026-122 · 150 pcs · due May 27</div>
        </div>
        <StepBadge step={advanced ? 'Completed' : 'Printing'} large />
      </div>

      {/* Order details + progress bar */}
      <div style={{ padding: '16px 28px 0' }}>
        <div style={{
          background: SF.surface, border: `1px solid ${SF.border}`, borderRadius: 14,
          padding: '14px 18px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18,
        }}>
          <Stat label="Garment"   value="Bella+Canvas 3001 · Black · 150" />
          <Stat label="Imprint"   value="Screen print · 2-color · Full front" />
          <Stat label="Production lead" value="Aiden Vega" />
          <Stat label="Press"     value="MR-8 (auto)" />
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ padding: '14px 28px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontFamily: SFF, fontSize: 11.5, fontWeight: 800, color: SF.text3, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Printing checklist · {completeCount} / {PRINTING_TASKS.length}</div>
          <div style={{ fontFamily: SFM, fontSize: 13, fontWeight: 700, color: SF.indigo }}>{Math.round(progressPct)}%</div>
        </div>
        <div style={{ position: 'relative', height: 10, background: SF.slateSoft, borderRadius: 999, overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', inset: 0,
            width: `${progressPct}%`,
            background: SF.indigo, borderRadius: 999,
            transition: 'width 0.4s',
          }} />
        </div>
      </div>

      {/* Checklist (touch-friendly rows, two columns) */}
      <div style={{ padding: '16px 28px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {PRINTING_TASKS.map((task, i) => {
          const chk = checks.find((c) => c.task === task);
          const completed = chk ? t >= chk.at : false;
          const justChecked = chk && t >= chk.at && t < chk.at + 0.5;
          const pulse = justChecked ? sfclamp((t - chk.at) / 0.3, 0, 1) : 0;
          const pulseE = pulse * (1 - pulse) * 0.6;
          return (
            <div key={task} style={{
              padding: '14px 16px',
              background: completed ? SF.greenSoft : SF.surface,
              border: `1.5px solid ${completed ? SF.greenBorder : SF.border}`,
              borderRadius: 11,
              display: 'flex', alignItems: 'center', gap: 12,
              transform: `scale(${1 + pulseE * 0.04})`,
              transition: 'background 0.25s, border-color 0.25s',
            }}>
              <div style={{
                width: 26, height: 26, borderRadius: 6,
                background: completed ? SF.green : '#fff',
                border: `2px solid ${completed ? SF.green : SF.borderStrong}`,
                display: 'grid', placeItems: 'center',
                flexShrink: 0,
                transition: 'all 0.25s',
              }}>
                {completed && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11"/></svg>}
              </div>
              <div style={{
                fontFamily: SFF, fontSize: 14.5,
                color: completed ? SF.text2 : SF.text1,
                fontWeight: completed ? 500 : 700,
                textDecoration: completed ? 'line-through' : 'none',
                letterSpacing: '-0.005em',
                flex: 1, minWidth: 0,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{task}</div>
            </div>
          );
        })}
      </div>

      {/* Advance button row */}
      <div style={{ padding: '20px 28px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button style={{
          padding: '13px 20px',
          background: '#fff', color: SF.text2,
          border: `1px solid ${SF.border}`, borderRadius: 12,
          fontFamily: SFF, fontSize: 14, fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={SF.text2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back to Pre-Press
        </button>
        <button style={{
          marginLeft: 'auto',
          padding: '14px 26px',
          background: advanced ? SF.greenSoft : SF.indigo,
          color: advanced ? SF.green : '#fff',
          border: advanced ? `1px solid ${SF.greenBorder}` : 'none',
          borderRadius: 12,
          fontFamily: SFF, fontSize: 15, fontWeight: 800, letterSpacing: '-0.005em',
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: advanced ? 'none' : '0 8px 20px rgba(79,70,229,0.32)',
          transition: 'all 0.25s',
        }}>
          {advancing && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" style={{ transform: `rotate(${t * 720}deg)` }}><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
          )}
          {advanced ? (
            <>Marked Completed ✓</>
          ) : (
            <>
              {advancing ? 'Updating…' : 'Advance to Completed'}
              {!advancing && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>}
            </>
          )}
        </button>
      </div>

      <SFCaption text="Tap to check off. Tap to advance the stage. The office sees it live." time={localTime} duration={duration} delay={3.6} />
    </TabletFrame>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontFamily: SFF, fontSize: 10.5, fontWeight: 800, color: SF.text3, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: SFF, fontSize: 13, color: SF.text1, fontWeight: 700, letterSpacing: '-0.005em' }}>{value}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 4 — OFFICE DESKTOP SEES THE UPDATE (15–20s)
// ═══════════════════════════════════════════════════════════════════════════
// Cut to the shop's Production page on a desktop. The GA card just moved
// from "Printing" column to "Completed", highlighted, with a toast naming
// the employee who advanced it.
function SceneSFDesktop() {
  const { localTime, duration } = useSprite();
  const t = localTime;
  const pageT = sfclamp(t / 0.4, 0, 1);
  const toastT = sfclamp((t - 0.5) / 0.4, 0, 1);

  // Card slides into Completed column at 1.0s
  const moveAt = 1.0;
  const moved = t >= moveAt;
  const moveT = sfclamp((t - moveAt) / 0.5, 0, 1);
  const moveE = sfeaseOut(moveT);
  // Card highlight flash 1.0–2.4s then fades
  const flashRemain = sfclamp(1 - (t - moveAt) / 1.4, 0, 1);

  return (
    <div style={{ position: 'absolute', inset: 0, background: SF.darkBg, opacity: pageT }}>
      {/* Desktop browser chrome */}
      <div style={{
        position: 'absolute', top: 48, left: 96, right: 96, bottom: 48,
        background: SF.surface, borderRadius: 14, overflow: 'hidden',
        boxShadow: '0 32px 96px rgba(0,0,0,0.35)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Tab strip */}
        <div style={{ height: 38, background: '#E8EAEC', display: 'flex', alignItems: 'center', padding: '0 14px', borderBottom: `1px solid ${SF.border}`, gap: 8 }}>
          <div style={{ width: 11, height: 11, borderRadius: 999, background: '#FF5F57' }} />
          <div style={{ width: 11, height: 11, borderRadius: 999, background: '#FEBC2E' }} />
          <div style={{ width: 11, height: 11, borderRadius: 999, background: '#28C840' }} />
          <div style={{ marginLeft: 12, padding: '5px 14px', background: '#fff', borderRadius: 6, fontFamily: SFF, fontSize: 11.5, color: SF.text3, fontWeight: 600 }}>inktracker.app / production</div>
        </div>

        <div style={{ flex: 1, background: SF.appBg, display: 'flex', overflow: 'hidden' }}>
          {/* Sidebar (slim version of the shop chrome) */}
          <div style={{
            width: 200, background: SF.surface, borderRight: `1px solid ${SF.border}`,
            padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 6px 16px' }}>
              <SFLogo size={28} />
              <div style={{ fontFamily: SFF, fontSize: 13.5, fontWeight: 800, color: SF.text1, letterSpacing: '-0.01em' }}>Northwind Print</div>
            </div>
            {[
              { label: 'Dashboard' },
              { label: 'Quotes' },
              { label: 'Production', active: true },
              { label: 'Customers' },
              { label: 'Inventory' },
              { label: 'Invoices' },
              { label: 'Performance' },
              { label: 'Mockups' },
              { label: 'Wizard' },
              { label: 'Embed' },
              { label: 'Account' },
            ].map((it) => (
              <div key={it.label} style={{
                padding: '8px 12px', borderRadius: 7,
                background: it.active ? SF.indigo : 'transparent',
                color: it.active ? '#fff' : SF.text2,
                fontFamily: SFF, fontSize: 12.5, fontWeight: it.active ? 700 : 500,
              }}>{it.label}</div>
            ))}
          </div>

          {/* Production board */}
          <div style={{ flex: 1, padding: '24px 32px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 18 }}>
              <div style={{ fontFamily: SFF, fontSize: 30, fontWeight: 800, color: SF.text1, letterSpacing: '-0.025em' }}>Production</div>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontFamily: SFF, fontSize: 12, color: SF.text3 }}>
                <div style={{ width: 8, height: 8, borderRadius: 999, background: SF.green }} />
                Live · synced with Shop Floor
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, height: 'calc(100% - 60px)' }}>
              <KanbanCol title="Art Approval" cards={[
                { id: 'ORD-2026-118', client: 'Driftwood Theatre Co.', initials: 'DT', color: '#FCE7F3', qty: 60 },
              ]} accent={SF.purple} />
              <KanbanCol title="Order Goods" cards={[
                { id: 'ORD-2026-119', client: 'Cypress Ridge HS', initials: 'CR', color: '#DBEAFE', qty: 240, rush: true },
              ]} accent={SF.amber} />
              <KanbanCol title="Pre-Press" cards={[
                { id: 'ORD-2026-121', client: 'Foxtail Brewing', initials: 'FB', color: '#FFE4E6', qty: 80 },
              ]} accent={SF.blue} />
              <KanbanCol title="Printing" cards={[
                /* GA was here, but now moved out */
              ]} accent={SF.indigoSt} ghost={!moved ? { id: 'ORD-2026-122', client: 'Greenbriar Athletics', initials: 'GA', color: '#E0E7FF', qty: 150 } : null} />
              <KanbanCol title="Completed" cards={moved ? [
                {
                  id: 'ORD-2026-122', client: 'Greenbriar Athletics', initials: 'GA', color: '#E0E7FF', qty: 150,
                  enter: moveE, flash: flashRemain,
                },
                { id: 'ORD-2026-114', client: 'Aldenwood Bookstore', initials: 'AB', color: '#EEF2FF', qty: 36 },
                { id: 'ORD-2026-113', client: 'Bayside Coffee Roasters', initials: 'BC', color: '#FEF3C7', qty: 72 },
              ] : [
                { id: 'ORD-2026-114', client: 'Aldenwood Bookstore', initials: 'AB', color: '#EEF2FF', qty: 36 },
                { id: 'ORD-2026-113', client: 'Bayside Coffee Roasters', initials: 'BC', color: '#FEF3C7', qty: 72 },
              ]} accent={SF.slate} />
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      <div style={{
        position: 'absolute', top: 72, right: 120,
        transform: `translateX(${(1 - sfeaseOut(toastT)) * 40}px)`,
        opacity: toastT,
        background: SF.surface,
        border: `1px solid ${SF.greenBorder}`,
        borderRadius: 12,
        padding: '14px 18px',
        display: 'flex', alignItems: 'center', gap: 14,
        boxShadow: '0 18px 48px rgba(22,163,74,0.18)',
        minWidth: 380,
      }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: SF.greenSoft, display: 'grid', placeItems: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={SF.green} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11"/></svg>
        </div>
        <div>
          <div style={{ fontFamily: SFF, fontSize: 14, fontWeight: 800, color: SF.text1, letterSpacing: '-0.005em' }}>Greenbriar Athletics · Completed</div>
          <div style={{ fontFamily: SFF, fontSize: 12.5, color: SF.text3, marginTop: 2 }}>Updated from the floor by Aiden Vega · just now</div>
        </div>
      </div>

      <SFCaption text="What the team finishes on the floor, the office sees instantly." time={localTime} duration={duration} delay={2.0} />
    </div>
  );
}

function KanbanCol({ title, cards, accent, ghost }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px 10px', borderBottom: `2px solid ${accent}` }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: accent }} />
        <div style={{ fontFamily: SFF, fontSize: 11.5, fontWeight: 800, color: SF.text2, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{title}</div>
        <div style={{ marginLeft: 'auto', fontFamily: SFM, fontSize: 11, color: SF.text3, fontWeight: 600 }}>{cards.length}</div>
      </div>
      <div style={{ padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ghost && (
          <div style={{
            border: `1.5px dashed ${SF.borderStrong}`, borderRadius: 10,
            padding: '10px 12px',
            opacity: 0.45,
            background: 'rgba(15,23,42,0.02)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 22, height: 22, borderRadius: 6, background: ghost.color, display: 'grid', placeItems: 'center', fontFamily: SFF, fontSize: 9.5, fontWeight: 800, color: SF.text1 }}>{ghost.initials}</div>
              <div style={{ fontFamily: SFF, fontSize: 11.5, color: SF.text3, fontWeight: 600 }}>{ghost.client}</div>
            </div>
          </div>
        )}
        {cards.map((c) => (
          <div key={c.id} style={{
            background: c.flash > 0 ? SF.greenSoft : SF.surface,
            border: `${c.flash > 0.5 ? 2 : 1}px solid ${c.flash > 0.5 ? SF.green : SF.border}`,
            borderRadius: 10, padding: '10px 12px',
            boxShadow: c.flash > 0 ? '0 10px 24px rgba(22,163,74,0.18)' : '0 1px 2px rgba(15,23,42,0.04)',
            opacity: c.enter != null ? c.enter : 1,
            transform: c.enter != null ? `translateX(${(1 - c.enter) * -40}px)` : 'none',
            transition: 'background 0.4s, border-color 0.4s',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: 6, background: c.color, display: 'grid', placeItems: 'center', fontFamily: SFF, fontSize: 10, fontWeight: 800, color: SF.text1 }}>{c.initials}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: SFF, fontSize: 12, fontWeight: 800, color: SF.text1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.client}</div>
                <div style={{ fontFamily: SFM, fontSize: 10, color: SF.text3, marginTop: 1 }}>{c.id} · {c.qty} pcs</div>
              </div>
              {c.rush && (
                <div style={{ padding: '1px 5px', background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FECACA', borderRadius: 3, fontFamily: SFF, fontSize: 8.5, fontWeight: 800, letterSpacing: '0.06em' }}>RUSH</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 5 — LOCKUP (20–22s)
// ═══════════════════════════════════════════════════════════════════════════
function SceneSFLockup() {
  const { localTime } = useSprite();
  const t = localTime;
  const logoT = sfclamp(t / 0.6, 0, 1);
  const textT = sfclamp((t - 0.4) / 0.6, 0, 1);
  return (
    <div style={{ position: 'absolute', inset: 0, background: SF.darkBg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ opacity: logoT, transform: `translateY(${(1-logoT)*8}px)`, display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <SFLogo size={56} />
        <div style={{ fontFamily: SFF, fontSize: 36, fontWeight: 800, color: SF.darkText1, letterSpacing: '-0.025em' }}>InkTracker</div>
      </div>
      <div style={{ opacity: textT, transform: `translateY(${(1-textT)*8}px)`, fontFamily: SFF, fontSize: 26, color: SF.darkText2, marginTop: 8, textAlign: 'center', letterSpacing: '-0.01em' }}>From the press to the office.</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
function ShopFloorDemo() {
  return (
    <>
      <Sprite start={0}  end={3}>   <SceneSFHook />    </Sprite>
      <Sprite start={3}  end={9}>   <SceneSFQueue />   </Sprite>
      <Sprite start={9}  end={15}>  <SceneSFTicket />  </Sprite>
      <Sprite start={15} end={20}>  <SceneSFDesktop /> </Sprite>
      <Sprite start={20} end={22}>  <SceneSFLockup /> </Sprite>
    </>
  );
}
