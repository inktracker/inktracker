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
//   return (
//     <ModalBackdrop onClose={onClose}>
//       <div className="bg-white rounded-2xl ...">
//         {modal contents}
//       </div>
//     </ModalBackdrop>
//   );
//
// The inner panel is whatever children you pass — ModalBackdrop
// applies a click handler that stops propagation so clicking inside
// the panel doesn't dismiss the modal. Clicking the backdrop fires
// `onClose`. Pass `dismissOnBackdropClick={false}` to opt out (e.g.
// "are you sure" confirmation modals that should require an explicit
// cancel button).

import { createPortal } from "react-dom";

export default function ModalBackdrop({
  onClose,
  children,
  z = "z-[200]",
  className = "",
  dismissOnBackdropClick = true,
}) {
  function handleBackdropClick() {
    if (dismissOnBackdropClick && onClose) onClose();
  }

  return createPortal(
    <div
      className={`fixed bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto ${z} ${className}`}
      style={{ top: 0, left: 0, right: 0, bottom: 0, width: "100vw", height: "100vh" }}
      onClick={handleBackdropClick}
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full flex justify-center">
        {children}
      </div>
    </div>,
    document.body,
  );
}
