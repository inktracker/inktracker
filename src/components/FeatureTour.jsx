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

// Returns the union bounding rect of the visible children of the target
// element, or null if there's nothing visible. We compute children (rather
// than wrapper) because data-tour wrappers like the Getting Started
// Checklist can be empty divs when the inner component has been dismissed,
// and CSS-grid wrappers like Metric Cards extend past the visible cards.
function getElementRect(selector) {
  if (!selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const children = Array.from(el.children).filter((c) => {
    const r = c.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  if (children.length === 0) {
    // No visible children — try the element itself; if that's also empty
    // return null so the tour can auto-skip the step.
    const own = el.getBoundingClientRect();
    if (own.width <= 0 || own.height <= 0) return null;
    return own;
  }
  let top = Infinity, left = Infinity, right = -Infinity, bottom = -Infinity;
  for (const c of children) {
    const r = c.getBoundingClientRect();
    if (r.top    < top)    top    = r.top;
    if (r.left   < left)   left   = r.left;
    if (r.right  > right)  right  = r.right;
    if (r.bottom > bottom) bottom = r.bottom;
  }
  return { top, left, right, bottom, width: right - left, height: bottom - top };
}

const TOOLTIP_W = 360;
const TOOLTIP_H = 200;
const SPOTLIGHT_INSET = 2;
// Gap between the spotlight ring and the popover body. Small but non-zero
// so the popover doesn't look glued on top of the ring border.
const GAP = 6;

function getTooltipStyle(rect, position) {
  if (!rect || position === "center") {
    return {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
    };
  }

  const edgePad = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const style = { position: "fixed" };
  const clampX = (raw) => Math.max(edgePad, Math.min(vw - TOOLTIP_W - edgePad, raw));
  const clampY = (raw) => Math.max(edgePad, Math.min(vh - TOOLTIP_H - edgePad, raw));

  if (position === "bottom") {
    const below = rect.bottom + GAP;
    const above = rect.top - GAP - TOOLTIP_H;
    if (below + TOOLTIP_H + edgePad < vh) {
      style.top = below;
    } else if (above > edgePad) {
      style.top = above;
    } else {
      style.top = clampY(rect.top + GAP);
    }
    // Anchor to the target's LEFT edge instead of centering. A wide target
    // (full-width metric strip, pipeline strip) is highlighted from end to
    // end, but a center-anchored popover left it floating in the middle of
    // the strip with nothing visually tying it to either edge. Left-anchor
    // is the simpler, more readable mental model: the popover hangs from
    // the left corner of the highlight.
    style.left = clampX(rect.left);
  } else if (position === "right") {
    style.top = clampY(rect.top);
    style.left = Math.min(vw - TOOLTIP_W - edgePad, rect.right + GAP);
  } else if (position === "top") {
    const above = rect.top - GAP - TOOLTIP_H;
    if (above > edgePad) {
      style.top = above;
    } else {
      style.top = clampY(rect.bottom + GAP);
    }
    style.left = clampX(rect.left);
  }

  return style;
}

export default function FeatureTour() {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);

  useEffect(() => {
    // `?tour=replay` query param forces the tour to run again even after
    // someone's already dismissed it.
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

  // Auto-skip steps whose target isn't visible. Common case: the
  // GettingStartedChecklist component returns null when the user has
  // dismissed it via the X button, leaving `data-tour="checklist"` as
  // an empty wrapper. The tour used to highlight nothing and the
  // popover floated in empty space — now we just advance past the step.
  useEffect(() => {
    if (!active) return;
    const current = TOUR_STEPS[step];
    if (current?.selector && rect == null) {
      const nextStep = step + 1;
      // If we'd run off the end, finish the tour.
      if (nextStep >= TOUR_STEPS.length) {
        localStorage.setItem("inktracker-tour-seen", "1");
        setActive(false);
      } else {
        setStep(nextStep);
      }
    }
  }, [active, step, rect]);

  if (!active) return null;

  const current = TOUR_STEPS[step];
  const isFirst = step === 0;
  const isLast = step === TOUR_STEPS.length - 1;
  const tooltipStyle = getTooltipStyle(rect, current.position);

  function next() {
    if (isLast) finish();
    else setStep(s => s + 1);
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
      {/* Click-to-dismiss layer. Transparent when a target is spotlit
          (the box-shadow on the spotlight div does the dimming). Flat
          dim when there's no target (center-position steps). */}
      <div
        className={`absolute inset-0 ${rect ? "" : "bg-slate-900/60"}`}
        onClick={finish}
      />

      {/* Spotlight ring on the target. The box-shadow darkens everything
          OUTSIDE the rect; inside stays at full page brightness. */}
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

      {/* Tooltip card. No caret — the spotlight ring alone signals what
          the popover refers to. Caret was adding visual noise that read
          as floating/disconnected when the target was wide. */}
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
