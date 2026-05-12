// customer-quote-scenes.jsx — InkTracker customer-facing Quote Wizard demo (25s)
// Recreates the public Request a Quote widget shops embed on their site.
// Demo client info only.

const CQ = {
  // Dark hook / lockup
  darkBg: '#0B0B0E',
  darkText1: '#F4F4F5',
  darkText2: 'rgba(244,244,245,0.62)',
  darkText3: 'rgba(244,244,245,0.40)',

  // Light widget surface
  pageBg: '#F5F5F8',
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
  greenDeep: '#15803D',
  greenSoft: '#DCFCE7',
  amber: '#D97706',
  amberSoft: '#FEF3C7',
  amberBorder: '#FCD34D',
  navy: '#0F172A',
};
const FF = '"Inter", system-ui, -apple-system, sans-serif';
const FM = '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace';

// ───────────────────────────────── helpers ─────────────────────────────────
function cclamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function ceaseOut(t) { return 1 - Math.pow(1 - t, 3); }
function ceaseInOut(t) { return t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2; }

function CQLogo({ size = 36 }) {
  return (
    <img src="assets/inktracker-logo.png" alt=""
      style={{ width: size, height: size, display: 'block', objectFit: 'contain', flexShrink: 0 }} />
  );
}

// ───────────────────────────────── widget chrome ───────────────────────────
// Subtle browser-tab look so it's clear this is embedded on the shop's site.
function ShopChrome({ children, opacity = 1 }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: CQ.pageBg, opacity,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Shop's site header (suggested) */}
      <div style={{
        height: 76, borderBottom: `1px solid ${CQ.border}`,
        background: '#fff', flexShrink: 0,
        display: 'flex', alignItems: 'center',
        padding: '0 56px', gap: 40,
        fontFamily: FF,
      }}>
        <div style={{
          fontSize: 22, fontWeight: 800, color: CQ.text1,
          letterSpacing: '-0.02em',
        }}>northwind <span style={{ color: CQ.accent }}>·</span> print shop</div>
        <div style={{ display: 'flex', gap: 28, marginLeft: 24 }}>
          {['Shop', 'About', 'Order Now'].map((t, i) => (
            <div key={t} style={{
              fontSize: 13, fontWeight: 600,
              color: i === 2 ? CQ.text1 : CQ.text3,
              letterSpacing: '0.04em', textTransform: 'uppercase',
            }}>{t}</div>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, alignItems: 'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={CQ.text3} strokeWidth="1.8"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={CQ.text3} strokeWidth="1.8"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/></svg>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={CQ.text3} strokeWidth="1.8"><path d="M5 6h14l-1.5 11a2 2 0 01-2 1.7H8.5a2 2 0 01-2-1.7zM9 6V4.5A2.5 2.5 0 0114 4.5V6"/></svg>
        </div>
      </div>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

// ─── Wizard header (title + 3 cards + progress) ────────────────────────────
function WizardHeader({ step = 0, completeSteps = [] }) {
  // step: 0 Configure, 1 Details, 2 Review
  const stepLabels = ['Configure', 'Details', 'Review'];
  return (
    <div style={{ padding: '40px 0 28px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ fontFamily: FF, fontSize: 38, fontWeight: 800, color: CQ.text1, letterSpacing: '-0.03em' }}>Request a Quote</div>
      <div style={{ fontFamily: FF, fontSize: 15, color: CQ.text3, marginTop: 6 }}>No commitment required</div>

      {/* 3 numbered cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, width: 1100, marginTop: 36 }}>
        {[
          { n: 1, title: 'Build your order', sub: 'Select garments, styles & quantities' },
          { n: 2, title: 'Get a quote',      sub: "We'll send a detailed quote by email" },
          { n: 3, title: 'Approve & we print', sub: "Approve when you're ready" },
        ].map((c) => (
          <div key={c.n} style={{
            background: CQ.surface, border: `1px solid ${CQ.border}`, borderRadius: 12,
            padding: '22px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center',
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 18, background: CQ.accent, color: '#fff',
              display: 'grid', placeItems: 'center', fontFamily: FF, fontWeight: 800, fontSize: 16,
            }}>{c.n}</div>
            <div style={{ fontFamily: FF, fontSize: 17, fontWeight: 700, color: CQ.text1, marginTop: 12, letterSpacing: '-0.01em' }}>{c.title}</div>
            <div style={{ fontFamily: FF, fontSize: 13, color: CQ.text3, marginTop: 4 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Step progress */}
      <div style={{ width: 1100, marginTop: 32, display: 'flex', alignItems: 'center', gap: 8 }}>
        {stepLabels.map((lbl, i) => {
          const isActive = i === step;
          const isDone = completeSteps.includes(i);
          const color = isDone ? CQ.green : (isActive ? CQ.accent : CQ.text4);
          return (
            <React.Fragment key={lbl}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 12, height: 12, borderRadius: 6,
                  background: isDone || isActive ? color : 'transparent',
                  border: `2px solid ${color}`,
                }} />
                <div style={{
                  fontFamily: FF, fontSize: 14, fontWeight: 700,
                  color: isDone || isActive ? color : CQ.text4,
                }}>{lbl}</div>
              </div>
              {i < 2 && (
                <div style={{
                  flex: 1, height: 2,
                  background: completeSteps.includes(i) ? CQ.green : CQ.border,
                  margin: '0 6px',
                }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tshirt silhouette swatch ──────────────────────────────────────────────
function TShirtSwatch({ fill, size = 72, accent }) {
  return (
    <svg width={size} height={size * 0.95} viewBox="0 0 100 96" fill="none" style={{ display: 'block' }}>
      <path d="M22 16 L36 8 L40 10 Q50 18 60 10 L64 8 L78 16 L88 26 L80 36 L74 32 L74 86 Q74 90 70 90 L30 90 Q26 90 26 86 L26 32 L20 36 L12 26 Z"
        fill={fill} stroke={accent || 'rgba(0,0,0,0.12)'} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M40 10 Q50 22 60 10" stroke="rgba(0,0,0,0.18)" strokeWidth="1" fill="none" />
    </svg>
  );
}

// ─── Pricing bar (dark header that appears after style chosen) ─────────────
function PricingBar({ label, perPc, total, accentGreen = false, opacity = 1, transform = '' }) {
  return (
    <div style={{
      opacity, transform,
      background: CQ.navy, color: '#fff', borderRadius: 12,
      padding: '20px 28px', display: 'flex', alignItems: 'center',
      boxShadow: '0 8px 24px rgba(15,23,42,0.18)',
    }}>
      <div style={{ fontFamily: FF, fontSize: 17, fontWeight: 500, letterSpacing: '-0.01em', color: 'rgba(255,255,255,0.85)' }}>{label}</div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <div style={{ fontFamily: FM, fontSize: 14, color: 'rgba(255,255,255,0.55)' }}>${perPc}/pc</div>
        <div style={{ fontFamily: FF, fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', color: accentGreen ? '#86EFAC' : '#fff' }}>${total}</div>
      </div>
    </div>
  );
}

// ─── Caption (bottom narration) ────────────────────────────────────────────
function CQCaption({ text, time, duration, delay = 0.3, fade = 0.4 }) {
  const local = time - delay;
  const tIn = cclamp(local / fade, 0, 1);
  const tOut = cclamp((duration - delay - local) / fade, 0, 1);
  const op = ceaseOut(Math.min(tIn, tOut));
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 36,
      display: 'flex', justifyContent: 'center', pointerEvents: 'none',
    }}>
      <div style={{
        opacity: op,
        background: 'rgba(11,11,14,0.92)', color: '#F4F4F5',
        fontFamily: FF, fontSize: 17, fontWeight: 500, letterSpacing: '-0.005em',
        padding: '12px 22px', borderRadius: 999,
        boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
        whiteSpace: 'nowrap',
      }}>{text}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 1 — HOOK (0–3s)
// ═══════════════════════════════════════════════════════════════════════════
function SceneCQHook() {
  const { localTime, duration } = useSprite();
  const t = localTime;

  const logoT = cclamp(t / 0.6, 0, 1);
  const h1T  = cclamp((t - 0.5) / 0.5, 0, 1);
  const h2T  = cclamp((t - 0.9) / 0.5, 0, 1);
  const subT = cclamp((t - 1.5) / 0.5, 0, 1);

  const dotsT = cclamp((t - 2.0) / 0.7, 0, 1);

  return (
    <div style={{
      position: 'absolute', inset: 0, background: CQ.darkBg,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        opacity: logoT, transform: `translateY(${(1-logoT)*8}px)`,
        display: 'flex', alignItems: 'center', gap: 14, marginBottom: 38,
      }}>
        <CQLogo size={40} />
        <div style={{ fontFamily: FF, fontSize: 22, fontWeight: 700, color: CQ.darkText1, letterSpacing: '-0.015em' }}>InkTracker</div>
      </div>

      <div style={{
        opacity: h1T, transform: `translateY(${(1-h1T)*10}px)`,
        fontFamily: FF, fontSize: 88, fontWeight: 800, color: CQ.darkText1,
        letterSpacing: '-0.045em', lineHeight: 1, textAlign: 'center',
      }}>Customer quotes,</div>
      <div style={{
        opacity: h2T, transform: `translateY(${(1-h2T)*10}px)`,
        fontFamily: FF, fontSize: 88, fontWeight: 800, color: '#A5B4FC',
        letterSpacing: '-0.045em', lineHeight: 1.02, textAlign: 'center', marginTop: 8,
      }}>on your site.</div>

      <div style={{
        opacity: subT, transform: `translateY(${(1-subT)*8}px)`,
        fontFamily: FF, fontSize: 20, color: CQ.darkText2, marginTop: 36,
        letterSpacing: '-0.005em', textAlign: 'center',
      }}>Embedded widget. Three steps. Quote in their inbox.</div>

      {/* connector dots */}
      <div style={{
        opacity: dotsT, marginTop: 64,
        display: 'flex', alignItems: 'center', gap: 18,
        fontFamily: FF, fontSize: 13, fontWeight: 700, color: CQ.darkText3,
        letterSpacing: '0.18em', textTransform: 'uppercase',
      }}>
        <span>Configure</span>
        <span style={{ color: 'rgba(244,244,245,0.25)' }}>→</span>
        <span>Details</span>
        <span style={{ color: 'rgba(244,244,245,0.25)' }}>→</span>
        <span>Review</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 2 — STYLE SELECT (3–7.5s)
// Empty configure → garment type dropdown → search box → cards populate → hover preview → select 5001
// ═══════════════════════════════════════════════════════════════════════════
function SceneCQStyle() {
  const { localTime, duration } = useSprite();
  const t = localTime;

  // Page fade in
  const pageT = cclamp(t / 0.5, 0, 1);
  // Garment type dropdown changes to "T-Shirts" around t=0.9
  const ddTyping = t > 0.9;
  // Garment cards reveal staggered after t=1.3
  const cardsStart = 1.3;
  // Hover preview appears around t=2.6 on the 5001 card
  const previewT = cclamp((t - 2.6) / 0.45, 0, 1);
  // Preview fades back out as we "click select" t=3.4
  const previewOut = cclamp((t - 3.4) / 0.3, 0, 1);
  const previewVis = previewT * (1 - previewOut);
  // 5001 card highlighted after t=3.5
  const selectedT = cclamp((t - 3.5) / 0.4, 0, 1);
  // Continue button activates after t=3.9
  const ctaT = cclamp((t - 3.9) / 0.4, 0, 1);

  const garments = [
    { num: '5001',  name: 'AS Colour 5001',  meta: '180 GSM · Staple',  fill: '#1f1f23' },
    { num: '5026',  name: 'AS Colour 5026',  meta: '220 GSM · Classic', fill: '#1f1f23' },
    { num: '5080',  name: 'AS Colour 5080',  meta: '280 GSM · Heavy',   fill: '#1f1f23' },
    { num: '5001G', name: 'AS Colour 5001G', meta: '180 GSM · Organic', fill: '#1f1f23' },
  ];

  return (
    <ShopChrome opacity={pageT}>
      <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <WizardHeader step={0} completeSteps={[]} />

        {/* Style picker card */}
        <div style={{ width: 1100, margin: '0 auto', position: 'relative' }}>
          <div style={{
            border: `2px solid ${CQ.accent}`,
            borderRadius: 14, padding: '22px 28px',
            background: 'rgba(238,242,255,0.4)',
          }}>
            <div style={{ fontFamily: FF, fontSize: 15, color: CQ.text3, fontWeight: 500, marginBottom: 18 }}>Select a style below</div>

            <div style={{ fontFamily: FF, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: CQ.text3, marginBottom: 12 }}>STYLE</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 18, alignItems: 'end' }}>
              <div>
                <div style={{ fontFamily: FF, fontSize: 13, color: CQ.text3, marginBottom: 6 }}>Garment type</div>
                <div style={{
                  height: 46, border: `1px solid ${CQ.borderStrong}`, borderRadius: 8, background: '#fff',
                  display: 'flex', alignItems: 'center', padding: '0 14px',
                  fontFamily: FF, fontSize: 15, color: ddTyping ? CQ.text1 : CQ.text3, fontWeight: ddTyping ? 600 : 400,
                  justifyContent: 'space-between',
                }}>
                  <span>{ddTyping ? 'T-Shirts' : 'Select…'}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={CQ.text3} strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
                </div>
              </div>
              <div>
                <div style={{ fontFamily: FF, fontSize: 13, color: CQ.text3, marginBottom: 6 }}>Or search by style #</div>
                <div style={{
                  height: 46, border: `1px solid ${CQ.borderStrong}`, borderRadius: 8, background: '#fff',
                  display: 'flex', alignItems: 'center', padding: '0 14px',
                  fontFamily: FF, fontSize: 15, color: CQ.text3,
                }}>e.g. 5001</div>
              </div>
              <button style={{
                height: 46, padding: '0 24px', borderRadius: 8, border: 'none',
                background: '#EEF2FF', color: CQ.accent, fontFamily: FF, fontSize: 15, fontWeight: 700,
              }}>Go</button>
            </div>

            {/* Garment cards grid */}
            {ddTyping && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 22 }}>
                {garments.map((g, i) => {
                  const cardDelay = cardsStart + i * 0.12;
                  const cT = cclamp((t - cardDelay) / 0.35, 0, 1);
                  const isSelected = g.num === '5001' && selectedT > 0;
                  return (
                    <div key={g.num} style={{
                      opacity: cT, transform: `translateY(${(1-cT)*8}px)`,
                      display: 'flex', alignItems: 'center', gap: 14,
                      padding: '14px 18px',
                      border: isSelected
                        ? `2px solid ${CQ.accent}`
                        : `1px solid ${CQ.border}`,
                      background: isSelected ? CQ.accentSoft : '#fff',
                      borderRadius: 10,
                      transition: 'all 0.2s',
                    }}>
                      <div style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', background: '#F1F5F9', borderRadius: 8 }}>
                        <TShirtSwatch fill={g.fill} size={32} />
                      </div>
                      <div>
                        <div style={{ fontFamily: FF, fontSize: 16, fontWeight: 700, color: CQ.text1, letterSpacing: '-0.01em' }}>{g.name}</div>
                        <div style={{ fontFamily: FF, fontSize: 13, color: CQ.text3, marginTop: 2 }}>{g.meta}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Hover preview popover on 5001 */}
          {previewVis > 0 && (
            <div style={{
              position: 'absolute',
              left: 130, top: 320,
              opacity: previewVis,
              transform: `translateY(${(1-previewVis)*-6}px) scale(${0.96 + 0.04*previewVis})`,
              background: '#fff', border: `1px solid ${CQ.border}`, borderRadius: 14,
              padding: 18, width: 260,
              boxShadow: '0 24px 60px rgba(15,23,42,0.22), 0 4px 12px rgba(15,23,42,0.08)',
              zIndex: 5,
            }}>
              <div style={{ background: '#F8FAFC', borderRadius: 10, padding: '14px 8px', display: 'grid', placeItems: 'center' }}>
                <TShirtSwatch fill="#1f1f23" size={140} />
              </div>
              <div style={{ marginTop: 14, fontFamily: FF, fontSize: 16, fontWeight: 700, color: CQ.text1, letterSpacing: '-0.01em' }}>AS Colour 5001</div>
              <div style={{ fontFamily: FF, fontSize: 13, color: CQ.text3, marginTop: 2 }}>Staple Tee</div>
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${CQ.border}`, fontFamily: FF, fontSize: 13, color: CQ.text2, lineHeight: 1.5 }}>
                <div><span style={{ color: CQ.text3 }}>Style:</span> <b>5001</b></div>
                <div><span style={{ color: CQ.text3 }}>Weight:</span> <b>180 GSM</b></div>
              </div>
              <div style={{ marginTop: 10, fontFamily: FF, fontSize: 12, color: CQ.text3, lineHeight: 1.45 }}>
                Mid-weight, 100% combed cotton, 70+ colours
              </div>
            </div>
          )}

          {/* Warning / Continue row */}
          <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 16 }}>
            {selectedT < 1 ? (
              <div style={{
                flex: 1, padding: '14px 18px',
                background: CQ.amberSoft, border: `1px solid ${CQ.amberBorder}`, borderRadius: 10,
                fontFamily: FF, fontSize: 14, fontWeight: 500, color: CQ.amber,
              }}>Select a garment style</div>
            ) : (
              <div style={{
                flex: 1, padding: '14px 18px',
                background: CQ.greenSoft, border: `1px solid #86EFAC`, borderRadius: 10,
                fontFamily: FF, fontSize: 14, fontWeight: 600, color: CQ.greenDeep,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={CQ.greenDeep} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4 10-12"/></svg>
                AS Colour 5001 selected
              </div>
            )}
            <button style={{
              height: 46, padding: '0 22px', borderRadius: 8,
              border: `2px dashed ${CQ.accentBorder}`,
              background: 'transparent', color: CQ.accent,
              fontFamily: FF, fontSize: 14, fontWeight: 700,
            }}>+ Add Another Garment</button>
            <button style={{
              height: 46, padding: '0 26px', borderRadius: 8, border: 'none',
              background: ctaT > 0.5 ? CQ.accent : '#E2E8F0',
              color: ctaT > 0.5 ? '#fff' : CQ.text3,
              fontFamily: FF, fontSize: 15, fontWeight: 700,
              transition: 'all 0.2s',
              boxShadow: ctaT > 0.5 ? '0 6px 16px rgba(79,70,229,0.28)' : 'none',
            }}>Continue →</button>
          </div>
        </div>

        <CQCaption text="Pick a garment — built into the shop's website." time={localTime} duration={duration} delay={0.5} />
      </div>
    </ShopChrome>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 3 — COLOR + PRINT + SIZES (7.5–14s) — 6.5s scene
// Pricing bar enters, color grid reveals, PLUM selected, print details settle, sizes count up
// ═══════════════════════════════════════════════════════════════════════════
function SceneCQConfig() {
  const { localTime, duration } = useSprite();
  const t = localTime;

  // Pricing bar: starts gray "(50 est.)", swaps to PLUM after color picked
  const barT = cclamp(t / 0.4, 0, 1);
  // Color grid reveals
  const colorsStart = 0.6;
  // PLUM gets clicked at t = 2.6
  const plumPickT = cclamp((t - 2.6) / 0.3, 0, 1);
  // Print row visible after t=3.2
  const printT = cclamp((t - 3.2) / 0.45, 0, 1);
  // Sizes section after t=4.4
  const sizesT = cclamp((t - 4.4) / 0.45, 0, 1);
  // Sizes count-up from t=4.7
  const countT = cclamp((t - 4.7) / 0.9, 0, 1);

  const colors = [
    { name: 'ARCTIC BLUE', fill: '#3B82F6' },
    { name: 'ARMY',        fill: '#4D5238' },
    { name: 'ATLANTIC',    fill: '#0F766E' },
    { name: 'AUTUMN',      fill: '#D44C2A' },
    { name: 'BUBBLEGUM',   fill: '#F4A8C0' },
    { name: 'BERRY',       fill: '#8B2D4F' },
    { name: 'BLACK',       fill: '#111111' },
    { name: 'BONE',        fill: '#E9DFC9' },
    { name: 'BRIGHT ROYAL',fill: '#1E40AF' },
    { name: 'BURGUNDY',    fill: '#6B1B2E' },
    { name: 'PLUM',        fill: '#5B2A56' },
    { name: 'BUTTER',      fill: '#F4D58D' },
  ];

  // Pricing bar values
  const pickedColor = plumPickT > 0.5;
  const barLabel = pickedColor ? 'AS Colour 5001 · PLUM (80)' : 'AS Colour 5001 (50 est.)';
  const totalNum = pickedColor
    ? Math.round(1108.80 * Math.min(1, countT))
    : 693;
  const totalFmt = pickedColor ? totalNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '693.00';

  return (
    <ShopChrome opacity={1}>
      <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Mini header (Configure breadcrumb only — slim) */}
        <div style={{ padding: '22px 0 18px', display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 1100, display: 'flex', alignItems: 'center', gap: 8 }}>
            {['Configure', 'Details', 'Review'].map((lbl, i) => (
              <React.Fragment key={lbl}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 12, height: 12, borderRadius: 6,
                    background: i === 0 ? CQ.accent : 'transparent',
                    border: `2px solid ${i === 0 ? CQ.accent : CQ.text4}`,
                  }} />
                  <div style={{ fontFamily: FF, fontSize: 14, fontWeight: 700, color: i === 0 ? CQ.accent : CQ.text4 }}>{lbl}</div>
                </div>
                {i < 2 && <div style={{ flex: 1, height: 2, background: CQ.border, margin: '0 6px' }} />}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Pricing bar */}
        <div style={{ width: 1100, margin: '0 auto' }}>
          <PricingBar
            label={barLabel}
            perPc="13.86"
            total={totalFmt}
            accentGreen={false}
            opacity={barT}
            transform={`translateY(${(1-barT)*-10}px)`}
          />
        </div>

        {/* Content card */}
        <div style={{ width: 1100, margin: '20px auto 0', flex: 1, display: 'flex', flexDirection: 'column', gap: 18, paddingBottom: 24, overflow: 'hidden' }}>
          {/* Style header strip */}
          <div style={{
            background: CQ.surface, border: `2px solid ${CQ.accent}`, borderRadius: 12,
            padding: '14px 22px',
            display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: '#F1F5F9', display: 'grid', placeItems: 'center' }}>
              <TShirtSwatch fill="#0f766e" size={26} />
            </div>
            <div style={{ fontFamily: FF, fontSize: 16, fontWeight: 700, color: CQ.text1, letterSpacing: '-0.01em' }}>AS Colour 5001</div>
            <div style={{ marginLeft: 'auto', fontFamily: FF, fontSize: 13, color: CQ.accent, fontWeight: 700 }}>Change</div>
          </div>

          {/* COLOR section */}
          <div style={{ background: CQ.surface, border: `1px solid ${CQ.border}`, borderRadius: 12, padding: '20px 24px' }}>
            <div style={{ fontFamily: FF, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: CQ.text3, marginBottom: 14 }}>COLOR</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
              {colors.map((c, i) => {
                const cd = colorsStart + i * 0.06;
                const tt = cclamp((t - cd) / 0.3, 0, 1);
                const isPlum = c.name === 'PLUM';
                const sel = isPlum && plumPickT > 0;
                return (
                  <div key={c.name} style={{
                    opacity: tt, transform: `translateY(${(1-tt)*6}px) scale(${sel ? 1 + 0.02*plumPickT : 1})`,
                    border: sel ? `2px solid ${CQ.accent}` : `1px solid ${CQ.border}`,
                    background: sel ? CQ.accentSoft : '#fff',
                    borderRadius: 10, padding: '14px 8px 10px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    transition: 'all 0.15s',
                  }}>
                    <TShirtSwatch fill={c.fill} size={54} />
                    <div style={{ fontFamily: FF, fontSize: 10, fontWeight: 700, color: CQ.text2, letterSpacing: '0.05em', textAlign: 'center' }}>{c.name}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* PRINT row */}
          <div style={{
            opacity: printT, transform: `translateY(${(1-printT)*10}px)`,
            background: CQ.surface, border: `1px solid ${CQ.border}`, borderRadius: 12,
            padding: '18px 22px',
          }}>
            <div style={{ fontFamily: FF, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: CQ.text3, marginBottom: 12 }}>PRINT</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ fontFamily: FF, fontSize: 12, color: CQ.text3 }}>Placement</div>
                <div style={{ border: `1px solid ${CQ.borderStrong}`, borderRadius: 6, padding: '8px 12px', fontFamily: FF, fontSize: 13, fontWeight: 600, color: CQ.text1, background: '#fff' }}>Front</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ fontFamily: FF, fontSize: 12, color: CQ.text3 }}>Technique</div>
                <div style={{ border: `1px solid ${CQ.borderStrong}`, borderRadius: 6, padding: '8px 12px', fontFamily: FF, fontSize: 13, fontWeight: 600, color: CQ.text1, background: '#fff' }}>Screen Print</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontFamily: FF, fontSize: 12, color: CQ.text3, marginRight: 4 }}>Colors</div>
                {[1,2,3,4,5,6,7,8].map(n => (
                  <div key={n} style={{
                    width: 30, height: 30, borderRadius: 6,
                    background: n === 1 ? CQ.accent : '#fff',
                    color: n === 1 ? '#fff' : CQ.text2,
                    border: n === 1 ? 'none' : `1px solid ${CQ.border}`,
                    display: 'grid', placeItems: 'center',
                    fontFamily: FF, fontSize: 13, fontWeight: 700,
                  }}>{n}</div>
                ))}
              </div>
            </div>
          </div>

          {/* SIZES row */}
          <div style={{
            opacity: sizesT, transform: `translateY(${(1-sizesT)*10}px)`,
            background: CQ.surface, border: `1px solid ${CQ.border}`, borderRadius: 12,
            padding: '18px 22px',
          }}>
            <div style={{ fontFamily: FF, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: CQ.text3, marginBottom: 14 }}>SIZES</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 10, alignItems: 'end' }}>
              {[
                { label: 'OS', qty: 0, avail: '—', warn: true },
                { label: 'XS', qty: 0, avail: '218', warn: false },
                { label: 'S',  qty: 20, avail: '480' },
                { label: 'M',  qty: 20, avail: '1144' },
                { label: 'L',  qty: 20, avail: '1227' },
                { label: 'XL', qty: 20, avail: '973' },
                { label: '2XL',qty: 0,  avail: '606', warn: true },
                { label: '3XL',qty: 0,  avail: '104', warn: true },
                { label: '4XL',qty: 0,  avail: '—',   warn: true },
                { label: '5XL',qty: 0,  avail: '—',   warn: true },
              ].map((s) => {
                const isFilled = s.qty > 0;
                const shown = isFilled ? Math.round(s.qty * Math.min(1, countT * 1.2)) : 0;
                return (
                  <div key={s.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <div style={{ fontFamily: FF, fontSize: 12, fontWeight: 700, color: s.warn ? CQ.amber : CQ.text2, letterSpacing: '0.06em' }}>{s.label}</div>
                    <div style={{
                      width: '100%', height: 42, border: `1px solid ${isFilled ? CQ.accentBorder : (s.warn ? CQ.amberBorder : CQ.borderStrong)}`,
                      background: isFilled ? CQ.accentSoft : (s.warn ? '#FFFBEB' : '#fff'),
                      borderRadius: 8, display: 'grid', placeItems: 'center',
                      fontFamily: FM, fontSize: 18, fontWeight: 700, color: isFilled ? CQ.accent : (s.warn ? CQ.amber : CQ.text3),
                    }}>{shown}</div>
                    <div style={{ fontFamily: FF, fontSize: 11, color: s.warn ? CQ.amber : CQ.green, fontWeight: 500 }}>
                      {s.avail === '—' ? '—' : `${s.avail} avail`}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 16, fontFamily: FF, fontSize: 14, color: CQ.text2 }}>
              Total: <b style={{ color: CQ.text1 }}>{Math.round(80 * Math.min(1, countT * 1.2))} pcs</b>
            </div>
          </div>
        </div>

        <CQCaption text="Pick a color, set print details and sizes — pricing updates live." time={localTime} duration={duration} delay={0.4} />
      </div>
    </ShopChrome>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 4 — DETAILS (14–17.5s) — 3.5s
// Form fields type in
// ═══════════════════════════════════════════════════════════════════════════
function SceneCQDetails() {
  const { localTime, duration } = useSprite();
  const t = localTime;

  const headT = cclamp(t / 0.4, 0, 1);
  const formT = cclamp((t - 0.4) / 0.4, 0, 1);

  // Typing schedule
  const typedSlice = (text, startT, durT) => {
    const k = cclamp((t - startT) / durT, 0, 1);
    return text.slice(0, Math.floor(text.length * k));
  };
  const fullName  = typedSlice('Maya Reyes',          0.8, 0.55);
  const company   = typedSlice('Northwind Collective',1.2, 0.6);
  const email     = typedSlice('maya@northwindco.example', 1.7, 0.7);
  const phone     = typedSlice('555-0142',            2.3, 0.45);

  const reviewT = cclamp((t - 2.9) / 0.4, 0, 1);

  // Caret blink
  const caretOn = Math.floor(t * 2) % 2 === 0;

  return (
    <ShopChrome opacity={1}>
      <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Step breadcrumb (Configure done, Details active) */}
        <div style={{ padding: '22px 0 18px', display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 1100, display: 'flex', alignItems: 'center', gap: 8 }}>
            {['Configure', 'Details', 'Review'].map((lbl, i) => {
              const done = i === 0;
              const active = i === 1;
              const color = done ? CQ.green : (active ? CQ.accent : CQ.text4);
              return (
                <React.Fragment key={lbl}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 6, background: done || active ? color : 'transparent', border: `2px solid ${color}` }} />
                    <div style={{ fontFamily: FF, fontSize: 14, fontWeight: 700, color }}>{lbl}</div>
                  </div>
                  {i < 2 && <div style={{ flex: 1, height: 2, background: i === 0 ? CQ.green : CQ.border, margin: '0 6px' }} />}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Pricing bar (persists across steps) */}
        <div style={{ width: 1100, margin: '0 auto', opacity: headT }}>
          <PricingBar label="AS Colour 5001 · PLUM (80)" perPc="13.86" total="1,108.80" />
        </div>

        {/* Form */}
        <div style={{ width: 1100, margin: '24px auto 0', opacity: formT, transform: `translateY(${(1-formT)*10}px)` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
            <div style={{ fontFamily: FF, fontSize: 14, color: CQ.text3, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={CQ.text3} strokeWidth="2"><path d="M15 6l-6 6 6 6"/></svg> Back
            </div>
            <div style={{ fontFamily: FF, fontSize: 22, fontWeight: 800, color: CQ.text1, letterSpacing: '-0.02em' }}>Your details</div>
          </div>

          <div style={{ background: CQ.surface, border: `1px solid ${CQ.border}`, borderRadius: 14, padding: '28px 32px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22, columnGap: 28, rowGap: 22 }}>
              <FormField label="FULL NAME *" value={fullName} caretOn={caretOn} active={t > 0.8 && t < 1.4} />
              <FormField label="COMPANY / ORGANIZATION" value={company} caretOn={caretOn} active={t > 1.2 && t < 1.85} />
              <FormField label="EMAIL *" value={email} caretOn={caretOn} active={t > 1.7 && t < 2.45} />
              <FormField label="PHONE" value={phone} caretOn={caretOn} active={t > 2.3 && t < 2.8} />

              <div>
                <div style={{ fontFamily: FF, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: CQ.text3, marginBottom: 8 }}>IN-HANDS DATE</div>
                <div style={{
                  height: 50, border: `1px solid ${CQ.borderStrong}`, borderRadius: 8, background: '#fff',
                  padding: '0 14px', display: 'flex', alignItems: 'center',
                  fontFamily: FF, fontSize: 15, color: CQ.text3,
                }}>mm/dd/yyyy</div>
              </div>
              <div>
                <div style={{ fontFamily: FF, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: CQ.text3, marginBottom: 8 }}>ART / SPECIAL NOTES</div>
                <div style={{
                  height: 86, border: `1px solid ${CQ.borderStrong}`, borderRadius: 8, background: '#fff',
                  padding: '12px 14px',
                  fontFamily: FF, fontSize: 14, color: CQ.text3,
                }}>File format, special instructions, Pantone refs…</div>
              </div>
            </div>

            <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, border: `1.5px solid ${CQ.borderStrong}`, background: '#fff' }} />
              <div style={{ fontFamily: FF, fontSize: 14, fontWeight: 600, color: CQ.text1 }}>Tax Exempt</div>
            </div>
          </div>

          <div style={{ marginTop: 22, display: 'flex', justifyContent: 'flex-end' }}>
            <button style={{
              padding: '14px 26px', borderRadius: 8, border: 'none',
              background: reviewT > 0.5 ? CQ.accent : '#E2E8F0',
              color: reviewT > 0.5 ? '#fff' : CQ.text3,
              fontFamily: FF, fontSize: 15, fontWeight: 700,
              boxShadow: reviewT > 0.5 ? '0 6px 18px rgba(79,70,229,0.32)' : 'none',
              transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>Review Order →</button>
          </div>
        </div>

        <CQCaption text="Your customer fills out their details — no commitment required." time={localTime} duration={duration} delay={0.4} />
      </div>
    </ShopChrome>
  );
}

function FormField({ label, value, caretOn, active }) {
  return (
    <div>
      <div style={{ fontFamily: FF, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: CQ.text3, marginBottom: 8 }}>{label}</div>
      <div style={{
        height: 50, border: `1px solid ${active ? CQ.accentBorder : CQ.borderStrong}`,
        background: active ? CQ.accentSoft : '#fff',
        borderRadius: 8, padding: '0 14px',
        display: 'flex', alignItems: 'center',
        fontFamily: FF, fontSize: 16, color: CQ.text1, fontWeight: 500,
      }}>
        {value}
        {active && caretOn && <span style={{ display: 'inline-block', width: 2, height: 20, marginLeft: 1, background: CQ.text1 }} />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 5 — REVIEW (17.5–20.5s) — 3s
// ═══════════════════════════════════════════════════════════════════════════
function SceneCQReview() {
  const { localTime, duration } = useSprite();
  const t = localTime;

  const barT = cclamp(t / 0.4, 0, 1);
  const sumT = cclamp((t - 0.3) / 0.5, 0, 1);
  const priceT = cclamp((t - 0.5) / 0.5, 0, 1);
  const submitT = cclamp((t - 1.6) / 0.4, 0, 1);
  // Submit button pulses just before scene end
  const submitPulse = 0.5 + 0.5 * Math.sin(t * 3.5);

  return (
    <ShopChrome opacity={1}>
      <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Breadcrumb: 2 done, Review active */}
        <div style={{ padding: '22px 0 18px', display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 1100, display: 'flex', alignItems: 'center', gap: 8 }}>
            {['Configure', 'Details', 'Review'].map((lbl, i) => {
              const done = i < 2;
              const active = i === 2;
              const color = done ? CQ.green : (active ? CQ.accent : CQ.text4);
              return (
                <React.Fragment key={lbl}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 6, background: done || active ? color : 'transparent', border: `2px solid ${color}` }} />
                    <div style={{ fontFamily: FF, fontSize: 14, fontWeight: 700, color }}>{lbl}</div>
                  </div>
                  {i < 2 && <div style={{ flex: 1, height: 2, background: CQ.green, margin: '0 6px' }} />}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        <div style={{ width: 1100, margin: '0 auto' }}>
          <PricingBar label="AS Colour 5001 · PLUM (80)" perPc="13.86" total="1,108.80" opacity={barT} />
        </div>

        <div style={{ width: 1100, margin: '20px auto 0', display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <div style={{ fontFamily: FF, fontSize: 14, color: CQ.text3, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={CQ.text3} strokeWidth="2"><path d="M15 6l-6 6 6 6"/></svg> Back
          </div>
          <div style={{ fontFamily: FF, fontSize: 22, fontWeight: 800, color: CQ.text1, letterSpacing: '-0.02em' }}>Review & Submit</div>
        </div>

        <div style={{ width: 1100, margin: '0 auto', flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, paddingBottom: 24 }}>
          {/* Left column: order summary + turnaround + contact */}
          <div style={{
            opacity: sumT, transform: `translateY(${(1-sumT)*12}px)`,
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            <Card>
              <SectionLabel>ORDER SUMMARY</SectionLabel>
              <SumRow k="Style"   v="AS Colour 5001" />
              <SumRow k="Color"   v="PLUM" />
              <SumRow k="Print"   v="Front (1c Screen Print)" />
              <div style={{ marginTop: 14, fontFamily: FF, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: CQ.text3, marginBottom: 10 }}>SIZES</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {[['S',20],['M',20],['L',20],['XL',20]].map(([s,q]) => (
                  <div key={s} style={{
                    padding: '6px 12px', border: `1px solid ${CQ.border}`, borderRadius: 999,
                    fontFamily: FM, fontSize: 13, fontWeight: 600, color: CQ.text1, background: '#FAFAFC',
                  }}>{s}: {q}</div>
                ))}
                <div style={{ fontFamily: FF, fontSize: 14, color: CQ.text3, marginLeft: 6 }}>(80 pcs)</div>
              </div>
            </Card>

            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontFamily: FF, fontSize: 15, fontWeight: 500, color: CQ.text2 }}>Turnaround</div>
                <div style={{ fontFamily: FF, fontSize: 15, fontWeight: 700, color: CQ.text1 }}>Standard — 14 days</div>
              </div>
            </Card>

            <Card>
              <SectionLabel>CONTACT</SectionLabel>
              <SumRow k="Name"    v="Maya Reyes" />
              <SumRow k="Email"   v="maya@northwindco.example" />
              <SumRow k="Phone"   v="555-0142" />
              <SumRow k="Company" v="Northwind Collective" />
            </Card>
          </div>

          {/* Right column: pricing card */}
          <div style={{
            opacity: priceT, transform: `translateY(${(1-priceT)*16}px) scale(${0.97 + 0.03*priceT})`,
            background: CQ.navy, color: '#fff', borderRadius: 14, padding: 28,
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 24px 60px rgba(15,23,42,0.25)',
            alignSelf: 'start',
          }}>
            <div style={{ fontFamily: FF, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.55)' }}>PRICING SUMMARY</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 22, paddingBottom: 22, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ fontFamily: FF, fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>AS Colour 5001 · PLUM (80 pcs)</div>
              <div style={{ fontFamily: FF, fontSize: 16, fontWeight: 700 }}>$1,108.80</div>
            </div>

            <div style={{
              marginTop: 18, padding: '20px 22px',
              background: '#15803D', borderRadius: 10,
              display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 18,
            }}>
              <div>
                <div style={{ fontFamily: FF, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.85)' }}>ESTIMATED TOTAL</div>
                <div style={{ fontFamily: FF, fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 6 }}>80 pcs · $13.86/pc</div>
                <div style={{ fontFamily: FF, fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 4 }}>*Final quote confirmed after art review</div>
              </div>
              <div style={{ fontFamily: FF, fontSize: 42, fontWeight: 800, letterSpacing: '-0.025em' }}>$1,108.80</div>
            </div>

            <button style={{
              marginTop: 22, padding: '18px 24px', borderRadius: 10, border: 'none',
              background: CQ.accent, color: '#fff',
              fontFamily: FF, fontSize: 17, fontWeight: 700,
              boxShadow: `0 12px 28px rgba(79,70,229,${0.28 + 0.18*submitPulse * submitT})`,
              opacity: 0.55 + 0.45 * submitT,
              transition: 'all 0.2s',
            }}>Submit Order Request →</button>

            <div style={{ marginTop: 12, fontFamily: FF, fontSize: 12.5, color: 'rgba(255,255,255,0.55)', textAlign: 'center' }}>
              We'll confirm your order within 1 business day. No payment required now.
            </div>
          </div>
        </div>

        <CQCaption text="Review the order — submit for a final quote." time={localTime} duration={duration} delay={0.4} />
      </div>
    </ShopChrome>
  );
}

function Card({ children }) {
  return (
    <div style={{ background: CQ.surface, border: `1px solid ${CQ.border}`, borderRadius: 14, padding: '22px 24px' }}>
      {children}
    </div>
  );
}
function SectionLabel({ children }) {
  return <div style={{ fontFamily: FF, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: CQ.text3, marginBottom: 14 }}>{children}</div>;
}
function SumRow({ k, v }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
      <div style={{ fontFamily: FF, fontSize: 14, color: CQ.text3, fontWeight: 500 }}>{k}</div>
      <div style={{ fontFamily: FF, fontSize: 15, color: CQ.text1, fontWeight: 700, letterSpacing: '-0.005em' }}>{v}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 6 — SUCCESS (20.5–23s) — 2.5s
// ═══════════════════════════════════════════════════════════════════════════
function SceneCQSuccess() {
  const { localTime, duration } = useSprite();
  const t = localTime;

  // Page transitions to a celebration state
  const pageT = cclamp(t / 0.35, 0, 1);
  const ringT = cclamp((t - 0.1) / 0.5, 0, 1);
  const checkT = cclamp((t - 0.35) / 0.45, 0, 1);
  const headT = cclamp((t - 0.5) / 0.5, 0, 1);
  const subT  = cclamp((t - 0.85) / 0.5, 0, 1);
  const cardT = cclamp((t - 1.2) / 0.55, 0, 1);

  // Confetti dots
  const confetti = React.useMemo(() => Array.from({length: 22}, (_, i) => {
    const seed = i * 13 + 7;
    return {
      x: (seed * 37) % 1100 - 200,
      y: ((seed * 17) % 380) + 60,
      hue: ['#4F46E5','#A5B4FC','#16A34A','#86EFAC','#F59E0B','#FCD34D','#EC4899'][i % 7],
      sz: 6 + (seed % 5),
      delay: 0.3 + (i % 7) * 0.05,
    };
  }), []);

  return (
    <ShopChrome opacity={pageT}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 40px' }}>
        {/* Confetti */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {confetti.map((c, i) => {
            const tt = cclamp((t - c.delay) / 1.4, 0, 1);
            return (
              <div key={i} style={{
                position: 'absolute',
                left: `calc(50% + ${c.x}px)`,
                top: c.y + tt * 320,
                width: c.sz, height: c.sz, borderRadius: 2,
                background: c.hue,
                opacity: (1 - tt) * 0.9 * checkT,
                transform: `rotate(${tt * 480}deg)`,
              }} />
            );
          })}
        </div>

        {/* Green ring + check */}
        <div style={{
          width: 96, height: 96, borderRadius: 48,
          background: CQ.greenSoft,
          display: 'grid', placeItems: 'center',
          transform: `scale(${0.4 + 0.6 * ceaseOut(ringT)})`,
          opacity: ringT,
          marginBottom: 32,
        }}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <path d="M12 25 L21 34 L36 16" stroke={CQ.greenDeep} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"
              strokeDasharray="60"
              strokeDashoffset={60 * (1 - checkT)} />
          </svg>
        </div>

        <div style={{
          opacity: headT, transform: `translateY(${(1-headT)*12}px)`,
          fontFamily: FF, fontSize: 56, fontWeight: 800, color: CQ.text1,
          letterSpacing: '-0.035em', textAlign: 'center', lineHeight: 1.05,
        }}>Order Request Submitted</div>

        <div style={{
          opacity: subT, transform: `translateY(${(1-subT)*8}px)`,
          fontFamily: FF, fontSize: 18, color: CQ.text2, marginTop: 18,
          textAlign: 'center', maxWidth: 660, lineHeight: 1.45,
        }}>We've received your request and will be in touch within 1 business day with a final quote and next steps.</div>

        {/* Detail card */}
        <div style={{
          opacity: cardT, transform: `translateY(${(1-cardT)*16}px)`,
          marginTop: 36, width: 640, background: '#fff',
          border: `1px solid ${CQ.border}`, borderRadius: 14, padding: 24,
          boxShadow: '0 12px 32px rgba(15,23,42,0.06)',
        }}>
          <SumRow k="Garment"    v="AS Colour 5001 · PLUM" />
          <SumRow k="Quantity"   v="80 pcs" />
          <SumRow k="Print"      v="Front (1c)" />
          <SumRow k="Turnaround" v="Standard — 14 days" />
          <div style={{ borderTop: `1px solid ${CQ.border}`, marginTop: 14, paddingTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontFamily: FF, fontSize: 15, fontWeight: 700, color: CQ.text1 }}>Estimated Total</div>
            <div style={{ fontFamily: FF, fontSize: 22, fontWeight: 800, color: CQ.accent, letterSpacing: '-0.02em' }}>$1,108.80</div>
          </div>
        </div>

        <CQCaption text="Quote request lands in their inbox — and in your shop." time={localTime} duration={duration} delay={0.5} />
      </div>
    </ShopChrome>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE 7 — LOCKUP (23–25s) — 2s
// ═══════════════════════════════════════════════════════════════════════════
function SceneCQLockup() {
  const { localTime } = useSprite();
  const t = localTime;
  const logoT = cclamp(t / 0.5, 0, 1);
  const logoE = ceaseOut(logoT);
  const footT = cclamp((t - 0.8) / 0.5, 0, 1);

  return (
    <div style={{
      position: 'absolute', inset: 0, background: CQ.darkBg,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        opacity: logoE, transform: `translateY(${(1-logoE)*10}px) scale(${0.95 + 0.05*logoE})`,
        display: 'flex', alignItems: 'center', gap: 18, marginBottom: 28,
      }}>
        <CQLogo size={72} />
        <div style={{ fontFamily: FF, fontSize: 56, fontWeight: 800, color: CQ.darkText1, letterSpacing: '-0.03em' }}>InkTracker</div>
      </div>

      <div style={{
        opacity: footT, marginTop: 8,
        fontFamily: FF, fontSize: 14, color: CQ.darkText3, letterSpacing: '0.01em',
      }}>$99/mo after trial · Cancel anytime</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MASTER COMPOSER
// ═══════════════════════════════════════════════════════════════════════════
function CustomerQuoteDemo() {
  return (
    <>
      <Sprite start={0}    end={3}>   <SceneCQHook />    </Sprite>
      <Sprite start={3}    end={7.5}> <SceneCQStyle />   </Sprite>
      <Sprite start={7.5}  end={14}>  <SceneCQConfig />  </Sprite>
      <Sprite start={14}   end={17.5}><SceneCQDetails /> </Sprite>
      <Sprite start={17.5} end={20.5}><SceneCQReview />  </Sprite>
      <Sprite start={20.5} end={23}>  <SceneCQSuccess /> </Sprite>
      <Sprite start={23}   end={25}>  <SceneCQLockup />  </Sprite>
    </>
  );
}

window.CustomerQuoteDemo = CustomerQuoteDemo;
