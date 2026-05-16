// Shared modal backdrop. Two bugs it solves consistently:
//
//   1. Top-strip artifact. A naïve `fixed inset-0` div gets clipped
//      by any ancestor that establishes a containment block (CSS
//      transform / filter / perspective / contain). The user sees a
//      faint horizontal line across the top of the backdrop where
//      the fixed positioning fell back to the parent's reference
//      frame. Fix: render via createPortal to document.body so no
//      ancestor matters, plus an inline width:100vw/height:100vh
//      belt-and-suspenders.
//
//   2. Tall modals get clipped without a scrollbar. Some modals
//      (SendQuoteModal, OrderDetailModal) exceed viewport height
//      on shorter screens. Fix: backdrop is overflow-y-auto, and a
//      default-styled inner panel is max-h-[90vh] overflow-y-auto.
//
// Usage:
//
//   import ModalBackdrop from "@/components/shared/ModalBackdrop";
//
//   // Standard centered modal:
//   <ModalBackdrop onClose={onClose}>
//     <div className="bg-white rounded-2xl ...">{children}</div>
//   </ModalBackdrop>
//
//   // Right-aligned slide-out side panel:
//   <ModalBackdrop onClose={onClose} layout="slide-right">
//     <div className="bg-white w-full max-w-lg h-full ...">{children}</div>
//   </ModalBackdrop>
//
//   // Custom backdrop color (e.g. landing-page preview with bg-black/80):
//   <ModalBackdrop onClose={onClose} bg="bg-black/80">{children}</ModalBackdrop>
//
// The inner panel is whatever children you pass — ModalBackdrop
// applies a click handler that stops propagation so clicking inside
// the panel doesn't dismiss the modal. Clicking the backdrop fires
// `onClose`. Pass `dismissOnBackdropClick={false}` to opt out (e.g.
// editor modals that hold unsaved form state).

import { createPortal } from "react-dom";

const LAYOUT_CLASSES = {
  centered:    "items-center  justify-center",
  "slide-right": "items-stretch justify-end",
  "slide-left":  "items-stretch justify-start",
};

export default function ModalBackdrop({
  onClose,
  children,
  z = "z-[200]",
  className = "",
  bg = "bg-slate-900/60",
  layout = "centered",
  dismissOnBackdropClick = true,
}) {
  function handleBackdropClick() {
    if (dismissOnBackdropClick && onClose) onClose();
  }

  // Slide-outs take a full-height bg-white panel; the inner wrapper
  // shouldn't constrain layout. Centered modals get the
  // `w-full flex justify-center` wrapper that keeps the panel
  // centered even when child has its own width caps.
  const isSlide = layout === "slide-right" || layout === "slide-left";
  const innerWrapperClass = isSlide ? "" : "w-full flex justify-center";
  const layoutClass = LAYOUT_CLASSES[layout] ?? LAYOUT_CLASSES.centered;

  return createPortal(
    <div
      className={`fixed ${bg} backdrop-blur-sm flex ${layoutClass} ${isSlide ? "" : "p-4 overflow-y-auto"} ${z} ${className}`}
      style={{ top: 0, left: 0, right: 0, bottom: 0, width: "100vw", height: "100vh" }}
      onClick={handleBackdropClick}
    >
      <div onClick={(e) => e.stopPropagation()} className={innerWrapperClass}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
