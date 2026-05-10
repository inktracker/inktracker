// DemoBanner.jsx — InkTracker 25s animated feature demo
// Ported from standalone HTML demo into a single React component.
// Plays once automatically, stops on the lockup scene.

import {
  useState,
  useEffect,
  useRef,
  useContext,
  createContext,
  useMemo,
  useCallback,
} from 'react';

// ── Easing functions ────────────────────────────────────────────────────────
const Easing = {
  linear: (t) => t,
  easeInQuad:    (t) => t * t,
  easeOutQuad:   (t) => t * (2 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInCubic:    (t) => t * t * t,
  easeOutCubic:   (t) => (--t) * t * t + 1,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  easeInQuart:    (t) => t * t * t * t,
  easeOutQuart:   (t) => 1 - (--t) * t * t * t,
  easeInOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t),
  easeInExpo:  (t) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1))),
  easeOutExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  easeInOutExpo: (t) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    if (t < 0.5) return 0.5 * Math.pow(2, 20 * t - 10);
    return 1 - 0.5 * Math.pow(2, -20 * t + 10);
  },
  easeInSine:    (t) => 1 - Math.cos((t * Math.PI) / 2),
  easeOutSine:   (t) => Math.sin((t * Math.PI) / 2),
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  easeOutBack: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeInBack: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
  easeInOutBack: (t) => {
    const c1 = 1.70158, c2 = c1 * 1.525;
    return t < 0.5
      ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
  },
  easeOutElastic: (t) => {
    const c4 = (2 * Math.PI) / 3;
    if (t === 0) return 0;
    if (t === 1) return 1;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};

// ── Core interpolation helpers ──────────────────────────────────────────────
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function interpolate(input, output, ease = Easing.linear) {
  return (t) => {
    if (t <= input[0]) return output[0];
    if (t >= input[input.length - 1]) return output[output.length - 1];
    for (let i = 0; i < input.length - 1; i++) {
      if (t >= input[i] && t <= input[i + 1]) {
        const span = input[i + 1] - input[i];
        const local = span === 0 ? 0 : (t - input[i]) / span;
        const easeFn = Array.isArray(ease) ? (ease[i] || Easing.linear) : ease;
        const eased = easeFn(local);
        return output[i] + (output[i + 1] - output[i]) * eased;
      }
    }
    return output[output.length - 1];
  };
}

// ── Timeline context ────────────────────────────────────────────────────────
const TimelineContext = createContext({ time: 0, duration: 10, playing: false });
const useTime = () => useContext(TimelineContext).time;
const useTimeline = () => useContext(TimelineContext);

// ── Sprite ──────────────────────────────────────────────────────────────────
const SpriteContext = createContext({ localTime: 0, progress: 0, duration: 0 });
const useSprite = () => useContext(SpriteContext);

function Sprite({ start = 0, end = Infinity, children, keepMounted = false }) {
  const { time } = useTimeline();
  const visible = time >= start && time <= end;
  if (!visible && !keepMounted) return null;

  const duration = end - start;
  const localTime = Math.max(0, time - start);
  const progress = duration > 0 && isFinite(duration)
    ? clamp(localTime / duration, 0, 1)
    : 0;

  const value = { localTime, progress, duration, visible };

  return (
    <SpriteContext.Provider value={value}>
      {typeof children === 'function' ? children(value) : children}
    </SpriteContext.Provider>
  );
}

// ── KenBurns ────────────────────────────────────────────────────────────────
// Cinematic slow zoom/pan over a scene's lifetime. Reads progress from the
// nearest Sprite. `from`/`to` are interpolated linearly via `easing`.
function KenBurns({
  from = { scale: 1, x: 0, y: 0 },
  to   = { scale: 1, x: 0, y: 0 },
  origin = 'center center',
  easing = Easing.easeInOutCubic,
  children,
}) {
  const { progress } = useSprite();
  const t = easing(clamp(progress, 0, 1));
  const scale = from.scale + (to.scale - from.scale) * t;
  const x = from.x + (to.x - from.x) * t;
  const y = from.y + (to.y - from.y) * t;
  return (
    <div style={{
      position: 'absolute', inset: 0,
      transform: `scale(${scale}) translate(${x}px, ${y}px)`,
      transformOrigin: origin,
      willChange: 'transform',
    }}>
      {children}
    </div>
  );
}

// ── TextSprite ──────────────────────────────────────────────────────────────
function TextSprite({
  text,
  x = 0, y = 0,
  size = 48,
  color = '#111',
  font = 'Inter, system-ui, sans-serif',
  weight = 600,
  entryDur = 0.45,
  exitDur = 0.35,
  entryEase = Easing.easeOutBack,
  exitEase = Easing.easeInCubic,
  align = 'left',
  letterSpacing = '-0.01em',
}) {
  const { localTime, duration } = useSprite();
  const exitStart = Math.max(0, duration - exitDur);

  let opacity = 1;
  let ty = 0;

  if (localTime < entryDur) {
    const t = entryEase(clamp(localTime / entryDur, 0, 1));
    opacity = t;
    ty = (1 - t) * 16;
  } else if (localTime > exitStart) {
    const t = exitEase(clamp((localTime - exitStart) / exitDur, 0, 1));
    opacity = 1 - t;
    ty = -t * 8;
  }

  const translateX = align === 'center' ? '-50%' : align === 'right' ? '-100%' : '0';

  return (
    <div style={{
      position: 'absolute',
      left: x, top: y,
      transform: `translate(${translateX}, ${ty}px)`,
      opacity,
      fontFamily: font,
      fontSize: size,
      fontWeight: weight,
      color,
      letterSpacing,
      whiteSpace: 'pre',
      lineHeight: 1.1,
      willChange: 'transform, opacity',
    }}>
      {text}
    </div>
  );
}

// ── ImageSprite ─────────────────────────────────────────────────────────────
function ImageSprite({
  src,
  x = 0, y = 0,
  width = 400, height = 300,
  entryDur = 0.6,
  exitDur = 0.4,
  kenBurns = false,
  kenBurnsScale = 1.08,
  radius = 12,
  fit = 'cover',
  placeholder = null,
}) {
  const { localTime, duration } = useSprite();
  const exitStart = Math.max(0, duration - exitDur);

  let opacity = 1;
  let scale = 1;

  if (localTime < entryDur) {
    const t = Easing.easeOutCubic(clamp(localTime / entryDur, 0, 1));
    opacity = t;
    scale = 0.96 + 0.04 * t;
  } else if (localTime > exitStart) {
    const t = Easing.easeInCubic(clamp((localTime - exitStart) / exitDur, 0, 1));
    opacity = 1 - t;
    scale = (kenBurns ? kenBurnsScale : 1) + 0.02 * t;
  } else if (kenBurns) {
    const holdSpan = exitStart - entryDur;
    const holdT = holdSpan > 0 ? (localTime - entryDur) / holdSpan : 0;
    scale = 1 + (kenBurnsScale - 1) * holdT;
  }

  const content = placeholder ? (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'repeating-linear-gradient(135deg, #e9e6df 0 10px, #dcd8cf 10px 20px)',
      color: '#6b6458',
      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
      fontSize: 13,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
    }}>
      {placeholder.label || 'image'}
    </div>
  ) : (
    <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: fit, display: 'block' }} />
  );

  return (
    <div style={{
      position: 'absolute',
      left: x, top: y,
      width, height,
      opacity,
      transform: `scale(${scale})`,
      transformOrigin: 'center',
      borderRadius: radius,
      overflow: 'hidden',
      willChange: 'transform, opacity',
    }}>
      {content}
    </div>
  );
}

// ── RectSprite ──────────────────────────────────────────────────────────────
function RectSprite({
  x = 0, y = 0,
  width = 100, height = 100,
  color = '#111',
  radius = 8,
  entryDur = 0.4,
  exitDur = 0.3,
  render,
}) {
  const spriteCtx = useSprite();
  const { localTime, duration } = spriteCtx;
  const exitStart = Math.max(0, duration - exitDur);

  let opacity = 1;
  let scale = 1;

  if (localTime < entryDur) {
    const t = Easing.easeOutBack(clamp(localTime / entryDur, 0, 1));
    opacity = clamp(localTime / entryDur, 0, 1);
    scale = 0.4 + 0.6 * t;
  } else if (localTime > exitStart) {
    const t = Easing.easeInQuad(clamp((localTime - exitStart) / exitDur, 0, 1));
    opacity = 1 - t;
    scale = 1 - 0.15 * t;
  }

  const overrides = render ? render(spriteCtx) : {};

  return (
    <div style={{
      position: 'absolute',
      left: x, top: y,
      width, height,
      background: color,
      borderRadius: radius,
      opacity,
      transform: `scale(${scale})`,
      transformOrigin: 'center',
      willChange: 'transform, opacity',
      ...overrides,
    }} />
  );
}

// ── Stage ───────────────────────────────────────────────────────────────────
// Stripped-down: no playback bar, no keyboard shortcuts, no localStorage,
// loop=false, auto-scales to container width.

function Stage({
  width = 1920,
  height = 1080,
  duration = 25,
  background = '#f6f4ef',
  children,
}) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [scale, setScale] = useState(1);

  const containerRef = useRef(null);
  const rafRef = useRef(null);
  const lastTsRef = useRef(null);

  // Auto-scale to fit container width, capped to viewport height minus nav + hero pad
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const measure = () => {
      // Reserve 88px for nav + a sliver of breathing room so the stage stays
      // fully above the fold on standard desktop viewports.
      const maxH = window.innerHeight - 88;
      const scaleByW = el.clientWidth / width;
      const scaleByH = maxH / height;
      setScale(Math.max(0.05, Math.min(scaleByW, scaleByH)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [width, height]);

  // Animation loop — plays once, stops at end
  useEffect(() => {
    if (!playing) {
      lastTsRef.current = null;
      return;
    }
    const step = (ts) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      setTime((t) => {
        let next = t + dt;
        if (next >= duration) {
          next = duration;
          setPlaying(false);
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTsRef.current = null;
    };
  }, [playing, duration]);

  const ctxValue = useMemo(
    () => ({ time, duration, playing, setTime, setPlaying }),
    [time, duration, playing]
  );

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: height * scale,
        position: 'relative',
        overflow: 'hidden',
        fontFamily: 'Inter, system-ui, sans-serif',
        margin: '0 auto',
        maxWidth: width * scale,
      }}
    >
      <div
        style={{
          width,
          height,
          background,
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: `translateX(-50%) scale(${scale})`,
          transformOrigin: 'top center',
          overflow: 'hidden',
        }}
      >
        <TimelineContext.Provider value={ctxValue}>
          {children}
        </TimelineContext.Provider>
      </div>
    </div>
  );
}

// ── DemoBanner context for CTA callbacks ────────────────────────────────────
const DemoBannerContext = createContext({ onSignup: null });

// ════════════════════════════════════════════════════════════════════════════
// SCENES (ported from scenes.jsx — all visuals preserved exactly)
// ════════════════════════════════════════════════════════════════════════════

const C = {
  darkBg: '#0B0B0E',
  darkText1: '#F4F4F5',
  darkText2: 'rgba(244,244,245,0.62)',
  darkText3: 'rgba(244,244,245,0.40)',
  darkBorder: 'rgba(255,255,255,0.08)',
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
  accentSofter: '#F5F3FF',
  accentText: '#4338CA',
  dropTop: '#F09173',
  dropMid: '#E68A6E',
  dropTeal: '#3F8676',
  dropDeep: '#2A6F62',
};

const FONT = '"Inter", system-ui, -apple-system, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace';

const STATUS = {
  Intake:  { bg: '#EEF2FF', fg: '#4338CA', dot: '#6366F1' },
  Quote:   { bg: '#EEF2FF', fg: '#4338CA', dot: '#6366F1' },
  Mockup:  { bg: '#F5F3FF', fg: '#6D28D9', dot: '#8B5CF6' },
  Seps:    { bg: '#FEF3C7', fg: '#92400E', dot: '#F59E0B' },
  Press:   { bg: '#FEE2E2', fg: '#B91C1C', dot: '#EF4444' },
  QC:      { bg: '#FEF9C3', fg: '#854D0E', dot: '#EAB308' },
  Ship:    { bg: '#DCFCE7', fg: '#15803D', dot: '#22C55E' },
  Hold:    { bg: '#F1F5F9', fg: '#64748B', dot: '#94A3B8' },
};

// ── Brand mark ──────────────────────────────────────────────────────────────
const INKTRACKER_LOGO_URL =
  "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69aa650fd3e825e66ff81817/b4e2dc53f_logo.png";

function FlameMark({ size = 32, animate = false, time = 0, ripple = false }) {
  const bobY = animate ? Math.sin(time * 1.2) * 1.4 : 0;
  const breathe = animate ? 1 + Math.sin(time * 1.4) * 0.012 : 1;

  const rPhase = ripple ? ((time % 2.4) / 1.6) : -1;
  const rT = rPhase >= 0 && rPhase <= 1 ? rPhase : -1;
  const rOp = rT >= 0 ? (1 - rT) * 0.45 : 0;
  const rScale = rT >= 0 ? 1 + rT * 0.55 : 1;

  return (
    <div style={{
      position: 'relative',
      width: size, height: size,
      display: 'inline-block',
      flexShrink: 0,
    }}>
      {rT >= 0 && (
        <div style={{
          position: 'absolute',
          inset: -size * 0.18,
          borderRadius: '50%',
          border: `1.5px solid ${C.dropTop}`,
          opacity: rOp,
          transform: `scale(${rScale})`,
          pointerEvents: 'none',
        }} />
      )}
      <img
        src={INKTRACKER_LOGO_URL}
        alt="InkTracker"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          transform: `translateY(${bobY}px) scale(${breathe})`,
          transformOrigin: 'center 60%',
          display: 'block',
        }}
      />
    </div>
  );
}

// ── Pill / badge ────────────────────────────────────────────────────────────
const Pill = ({ status, size = 'md' }) => {
  const s = STATUS[status] || STATUS.Hold;
  const pad = size === 'sm' ? '3px 9px' : '5px 11px';
  const fs = size === 'sm' ? 11 : 12;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: pad, borderRadius: 999,
      background: s.bg, color: s.fg,
      fontFamily: FONT, fontSize: fs, fontWeight: 500,
      letterSpacing: '0.005em',
      whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: s.dot }} />
      {status}
    </span>
  );
};

// ── Sidebar ─────────────────────────────────────────────────────────────────
const SIDEBAR_ITEMS = [
  { label: 'Dashboard',   icon: 'home',  count: null },
  { label: 'Inbox',       icon: 'inbox', count: 3 },
  { label: 'Quotes',      icon: 'doc',   count: 12 },
  { label: 'Production',  icon: 'grid',  count: 8 },
  { label: 'Customers',   icon: 'users', count: null },
  { label: 'Inventory',   icon: 'box',   count: null },
  { label: 'Invoices',    icon: 'cash',  count: null },
  { label: 'Expenses',    icon: 'card',  count: null },
  { label: 'Performance', icon: 'chart', count: null },
  { label: 'Mockups',     icon: 'paint', count: null },
  { label: 'Wizard',      icon: 'wand',  count: null },
  { label: 'Embed',       icon: 'code',  count: null },
];

function Sidebar({ active = 'Inbox' }) {
  return (
    <div style={{
      position: 'absolute', left: 0, top: 0, bottom: 0,
      width: 240,
      borderRight: `1px solid ${C.border}`,
      background: C.surface,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '18px 18px 16px',
        borderBottom: `1px solid ${C.border}`,
      }}>
        <FlameMark size={28} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 700, color: C.text1, letterSpacing: '-0.01em' }}>Biota Mfg</span>
          <span style={{ fontFamily: FONT, fontSize: 11, color: C.text3, letterSpacing: '0.02em' }}>Shop Manager</span>
        </div>
      </div>
      <div style={{ padding: '10px 10px', flex: 1, overflow: 'hidden' }}>
        {SIDEBAR_ITEMS.map((it) => {
          const isActive = it.label === active;
          return (
            <div key={it.label} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 10px',
              margin: '1px 0',
              borderRadius: 8,
              background: isActive ? C.accent : 'transparent',
              color: isActive ? '#fff' : C.text2,
              fontFamily: FONT, fontSize: 13.5, fontWeight: isActive ? 600 : 500,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <NavIcon kind={it.icon} active={isActive} />
                <span>{it.label}</span>
              </div>
              {it.count != null && (
                <span style={{
                  fontFamily: FONT, fontSize: 11.5, fontWeight: 600,
                  color: isActive ? 'rgba(255,255,255,0.85)' : C.text3,
                  fontVariantNumeric: 'tabular-nums',
                  background: isActive ? 'rgba(255,255,255,0.18)' : C.surface2,
                  padding: '1px 7px',
                  borderRadius: 999,
                  minWidth: 22, textAlign: 'center',
                }}>{it.count}</span>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ padding: 10, borderTop: `1px solid ${C.border}` }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 10px',
          background: C.surface2,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          fontFamily: FONT, fontSize: 13, color: C.text3,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.text3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          Search...
        </div>
      </div>
      <div style={{
        padding: '6px 14px 10px',
        fontFamily: MONO, fontSize: 10, color: C.text4, letterSpacing: '0.06em',
      }}>v1.0</div>
    </div>
  );
}

function NavIcon({ kind, active }) {
  const c = active ? '#fff' : C.text3;
  const props = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: c, strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (kind) {
    case 'home':  return <svg {...props}><path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-4v-7H8v7H4a1 1 0 01-1-1z"/></svg>;
    case 'inbox': return <svg {...props}><path d="M3 13h4l2 3h6l2-3h4M3 13l3-7h12l3 7M3 13v6a1 1 0 001 1h16a1 1 0 001-1v-6"/></svg>;
    case 'doc':   return <svg {...props}><path d="M7 3h8l4 4v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1zM14 3v5h5"/></svg>;
    case 'grid':  return <svg {...props}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>;
    case 'users': return <svg {...props}><circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="8" r="2.6"/><path d="M15 14c2 0 6 2 6 5"/></svg>;
    case 'box':   return <svg {...props}><path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>;
    case 'cash':  return <svg {...props}><rect x="2" y="6" width="20" height="12" rx="1"/><circle cx="12" cy="12" r="3"/><path d="M6 10v4M18 10v4"/></svg>;
    case 'card':  return <svg {...props}><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M2 10h20"/></svg>;
    case 'chart': return <svg {...props}><path d="M3 21h18M5 17V9M11 17V5M17 17v-6"/></svg>;
    case 'paint': return <svg {...props}><path d="M19 11a8 8 0 11-16 0c0-4.4 3.6-8 8-8 4 0 6 2 6 4s-2 2-2 4 4 1 4 0z"/><circle cx="7.5" cy="10.5" r="0.8" fill={c}/><circle cx="12" cy="7.5" r="0.8" fill={c}/><circle cx="15.5" cy="11" r="0.8" fill={c}/></svg>;
    case 'wand':  return <svg {...props}><path d="M15 4l5 5-9 11-5-5z"/><path d="M3 21l3-3M14 5l5 5"/></svg>;
    case 'code':  return <svg {...props}><path d="M8 6L2 12l6 6M16 6l6 6-6 6M14 4l-4 16"/></svg>;
    default: return null;
  }
}

// ── AppWindow chrome ────────────────────────────────────────────────────────
function AppWindow({ width, height, x, y, title = 'InkTracker', children, opacity = 1, transform = '' }) {
  return (
    <div style={{
      position: 'absolute',
      left: x, top: y, width, height,
      transform,
      opacity,
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 14,
      overflow: 'hidden',
      boxShadow: '0 24px 60px rgba(15,23,42,0.18), 0 4px 12px rgba(15,23,42,0.06)',
    }}>
      <div style={{
        height: 38,
        display: 'flex', alignItems: 'center',
        padding: '0 14px',
        borderBottom: `1px solid ${C.border}`,
        background: C.surface2,
        gap: 12,
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ width: 11, height: 11, borderRadius: 6, background: '#FF6058' }} />
          <div style={{ width: 11, height: 11, borderRadius: 6, background: '#FFBE2F' }} />
          <div style={{ width: 11, height: 11, borderRadius: 6, background: '#28C940' }} />
        </div>
        <div style={{
          fontFamily: FONT, fontSize: 12, color: C.text3,
          letterSpacing: '0.01em',
        }}>{title}</div>
      </div>
      <div style={{ position: 'relative', width: '100%', height: 'calc(100% - 38px)', background: C.appBg }}>{children}</div>
    </div>
  );
}

// ── SCENE 1 — HOOK ──────────────────────────────────────────────────────────
function SceneHook() {
  const { localTime } = useSprite();
  const head1 = 'Run your print shop';
  const head2 = 'without the chaos';

  const t1Start = 0.5, t1End = 1.4;
  const t2Start = 1.5, t2End = 2.4;

  const t1 = clamp((localTime - t1Start) / (t1End - t1Start), 0, 1);
  const t2 = clamp((localTime - t2Start) / (t2End - t2Start), 0, 1);
  const visible1 = head1.slice(0, Math.floor(t1 * head1.length));
  const visible2 = head2.slice(0, Math.floor(t2 * head2.length));

  const blink = (localTime % 0.9) < 0.5;
  const cursorOnLine2 = localTime >= t1End - 0.05;
  const showCursor = localTime < t2End ? true : blink;

  const tagFade = clamp((localTime - 0.2) / 0.5, 0, 1);

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: C.darkBg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column',
    }}>
      <BgGrid dark intense={false} />

      <div style={{
        opacity: tagFade,
        transform: `translateY(${(1 - tagFade) * 6}px)`,
        display: 'flex', alignItems: 'center', gap: 10,
        marginBottom: 36,
      }}>
        <FlameMark size={26} animate time={localTime} />
        <span style={{
          fontFamily: FONT, fontSize: 16, fontWeight: 600,
          color: C.darkText1, letterSpacing: '-0.01em',
        }}>InkTracker</span>
      </div>

      <div style={{
        fontFamily: FONT, fontSize: 96, fontWeight: 700,
        letterSpacing: '-0.04em',
        lineHeight: 1.08,
        textAlign: 'center',
        position: 'relative',
      }}>
        <div style={{ color: C.darkText1, whiteSpace: 'nowrap' }}>
          <span>{visible1}</span>
          {!cursorOnLine2 && (
            <span style={{
              display: 'inline-block', width: 6, height: 84,
              marginLeft: 8, background: C.accent,
              opacity: showCursor ? 1 : 0,
              transform: 'translateY(10px)',
              borderRadius: 1,
              verticalAlign: 'baseline',
            }} />
          )}
        </div>
        <div style={{ color: C.accent, whiteSpace: 'nowrap', marginTop: 6 }}>
          <span>{visible2}</span>
          {cursorOnLine2 && (
            <span style={{
              display: 'inline-block', width: 6, height: 84,
              marginLeft: 8, background: C.accent,
              opacity: showCursor ? 1 : 0,
              transform: 'translateY(10px)',
              borderRadius: 1,
              verticalAlign: 'baseline',
            }} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── SCENE 2 — INBOX / INTAKE ────────────────────────────────────────────────
const SCAFFOLD_STEPS = [
  { d: 0.0,  label: 'Quote drafted',         val: 'Q-2026-014',     mono: true },
  { d: 0.18, label: 'Customer linked',       val: 'Biota Mfg.',     mono: false },
  { d: 0.36, label: 'Line items added',      val: '250 \u00d7 Tee \u00b7 2-color front', mono: false },
  { d: 0.54, label: 'Pricing computed',      val: '$1,572.50',      mono: true },
  { d: 0.72, label: 'Mockup queued',         val: 'AS Colour 5001 \u2014 Black', mono: false },
  { d: 0.90, label: 'Production slot held',  val: 'May 14 \u00b7 Press Head 4',  mono: false },
];

function SceneIntake() {
  const { localTime, duration } = useSprite();

  const winFade = clamp(localTime / 0.5, 0, 1);
  const rowInT = clamp((localTime - 0.5) / 0.5, 0, 1);
  const clickT = clamp((localTime - 1.6) / 0.25, 0, 1);
  const convertT = clamp((localTime - 1.85) / 0.4, 0, 1);

  const stepStart = 2.2;
  const stepStep = 0.35;

  const stampT = clamp((localTime - 4.2) / 0.45, 0, 1);
  const stampScale = 2.2 - 1.2 * Easing.easeOutCubic(stampT);
  const stampRot = -8 + 8 * Easing.easeOutCubic(stampT);

  const capT = clamp((localTime - 4.0) / 0.5, 0, 1);
  const capOutT = clamp((localTime - duration + 0.5) / 0.5, 0, 1);
  const capOp = capT * (1 - capOutT);

  const winOut = clamp((localTime - duration + 0.4) / 0.4, 0, 1);
  const winOpacity = winFade * (1 - winOut);

  return (
    <div style={{ position: 'absolute', inset: 0, background: C.appBg }}>
      <AppWindow
        x={120} y={90}
        width={1680} height={900}
        title="InkTracker \u2014 Inbox"
        opacity={winOpacity}
      >
        <Sidebar active="Inbox" />

        <div style={{
          position: 'absolute',
          left: 240, top: 0, right: 0, bottom: 0,
          padding: '32px 44px',
          overflow: 'hidden',
        }}>
          <div style={{ marginBottom: 24 }}>
            <div style={{
              fontFamily: FONT, fontSize: 12, color: C.text3,
              textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600,
              marginBottom: 6,
            }}>Inbox</div>
            <div style={{
              fontFamily: FONT, fontSize: 30, fontWeight: 700,
              color: C.text1, letterSpacing: '-0.025em',
            }}>New orders</div>
          </div>

          <div style={{
            opacity: rowInT,
            transform: `translateY(${(1 - rowInT) * 10}px)`,
            position: 'relative',
            background: C.surface,
            border: `1px solid ${convertT > 0 ? C.accent : C.border}`,
            borderRadius: 12,
            padding: '18px 20px',
            display: 'flex', alignItems: 'center', gap: 16,
            boxShadow: clickT > 0 ? '0 8px 24px rgba(79,70,229,0.15)' : '0 1px 2px rgba(15,23,42,0.04)',
            transition: 'box-shadow 200ms, border-color 200ms',
            marginBottom: 22,
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: C.accentSoft,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M3 7l9 6 9-6M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7M3 7a2 2 0 012-2h14a2 2 0 012 2"
                  stroke={C.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4,
              }}>
                <span style={{
                  fontFamily: FONT, fontSize: 14.5, fontWeight: 600, color: C.text1,
                }}>orders@biotamfg.co</span>
                <span style={{ fontFamily: FONT, fontSize: 12.5, color: C.text3 }}>{'\u00b7'} just now</span>
              </div>
              <div style={{
                fontFamily: FONT, fontSize: 14, color: C.text2,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>250 {'\u00d7'} Unisex Tee, 2-color front, PMS 286 {'\u00b7'} need by May 14</div>
            </div>
            <div style={{
              opacity: convertT > 0 ? 1 : (clickT > 0 ? 1 : 0.6),
              transform: `scale(${clickT > 0 && convertT < 1 ? 0.96 : 1})`,
              transition: 'transform 120ms',
              padding: '9px 16px',
              background: convertT > 0 ? C.accent : C.surface,
              color: convertT > 0 ? '#fff' : C.accentText,
              border: `1px solid ${C.accent}`,
              borderRadius: 8,
              fontFamily: FONT, fontSize: 13, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 6,
              whiteSpace: 'nowrap',
            }}>
              {convertT > 0.5 ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  Converted
                </>
              ) : (
                <>+ Convert to Quote</>
              )}
            </div>
            {clickT > 0 && clickT < 1 && (
              <div style={{
                position: 'absolute',
                right: 50 + (1 - clickT) * 20,
                top: 36 + (1 - clickT) * 12,
                pointerEvents: 'none',
              }}>
                <CursorPointer />
              </div>
            )}
          </div>

          <div style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: '20px 22px',
            opacity: clamp((localTime - 2.0) / 0.4, 0, 1),
            transform: `translateY(${(1 - clamp((localTime - 2.0) / 0.4, 0, 1)) * 10}px)`,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 14,
            }}>
              <div style={{
                fontFamily: FONT, fontSize: 12, color: C.text3,
                textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600,
              }}>Scaffolding job...</div>
              <div style={{
                fontFamily: MONO, fontSize: 12, color: C.text2,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {Math.min(SCAFFOLD_STEPS.length, Math.floor((localTime - stepStart) / stepStep + 1))} / {SCAFFOLD_STEPS.length}
              </div>
            </div>

            {SCAFFOLD_STEPS.map((s, i) => {
              const t = clamp((localTime - stepStart - i * stepStep) / 0.3, 0, 1);
              const e = Easing.easeOutCubic(t);
              const isQuoteRow = i === 0;
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '11px 0',
                  borderBottom: i === SCAFFOLD_STEPS.length - 1 ? 'none' : `1px solid ${C.border}`,
                  opacity: e,
                  transform: `translateX(${(1 - e) * -8}px)`,
                }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: 11,
                    background: t > 0.7 ? C.accent : C.accentSoft,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'background 200ms',
                  }}>
                    {t > 0.7 ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    ) : (
                      <div style={{
                        width: 8, height: 8, borderRadius: 4,
                        border: `2px solid ${C.accent}`,
                        borderTopColor: 'transparent',
                        animation: 'spin 0.8s linear infinite',
                      }} />
                    )}
                  </div>
                  <div style={{
                    fontFamily: FONT, fontSize: 14, color: C.text2,
                    flex: 1,
                    whiteSpace: 'nowrap',
                  }}>{s.label}</div>
                  <div style={{
                    fontFamily: s.mono ? MONO : FONT,
                    fontSize: 13.5, fontWeight: 600,
                    color: isQuoteRow ? C.accent : C.text1,
                    position: 'relative',
                    whiteSpace: 'nowrap',
                  }}>
                    {s.val}
                    {isQuoteRow && stampT > 0 && (
                      <span style={{
                        display: 'inline-block',
                        marginLeft: 12,
                        transform: `rotate(${stampRot}deg) scale(${stampScale})`,
                        transformOrigin: 'left center',
                        padding: '2px 9px',
                        border: `1.5px solid ${C.accent}`,
                        borderRadius: 4,
                        color: C.accent,
                        fontFamily: MONO, fontSize: 10.5, fontWeight: 700,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        background: C.accentSoft,
                        whiteSpace: 'nowrap',
                      }}>NEW</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{
            position: 'absolute',
            left: 44, bottom: 32,
            opacity: capOp,
            transform: `translateY(${(1 - capT) * 6}px)`,
          }}>
            <div style={{
              fontFamily: FONT, fontSize: 12.5, color: C.accent,
              textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 700,
              marginBottom: 6,
            }}>01 {'\u2014'} Intake</div>
            <div style={{
              fontFamily: FONT, fontSize: 26, fontWeight: 600,
              color: C.text1, letterSpacing: '-0.02em',
            }}>New job {'\u2192'} scaffolded in seconds.</div>
          </div>
        </div>
      </AppWindow>
    </div>
  );
}

function CursorPointer() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.25))' }}>
      <path d="M3 2l7 18 2.5-7.5L20 10z" fill="#fff" stroke="#0F172A" strokeWidth="1.4" strokeLinejoin="round"/>
    </svg>
  );
}

// ── SCENE 3 — PRODUCTION DASHBOARD ──────────────────────────────────────────
const JOBS = [
  { id: 'Q-2026-014', client: 'Biota Mfg.',     qty: 250, colors: 2, status: 'Intake', due: 'May 14' },
  { id: 'Q-2026-009', client: 'Oakridge HC',    qty: 480, colors: 1, status: 'Press',  due: 'May 09' },
  { id: 'Q-2026-021', client: 'North Trail Co.',qty: 120, colors: 4, status: 'Seps',   due: 'May 16' },
  { id: 'Q-2026-017', client: 'Grove Coffee',   qty: 600, colors: 3, status: 'Press',  due: 'May 11' },
  { id: 'Q-2026-008', client: 'Field & Co.',    qty: 90,  colors: 2, status: 'Ship',   due: 'May 08' },
  { id: 'Q-2026-011', client: 'Kalia Studio',   qty: 36,  colors: 1, status: 'QC',     due: 'May 12' },
  { id: 'Q-2026-013', client: 'Pine Lake Brew', qty: 144, colors: 5, status: 'Seps',   due: 'May 15' },
  { id: 'Q-2026-006', client: 'Stone Athletics',qty: 320, colors: 2, status: 'Hold',   due: 'May 18' },
];

const SORTED = ['Q-2026-009', 'Q-2026-017', 'Q-2026-021', 'Q-2026-013', 'Q-2026-014', 'Q-2026-011', 'Q-2026-008', 'Q-2026-006'];

const FLIPS = [
  { id: 'Q-2026-021', from: 'Seps',  to: 'Press', t: 3.4 },
  { id: 'Q-2026-011', from: 'QC',    to: 'Ship',  t: 4.2 },
];

function SceneDashboard() {
  const { localTime, duration } = useSprite();

  const zoomT = clamp(localTime / 0.9, 0, 1);
  const zoom = interpolate([0, 1], [1.08, 1], Easing.easeOutCubic)(zoomT);
  const enterOp = Easing.easeOutCubic(zoomT);

  const sortT = clamp((localTime - 1.8) / 0.7, 0, 1);

  const cols = 4, rows = 2;
  const cardW = 340, cardH = 188;
  const gap = 20;
  const gridW = cols * cardW + (cols - 1) * gap;
  const gridH = rows * cardH + (rows - 1) * gap;
  const panelLeft = 240;

  const positionFor = (idx) => ({
    x: (idx % cols) * (cardW + gap),
    y: Math.floor(idx / cols) * (cardH + gap),
  });

  const cards = JOBS.map((job) => {
    const fromIdx = JOBS.findIndex(j => j.id === job.id);
    const toIdx = SORTED.findIndex(id => id === job.id);
    const from = positionFor(fromIdx);
    const to = positionFor(toIdx);
    const x = from.x + (to.x - from.x) * Easing.easeInOutCubic(sortT);
    const y = from.y + (to.y - from.y) * Easing.easeInOutCubic(sortT);

    let status = job.status;
    let pulse = 0;
    for (const f of FLIPS) {
      if (f.id === job.id) {
        if (localTime > f.t) status = f.to;
        const pT = clamp((localTime - f.t) / 0.4, 0, 1);
        if (pT > 0 && pT < 1) pulse = Math.sin(pT * Math.PI);
      }
    }
    const isNew = job.id === 'Q-2026-014';
    const newGlow = isNew ? clamp(1 - localTime / 3.5, 0, 1) : 0;
    return { job, x, y, status, pulse, newGlow };
  });

  const counts = {
    Intake: cards.filter(c => c.status === 'Intake').length,
    Seps:   cards.filter(c => c.status === 'Seps').length,
    Press:  cards.filter(c => c.status === 'Press').length,
    QC:     cards.filter(c => c.status === 'QC').length,
    Ship:   cards.filter(c => c.status === 'Ship').length,
  };

  const capT = clamp((localTime - 2.6) / 0.5, 0, 1);
  const capOutT = clamp((localTime - duration + 0.5) / 0.5, 0, 1);
  const capOp = capT * (1 - capOutT);

  const exitT = clamp((localTime - duration + 0.5) / 0.5, 0, 1);
  const exitScale = 1 + 0.06 * Easing.easeInCubic(exitT);
  const exitOp = 1 - exitT;

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: C.appBg,
      transform: `scale(${zoom * exitScale})`,
      transformOrigin: 'center',
      opacity: enterOp * exitOp,
    }}>
      <AppWindow
        x={60} y={50}
        width={1800} height={980}
        title="InkTracker \u2014 Production"
      >
        <Sidebar active="Production" />

        <div style={{
          position: 'absolute', left: panelLeft, top: 0, right: 0, bottom: 0,
          padding: '32px 36px',
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
            marginBottom: 24,
          }}>
            <div>
              <div style={{
                fontFamily: FONT, fontSize: 12, color: C.text3,
                textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600,
                marginBottom: 6,
              }}>Week 19 {'\u00b7'} May 04 {'\u2014'} May 10</div>
              <div style={{
                fontFamily: FONT, fontSize: 30, fontWeight: 700,
                color: C.text1, letterSpacing: '-0.025em',
              }}>Production board</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {Object.entries(counts).map(([k, v]) => (
                <div key={k} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 12px',
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: STATUS[k].dot }} />
                  <span style={{ fontFamily: FONT, fontSize: 12, color: C.text2, whiteSpace: 'nowrap' }}>{k}</span>
                  <span style={{
                    fontFamily: FONT, fontSize: 13, fontWeight: 700,
                    color: C.text1, fontVariantNumeric: 'tabular-nums',
                  }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ position: 'relative', width: gridW, height: gridH }}>
            {cards.map(({ job, x, y, status, pulse, newGlow }) => (
              <JobCard key={job.id} job={job} status={status}
                x={x} y={y} width={cardW} height={cardH}
                pulse={pulse} newGlow={newGlow} />
            ))}
          </div>

          <div style={{
            position: 'absolute',
            left: 36, bottom: 30,
            opacity: capOp,
          }}>
            <div style={{
              fontFamily: FONT, fontSize: 12.5, color: C.accent,
              textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 700,
              marginBottom: 6,
            }}>02 {'\u2014'} Production</div>
            <div style={{
              fontFamily: FONT, fontSize: 26, fontWeight: 600,
              color: C.text1, letterSpacing: '-0.02em',
            }}>Every job, every status {'\u2014'} one screen.</div>
          </div>
        </div>
      </AppWindow>
    </div>
  );
}

function JobCard({ job, status, x, y, width, height, pulse = 0, newGlow = 0 }) {
  const s = STATUS[status] || STATUS.Hold;
  const pulseShadow = pulse > 0 ? `0 0 0 ${2 + pulse * 4}px ${s.bg}` : '';
  const newRing = newGlow > 0
    ? `0 0 0 ${1 + newGlow * 2}px rgba(79,70,229,${newGlow * 0.35})`
    : '';

  return (
    <div style={{
      position: 'absolute',
      left: x, top: y,
      width, height,
      background: C.surface,
      border: `1px solid ${newGlow > 0.05 ? 'rgba(79,70,229,0.5)' : C.border}`,
      borderRadius: 12,
      padding: 18,
      transition: 'left 600ms cubic-bezier(0.4,0,0.2,1), top 600ms cubic-bezier(0.4,0,0.2,1)',
      boxShadow: [
        '0 1px 2px rgba(15,23,42,0.04)',
        pulseShadow,
        newRing,
      ].filter(Boolean).join(', '),
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    }}>
      <div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 12,
        }}>
          <div style={{
            fontFamily: MONO, fontSize: 11.5, color: C.text3,
            letterSpacing: '0.04em', whiteSpace: 'nowrap',
          }}>{job.id}</div>
          <Pill status={status} size="sm" />
        </div>
        <div style={{
          fontFamily: FONT, fontSize: 18, fontWeight: 600, color: C.text1,
          letterSpacing: '-0.018em', marginBottom: 4,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{job.client}</div>
        <div style={{
          fontFamily: FONT, fontSize: 13, color: C.text2, whiteSpace: 'nowrap',
        }}>{job.qty} pcs {'\u00b7'} {job.colors}-color</div>
      </div>

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        paddingTop: 12,
        borderTop: `1px solid ${C.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 22, height: 22, borderRadius: 11,
            background: 'linear-gradient(135deg, #E2E8F0, #CBD5E1)',
            border: `1px solid ${C.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: FONT, fontSize: 10, fontWeight: 700, color: C.text2,
          }}>{assigneeFor(job.id)[0]}</span>
          <span style={{ fontFamily: FONT, fontSize: 12, color: C.text3, whiteSpace: 'nowrap' }}>
            {assigneeFor(job.id)}
          </span>
        </div>
        <div style={{
          fontFamily: MONO, fontSize: 11.5, color: C.text3,
          fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
        }}>due {job.due}</div>
      </div>
    </div>
  );
}

function assigneeFor(id) {
  return ({
    'Q-2026-014': 'Marcus L.',
    'Q-2026-009': 'Dev S.',
    'Q-2026-021': 'Joey K.',
    'Q-2026-017': 'Dev S.',
    'Q-2026-008': 'Ana P.',
    'Q-2026-011': 'Marcus L.',
    'Q-2026-013': 'Joey K.',
    'Q-2026-006': 'Ana P.',
  })[id] || '\u2014';
}

// ── SCENE 4 — QUOTE BUILDER MODAL ──────────────────────────────────────────
function SceneTicket() {
  const { localTime, duration } = useSprite();

  const flyT = clamp((localTime - 0.3) / 0.9, 0, 1);
  const flyE = Easing.easeOutCubic(flyT);

  const populateT = clamp((localTime - 1.2) / 1.6, 0, 1);

  const exitT = clamp((localTime - duration + 0.5) / 0.5, 0, 1);
  const exitOp = 1 - exitT;

  const pricingT = clamp((localTime - 2.6) / 1.5, 0, 1);

  return (
    <div style={{ position: 'absolute', inset: 0, background: C.appBg, opacity: exitOp }}>
      <div style={{ position: 'absolute', inset: 0, opacity: 0.5, filter: 'blur(8px)' }}>
        <AppWindow x={60} y={50} width={1800} height={980} title="InkTracker \u2014 Production">
          <Sidebar active="Quotes" />
        </AppWindow>
      </div>

      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(15,23,42,0.45)',
        opacity: flyE,
      }} />

      <div style={{
        position: 'absolute',
        left: '50%', top: '50%',
        width: 1380, height: 880,
        transform: `translate(-50%, -50%) translateY(${(1 - flyE) * 80}px) scale(${0.92 + 0.08 * flyE})`,
        transformOrigin: 'center',
        opacity: flyE,
        background: C.appBg,
        borderRadius: 16,
        boxShadow: '0 50px 120px rgba(15,23,42,0.4), 0 8px 24px rgba(15,23,42,0.2)',
        overflow: 'hidden',
        border: `1px solid ${C.border}`,
      }}>
        <QuoteBuilder populate={populateT} pricing={pricingT} />
      </div>

      <div style={{
        position: 'absolute',
        left: 80, bottom: 70,
        opacity: clamp((localTime - 2.0) / 0.5, 0, 1) * (1 - clamp((localTime - duration + 0.6) / 0.5, 0, 1)),
      }}>
        <div style={{
          fontFamily: FONT, fontSize: 12.5, color: '#fff',
          textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 700,
          marginBottom: 6,
          textShadow: '0 2px 8px rgba(0,0,0,0.5)',
        }}>03 {'\u2014'} Quote Builder</div>
        <div style={{
          fontFamily: FONT, fontSize: 28, fontWeight: 600,
          color: '#fff', letterSpacing: '-0.02em',
          maxWidth: 460, lineHeight: 1.2,
          textShadow: '0 2px 12px rgba(0,0,0,0.6)',
        }}>Live pricing, mockups, and tickets {'\u2014'} auto-built.</div>
      </div>
    </div>
  );
}

function QuoteBuilder({ populate, pricing }) {
  const seg = (i) => clamp(populate * 4 - i, 0, 1);

  const linePrice = Math.round(interpolate([0, 1], [0, 3772.50])(pricing));
  const garmentTotal = (1407.45 * pricing).toFixed(2);
  const printTotal = (945.00 * pricing).toFixed(2);
  const overrideAvg = (15.69).toFixed(2);
  const finalLine = '$3,772.50';

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding: '22px 36px',
        background: C.surface,
        borderBottom: `1px solid ${C.border}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{
            fontFamily: MONO, fontSize: 12, color: C.text3,
            letterSpacing: '0.06em', marginBottom: 4,
          }}>Q-2026-014</div>
          <div style={{
            fontFamily: FONT, fontSize: 26, fontWeight: 700,
            color: C.text1, letterSpacing: '-0.025em',
          }}>Quote Builder</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            padding: '8px 14px',
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            fontFamily: FONT, fontSize: 13, color: C.text2,
            display: 'flex', alignItems: 'center', gap: 8,
            whiteSpace: 'nowrap',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: '#94A3B8' }} />
            Draft
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.text3} strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: C.text3,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M6 18L18 6"/></svg>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 380px', minHeight: 0 }}>
        <div style={{ padding: '24px 32px', overflow: 'hidden' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 14,
          }}>
            <div style={{
              fontFamily: FONT, fontSize: 12, color: C.text3,
              textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700,
            }}>Line items</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{
                padding: '7px 12px',
                background: C.surface,
                border: `1px solid #34D399`,
                color: '#047857',
                borderRadius: 8,
                fontFamily: FONT, fontSize: 12.5, fontWeight: 500,
                whiteSpace: 'nowrap',
              }}>{'\uD83D\uDCCB'} Paste Order</div>
              <div style={{
                padding: '7px 12px',
                background: C.surface,
                border: `1px solid ${C.accent}`,
                color: C.accentText,
                borderRadius: 8,
                fontFamily: FONT, fontSize: 12.5, fontWeight: 500,
                whiteSpace: 'nowrap',
              }}>+ Add Garment Group</div>
            </div>
          </div>

          <div style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: 22,
            opacity: seg(0),
          }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '110px 1fr 1fr 1fr 110px',
              gap: 16, marginBottom: 18,
            }}>
              <FieldLabel k="Style #" v="5001" />
              <FieldLabel k="Category" v="T-Shirts" select />
              <FieldLabel k="Brand" v="AS Colour" />
              <FieldLabel k="Garment Color" v="Black" select />
              <FieldLabel k="Garment Cost" v="$6.71" prefix="$" />
            </div>

            <div style={{
              padding: '12px 14px',
              background: C.accentSofter,
              border: `1px solid #DDD6FE`,
              borderRadius: 8,
              marginBottom: 16,
              opacity: seg(0.4),
            }}>
              <div style={{
                fontFamily: FONT, fontSize: 11, color: C.accentText, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3,
              }}>Display Header Preview</div>
              <div style={{
                fontFamily: FONT, fontSize: 16, fontWeight: 700, color: C.text1,
                letterSpacing: '-0.01em', marginBottom: 2,
              }}>5001 {'\u2014'} Unisex Staple Tee</div>
              <div style={{ fontFamily: FONT, fontSize: 12.5, color: C.text2 }}>
                Brand: AS Colour {'\u00b7'} Color: Black
              </div>
            </div>

            <div style={{ opacity: seg(0.8) }}>
              <div style={{
                fontFamily: FONT, fontSize: 11, color: C.text3, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10,
              }}>Size Breakdown</div>
              <SizeRow label="Size" values={['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', 'Total']} head />
              <SizeRow label="Qty" values={['\u2014', '20', '60', '90', '60', '15', '5', '250']} progress={populate} />
            </div>

            <div style={{ opacity: seg(1.5), marginTop: 18 }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: 10,
              }}>
                <div style={{
                  fontFamily: FONT, fontSize: 11, color: C.text3, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.1em',
                }}>Print Locations</div>
                <span style={{
                  fontFamily: FONT, fontSize: 12, color: C.accentText, fontWeight: 600,
                }}>+ Add Location</span>
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: '180px 1fr 100px',
                gap: 14,
                padding: '12px 14px',
                background: C.surface2,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
              }}>
                <div>
                  <Mini label="Title" v="Stamp Logo" />
                </div>
                <div style={{ display: 'flex', gap: 14 }}>
                  <Mini label="Location" v="Front" />
                  <Mini label="Colors" v="2" />
                  <Mini label="Pantone(s)" v="PMS 286 + WHT" />
                </div>
                <Mini label="Technique" v="Screen Print" />
              </div>
            </div>
          </div>
        </div>

        <div style={{
          padding: '24px 28px',
          background: C.surface2,
          borderLeft: `1px solid ${C.border}`,
          display: 'flex', flexDirection: 'column', gap: 14,
          opacity: seg(0.3),
        }}>
          <div style={{
            background: '#0F172A',
            borderRadius: 14,
            padding: '18px 18px',
            color: '#fff',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 16,
            }}>
              <span style={{
                fontFamily: FONT, fontSize: 11, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.12em',
                color: 'rgba(255,255,255,0.55)',
              }}>Live Pricing</span>
              <span style={{
                background: C.accent,
                padding: '3px 10px', borderRadius: 999,
                fontFamily: FONT, fontSize: 11.5, fontWeight: 700,
                whiteSpace: 'nowrap',
              }}>250 pcs</span>
            </div>

            <PriceRow
              label="1st Print \u2014 Front (2c)"
              sub="Tier: 100+ from 250 pcs"
              value={`$${printTotal}`}
              right="$3.78/pc"
            />
            <PriceRow
              label="Garments"
              sub="$5.63/pc avg"
              value={`$${garmentTotal}`}
              divider
            />
          </div>

          <div style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: '14px 16px',
          }}>
            <div style={{
              fontFamily: FONT, fontSize: 11, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.1em',
              color: C.text3, marginBottom: 8,
            }}>Override Price Per Piece</div>
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 6,
            }}>
              <span style={{ fontFamily: FONT, fontSize: 18, color: C.text2 }}>$</span>
              <span style={{
                fontFamily: FONT, fontSize: 22, fontWeight: 700,
                color: C.text1, fontVariantNumeric: 'tabular-nums',
              }}>{overrideAvg}</span>
              <span style={{ fontFamily: FONT, fontSize: 13, color: C.text3 }}>/pc</span>
              <span style={{ fontFamily: FONT, fontSize: 12, color: C.text3, marginLeft: 'auto' }}>(suggested)</span>
            </div>
          </div>

          <div style={{
            background: C.accent,
            borderRadius: 14,
            padding: '20px 22px',
            color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            boxShadow: '0 12px 28px rgba(79,70,229,0.35)',
          }}>
            <div>
              <div style={{
                fontFamily: FONT, fontSize: 11, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.12em',
                opacity: 0.85, marginBottom: 4,
              }}>Line Total</div>
              <div style={{
                fontFamily: FONT, fontSize: 12, opacity: 0.7,
                whiteSpace: 'nowrap',
              }}>${overrideAvg}/pc avg</div>
            </div>
            <div style={{
              fontFamily: FONT, fontSize: 32, fontWeight: 800,
              letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}>
              {pricing > 0.95 ? finalLine : `$${linePrice.toLocaleString()}.${Math.floor((linePrice * 100) % 100).toString().padStart(2,'0')}`}
            </div>
          </div>

          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
          }}>
            <ActionTile icon="paint" label="Generate mockup" />
            <ActionTile icon="doc" label="Press ticket" />
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldLabel({ k, v, select, prefix }) {
  return (
    <div>
      <div style={{
        fontFamily: FONT, fontSize: 10.5, color: C.text3, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5,
      }}>{k}</div>
      <div style={{
        padding: '8px 12px',
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 7,
        fontFamily: FONT, fontSize: 13.5, fontWeight: 500, color: C.text1,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        whiteSpace: 'nowrap', overflow: 'hidden',
      }}>
        <span>{prefix && <span style={{ color: C.text3, marginRight: 4 }}>{prefix}</span>}{v.replace(/^\$/, '')}</span>
        {select && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.text3} strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>}
      </div>
    </div>
  );
}

function SizeRow({ label, values, head, progress = 1 }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '60px repeat(8, 1fr)',
      gap: 8, padding: '6px 0',
    }}>
      <div style={{
        fontFamily: FONT, fontSize: 12,
        color: head ? C.text3 : C.text2,
        fontWeight: head ? 600 : 500,
        display: 'flex', alignItems: 'center',
      }}>{label}</div>
      {values.map((v, i) => {
        const isTotal = i === values.length - 1;
        return (
          <div key={i} style={{
            padding: '7px 10px',
            background: head ? 'transparent' : (isTotal ? C.accentSoft : C.surface),
            border: head ? 'none' : `1px solid ${isTotal ? '#C7D2FE' : C.border}`,
            borderRadius: 6,
            textAlign: 'center',
            fontFamily: head ? FONT : MONO,
            fontSize: head ? 12 : 13,
            fontWeight: head ? 600 : (isTotal ? 700 : 500),
            color: head ? C.text3 : (isTotal ? C.accent : C.text1),
            whiteSpace: 'nowrap',
          }}>{v}</div>
        );
      })}
    </div>
  );
}

const Mini = ({ label, v }) => (
  <div>
    <div style={{
      fontFamily: FONT, fontSize: 10, color: C.text3, fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3,
    }}>{label}</div>
    <div style={{
      fontFamily: FONT, fontSize: 13, fontWeight: 500, color: C.text1,
      whiteSpace: 'nowrap',
    }}>{v}</div>
  </div>
);

function PriceRow({ label, sub, value, right, divider }) {
  return (
    <div style={{
      paddingTop: 0, paddingBottom: 12,
      borderBottom: divider ? '1px solid rgba(255,255,255,0.08)' : 'none',
      marginBottom: divider ? 0 : 0,
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      gap: 12,
    }}>
      <div>
        <div style={{ fontFamily: FONT, fontSize: 13.5, fontWeight: 600, marginBottom: 3, whiteSpace: 'nowrap' }}>{label}</div>
        <div style={{ fontFamily: FONT, fontSize: 11.5, color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap' }}>{sub}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{
          fontFamily: FONT, fontSize: 16, fontWeight: 700,
          fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
        }}>{value}</div>
        {right && <div style={{ fontFamily: FONT, fontSize: 11, color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}>{right}</div>}
      </div>
    </div>
  );
}

function ActionTile({ icon, label }) {
  return (
    <div style={{
      padding: '11px 14px',
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      display: 'flex', alignItems: 'center', gap: 10,
      fontFamily: FONT, fontSize: 13, fontWeight: 500,
      color: C.text1, whiteSpace: 'nowrap',
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 7,
        background: C.accentSoft,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <NavIcon kind={icon} active={false} />
      </div>
      {label}
    </div>
  );
}

// ── SCENE 5 — LOCKUP ────────────────────────────────────────────────────────
function SceneLockup() {
  const { localTime } = useSprite();
  const { onSignup } = useContext(DemoBannerContext);

  const logoT = clamp(localTime / 0.7, 0, 1);
  const logoE = Easing.easeOutCubic(logoT);
  const tagT = clamp((localTime - 0.5) / 0.5, 0, 1);
  const btnT = clamp((localTime - 0.95) / 0.45, 0, 1);
  const footT = clamp((localTime - 1.35) / 0.4, 0, 1);
  const pulse = 0.5 + 0.5 * Math.sin((localTime - 1.0) * 1.8);

  const handleFeatures = useCallback(() => {
    const el = document.getElementById('features');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  }, []);

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: C.darkBg,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <BgGrid dark intense />

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

      <div style={{
        opacity: clamp((localTime - 1.55) / 0.4, 0, 1),
        marginBottom: 24,
        padding: '7px 14px',
        background: 'rgba(34,197,94,0.10)',
        border: '1px solid rgba(34,197,94,0.25)',
        borderRadius: 999,
        display: 'flex', alignItems: 'center', gap: 8,
        fontFamily: FONT, fontSize: 13.5, fontWeight: 500, color: '#86EFAC',
        whiteSpace: 'nowrap',
      }}>
        <span style={{ width: 7, height: 7, borderRadius: 4, background: '#22C55E' }} />
        14-day free trial {'\u00b7'} No credit card required
      </div>

      <div style={{
        opacity: logoE,
        transform: `scale(${0.85 + 0.15 * logoE})`,
        display: 'flex', alignItems: 'center', gap: 18,
        marginBottom: 28,
        position: 'relative',
      }}>
        <FlameMark size={88} animate time={localTime} ripple />
        <span style={{
          fontFamily: FONT, fontSize: 80, fontWeight: 700,
          color: C.darkText1, letterSpacing: '-0.04em',
        }}>InkTracker</span>
      </div>

      <div style={{
        opacity: tagT,
        transform: `translateY(${(1 - tagT) * 8}px)`,
        fontFamily: FONT, fontSize: 36, fontWeight: 500,
        letterSpacing: '-0.02em',
        marginBottom: 44,
        textAlign: 'center',
        lineHeight: 1.2,
      }}>
        <div style={{ color: C.darkText2, whiteSpace: 'nowrap' }}>Run your print shop</div>
        <div style={{ color: '#A5B4FC', whiteSpace: 'nowrap' }}>without the chaos.</div>
      </div>

      <div style={{
        opacity: btnT,
        transform: `translateY(${(1 - btnT) * 10}px) scale(${0.96 + 0.04 * btnT})`,
        display: 'flex', alignItems: 'center', gap: 16,
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute',
          left: -8, top: -8, right: 'calc(50% + 16px)', bottom: -8,
          borderRadius: 14,
          background: C.accent,
          opacity: btnT > 0.9 ? 0.18 + pulse * 0.08 : 0,
          filter: 'blur(10px)',
        }} />
        <button
          onClick={onSignup || undefined}
          style={{
            position: 'relative',
            padding: '17px 30px',
            background: C.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            fontFamily: FONT, fontSize: 17, fontWeight: 700,
            letterSpacing: '-0.005em',
            display: 'flex', alignItems: 'center', gap: 10,
            cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(79,70,229,0.45), inset 0 1px 0 rgba(255,255,255,0.18)',
            whiteSpace: 'nowrap',
          }}
        >
          Start Free Trial
        </button>
        <button
          onClick={handleFeatures}
          style={{
            padding: '17px 26px',
            background: 'transparent',
            color: C.darkText1,
            border: 'none',
            fontFamily: FONT, fontSize: 17, fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          See Features {'\u2192'}
        </button>
      </div>

      <div style={{
        opacity: footT,
        marginTop: 40,
        fontFamily: FONT, fontSize: 13,
        color: C.darkText3,
        letterSpacing: '0.01em',
        whiteSpace: 'nowrap',
      }}>
        $99/mo after trial {'\u00b7'} Cancel anytime
      </div>
    </div>
  );
}

// ── Background grid ─────────────────────────────────────────────────────────
function BgGrid({ dark = false, intense = false }) {
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

// ── Scene indicator ─────────────────────────────────────────────────────────
function SceneIndicator() {
  const time = useTime();
  let label = '';
  if (time < 3) label = '';
  else if (time < 9) label = '01';
  else if (time < 15) label = '02';
  else if (time < 21) label = '03';
  else label = '';
  if (!label) return null;

  const isLight = time >= 3 && time < 21;
  return (
    <div style={{
      position: 'absolute',
      top: 32, right: 44,
      fontFamily: MONO, fontSize: 11.5,
      color: isLight ? C.text3 : C.darkText3,
      letterSpacing: '0.18em',
      textTransform: 'uppercase',
      pointerEvents: 'none',
      zIndex: 100,
    }}>
      {label} / 03
    </div>
  );
}

// ── DemoBanner (default export) ─────────────────────────────────────────────
export default function DemoBanner({ onSignup }) {
  return (
    <DemoBannerContext.Provider value={{ onSignup }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      <Stage width={1920} height={1080} duration={25} background="#0B0B0E">
        {/* Pure-zoom Ken Burns — no translate so UI content never clips. */}
        <Sprite start={0} end={3.0}>
          <KenBurns
            from={{ scale: 1.00, x: 0, y: 0 }}
            to={{   scale: 1.05, x: 0, y: 0 }}
          ><SceneHook /></KenBurns>
        </Sprite>
        <Sprite start={3.0} end={9.0}>
          <KenBurns
            from={{ scale: 1.05, x: 0, y: 0 }}
            to={{   scale: 1.00, x: 0, y: 0 }}
          ><SceneIntake /></KenBurns>
        </Sprite>
        <Sprite start={9.0} end={15.0}>
          <KenBurns
            from={{ scale: 1.00, x: 0, y: 0 }}
            to={{   scale: 1.05, x: 0, y: 0 }}
          ><SceneDashboard /></KenBurns>
        </Sprite>
        <Sprite start={15.0} end={21.0}>
          <KenBurns
            from={{ scale: 1.05, x: 0, y: 0 }}
            to={{   scale: 1.00, x: 0, y: 0 }}
          ><SceneTicket /></KenBurns>
        </Sprite>
        <Sprite start={21.0} end={25.0}>
          <KenBurns
            from={{ scale: 1.04, x: 0, y: 0 }}
            to={{   scale: 1.00, x: 0, y: 0 }}
          ><SceneLockup /></KenBurns>
        </Sprite>
        <SceneIndicator />
      </Stage>
    </DemoBannerContext.Provider>
  );
}
