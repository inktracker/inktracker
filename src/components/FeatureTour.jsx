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

function getTooltipStyle(rect, position) {
  if (!rect || position === "center") {
    return {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
    };
  }

  const padding = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const style = { position: "fixed" };

  // Horizontal placement clamped to the viewport for any anchor.
  const clampX = (raw) => Math.max(padding, Math.min(vw - TOOLTIP_W - padding, raw));
  const clampY = (raw) => Math.max(padding, Math.min(vh - TOOLTIP_H - padding, raw));

  if (position === "bottom") {
    // Try below the target. If that overflows, try above. If both would
    // overflow (tall targets like the Getting Started checklist, which
    // pushed the tooltip past the bottom of the viewport in the original
    // implementation), anchor right under the visible top of the target.
    const below = rect.bottom + padding;
    const above = rect.top - padding - TOOLTIP_H;
    if (below + TOOLTIP_H + padding < vh) {
      style.top = below;
    } else if (above > padding) {
      style.top = above;
    } else {
      style.top = clampY(rect.top + padding);
    }
    style.left = clampX(rect.left + rect.width / 2 - TOOLTIP_W / 2);
  } else if (position === "right") {
    style.top = clampY(rect.top);
    style.left = Math.min(vw - TOOLTIP_W - padding, rect.right + padding);
  } else if (position === "top") {
    const above = rect.top - padding - TOOLTIP_H;
    if (above > padding) {
      style.top = above;
    } else {
      // Flip to below if there's no room above.
      style.top = clampY(rect.bottom + padding);
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

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Backdrop — darken only, no blur. The earlier `backdrop-blur-[2px]`
          made the dashboard content underneath look smudged, which read as
          a rendering glitch rather than focus. The spotlight box-shadow
          below already creates the focal contrast. */}
      <div className="absolute inset-0 bg-slate-900/60" onClick={finish} />

      {/* Spotlight on target element */}
      {rect && (
        <div
          className="absolute border-2 border-indigo-400 rounded-xl pointer-events-none"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 9999px rgba(15,23,42,0.55)",
            zIndex: 61,
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        className="w-[360px] max-w-[calc(100vw-32px)] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        style={{ ...tooltipStyle, zIndex: 62 }}
      >
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
