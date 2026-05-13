import { useState, useEffect, useCallback } from "react";
import { X, ChevronRight, ChevronLeft } from "lucide-react";

const TOUR_STEPS = [
  {
    title: "Welcome to InkTracker",
    description: "Let's take a quick look at the key features of your shop dashboard. This will only take a minute.",
    position: "center",
  },
  {
    title: "Metric Cards",
    description: "These cards show your shop's key numbers at a glance — pending quotes, open orders, unpaid invoices, and low stock alerts. Click any card to jump to that page.",
    selector: "[data-tour='metrics']",
    position: "bottom",
  },
  {
    title: "Getting Started Checklist",
    description: "Track your setup progress here. Complete each step to get your shop fully configured. You can dismiss it once you're done.",
    selector: "[data-tour='checklist']",
    position: "bottom",
  },
  {
    title: "Order Pipeline",
    description: "Your orders flow through these stages from left to right — Art Approval through to Completed. Click any stage to see its orders.",
    selector: "[data-tour='pipeline']",
    position: "bottom",
  },
  {
    title: "Sidebar Navigation",
    description: "Use the sidebar to access all features — Quotes, Production, Customers, Inventory, Invoices, and more. Locked features require a plan upgrade.",
    selector: "[data-tour='sidebar']",
    position: "right",
  },
  {
    title: "You're all set!",
    description: "Start by adding a customer, then create your first quote. If you need help, check the tooltip hints (?) throughout the app.",
    position: "center",
  },
];

function getElementRect(selector) {
  if (!selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  return el.getBoundingClientRect();
}

// Approximate tooltip footprint — used for viewport-collision math. The
// actual rendered card varies slightly with description length, but 360x200
// is a safe-ish upper bound and erring on the larger side just keeps the
// tooltip away from edges.
const TOOLTIP_W = 360;
const TOOLTIP_H = 200;

// Pixels the spotlight ring extends past the target rect on every side.
// Kept small so the ring hugs the actual highlighted element instead of
// floating in space below/around it. Two referenced spots: the spotlight
// div's geometry (top/left/width/height) and the caret-on-ring math.
const SPOTLIGHT_INSET = 2;

function getTooltipStyle(rect, position) {
  if (!rect || position === "center") {
    return {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
    };
  }

  // Tight gap between the target rect and the popover body. The previous
  // pass used 14 to land the caret tip on the (then 6px-inset) spotlight
  // ring, but in practice the target rects sat noticeably below the
  // visible card edges, so the popover ended up floating below the
  // highlight. Pulling both inward: the spotlight inset is now 2px (see
  // SPOTLIGHT_INSET below) and the gap is 4 — the popover effectively
  // attaches to the spotlight ring with no visible vertical drift.
  const gap = 4;
  // Larger padding for viewport-edge clamping so popovers don't kiss
  // the screen edge.
  const edgePad = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const style = { position: "fixed" };

  // Horizontal/vertical placement clamped to the viewport for any anchor.
  const clampX = (raw) => Math.max(edgePad, Math.min(vw - TOOLTIP_W - edgePad, raw));
  const clampY = (raw) => Math.max(edgePad, Math.min(vh - TOOLTIP_H - edgePad, raw));

  if (position === "bottom") {
    // Try below the target. If that overflows, try above. If both would
    // overflow (tall targets like the Getting Started checklist, which
    // pushed the tooltip past the bottom of the viewport in the original
    // implementation), anchor right under the visible top of the target.
    const below = rect.bottom + gap;
    const above = rect.top - gap - TOOLTIP_H;
    if (below + TOOLTIP_H + edgePad < vh) {
      style.top = below;
    } else if (above > edgePad) {
      style.top = above;
    } else {
      style.top = clampY(rect.top + gap);
    }
    style.left = clampX(rect.left + rect.width / 2 - TOOLTIP_W / 2);
  } else if (position === "right") {
    style.top = clampY(rect.top);
    style.left = Math.min(vw - TOOLTIP_W - edgePad, rect.right + gap);
  } else if (position === "top") {
    const above = rect.top - gap - TOOLTIP_H;
    if (above > edgePad) {
      style.top = above;
    } else {
      // Flip to below if there's no room above.
      style.top = clampY(rect.bottom + gap);
    }
    style.left = clampX(rect.left + rect.width / 2 - TOOLTIP_W / 2);
  }

  return style;
}

export default function FeatureTour() {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);

  useEffect(() => {
    // `?tour=replay` query param forces the tour to run again even after
    // someone's already dismissed it. Strip the param from the URL after
    // reading it so a reload doesn't re-trigger forever.
    const params = new URLSearchParams(window.location.search);
    if (params.get("tour") === "replay") {
      localStorage.removeItem("inktracker-tour-seen");
      params.delete("tour");
      const cleaned = params.toString();
      const newUrl = window.location.pathname + (cleaned ? `?${cleaned}` : "") + window.location.hash;
      window.history.replaceState(null, "", newUrl);
    }

    const seen = localStorage.getItem("inktracker-tour-seen");
    if (!seen) {
      // Small delay to let the Dashboard render first
      const timer = setTimeout(() => setActive(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const updateRect = useCallback(() => {
    const current = TOUR_STEPS[step];
    if (current?.selector) {
      setRect(getElementRect(current.selector));
    } else {
      setRect(null);
    }
  }, [step]);

  useEffect(() => {
    if (!active) return;
    updateRect();
    window.addEventListener("resize", updateRect);
    return () => window.removeEventListener("resize", updateRect);
  }, [active, step, updateRect]);

  if (!active) return null;

  const current = TOUR_STEPS[step];
  const isFirst = step === 0;
  const isLast = step === TOUR_STEPS.length - 1;
  const tooltipStyle = getTooltipStyle(rect, current.position);

  // Decide where to render the caret: on the side of the tooltip closest
  // to the target. Returns null when there's no anchored target (center
  // steps) or when the tooltip overlaps the target (no visual gap to
  // bridge with a caret).
  function getCaret() {
    if (!rect || current.position === "center") return null;
    const top = tooltipStyle.top;
    const left = tooltipStyle.left;
    if (typeof top !== "number" || typeof left !== "number") return null;
    const targetCenterX = rect.left + rect.width / 2;
    const targetCenterY = rect.top + rect.height / 2;
    // Pad the caret away from the rounded corners.
    const clamp = (v, hi) => Math.max(20, Math.min(hi - 28, v));
    if (top >= rect.bottom) {
      return { side: "top", offset: clamp(targetCenterX - left, TOOLTIP_W) };
    }
    if (top + TOOLTIP_H <= rect.top) {
      return { side: "bottom", offset: clamp(targetCenterX - left, TOOLTIP_W) };
    }
    if (left >= rect.right) {
      return { side: "left", offset: clamp(targetCenterY - top, TOOLTIP_H) };
    }
    return null;
  }
  const caret = getCaret();

  function next() {
    if (isLast) {
      finish();
    } else {
      setStep(s => s + 1);
    }
  }

  function prev() {
    if (!isFirst) setStep(s => s - 1);
  }

  function finish() {
    localStorage.setItem("inktracker-tour-seen", "1");
    setActive(false);
  }

  // Caret positioning helpers (used in the JSX below). The caret is a
  // small white square rotated 45° so it reads as a triangle peeking out
  // of the tooltip card, color-matched to the card body.
  const caretStyles = {
    top:    { top: -6, bottom: "auto", left: caret?.offset, right: "auto",
              borderRight: "none", borderBottom: "none" },
    bottom: { top: "auto", bottom: -6, left: caret?.offset, right: "auto",
              borderLeft: "none", borderTop: "none" },
    left:   { top: caret?.offset, bottom: "auto", left: -6, right: "auto",
              borderRight: "none", borderTop: "none" },
  };

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Click-to-dismiss layer. When a target is highlighted we leave this
          transparent — the spotlight box-shadow does all the darkening, so
          INSIDE the spotlight stays at full page brightness while OUTSIDE
          is dimmed (0.7). For center-position steps (no target) we fall
          back to a flat dim across the whole viewport. */}
      <div
        className={`absolute inset-0 ${rect ? "" : "bg-slate-900/60"}`}
        onClick={finish}
      />

      {/* Spotlight on target element */}
      {rect && (
        <div
          className="absolute border-2 border-indigo-400 rounded-xl pointer-events-none"
          style={{
            top: rect.top - SPOTLIGHT_INSET,
            left: rect.left - SPOTLIGHT_INSET,
            width: rect.width + SPOTLIGHT_INSET * 2,
            height: rect.height + SPOTLIGHT_INSET * 2,
            boxShadow: "0 0 0 9999px rgba(15,23,42,0.7)",
            zIndex: 61,
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        className="w-[360px] max-w-[calc(100vw-32px)] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-visible"
        style={{ ...tooltipStyle, zIndex: 62 }}
      >
        {/* Caret pointing at the target. White square rotated 45°,
            color-matched to the tooltip body, with only the outer two
            borders showing so it tucks cleanly into the card edge. */}
        {caret && (
          <div
            className="absolute w-3 h-3 bg-white border border-slate-200 rotate-45"
            style={caretStyles[caret.side]}
          />
        )}
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-start justify-between mb-2">
            <h3 className="text-base font-bold text-slate-800">{current.title}</h3>
            <button onClick={finish} className="p-1 text-slate-300 hover:text-slate-500 transition -mt-1 -mr-1">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-sm text-slate-500 leading-relaxed">{current.description}</p>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50">
          <div className="flex gap-1">
            {TOUR_STEPS.map((_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition ${i === step ? "bg-indigo-600" : "bg-slate-200"}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                onClick={prev}
                className="flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-600 transition px-2 py-1.5"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Back
              </button>
            )}
            <button
              onClick={next}
              className="flex items-center gap-1 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-1.5 rounded-lg transition"
            >
              {isLast ? "Get Started" : "Next"} {!isLast && <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
