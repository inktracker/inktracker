import { useEffect } from "react";

// Elements that can receive focus, for the Tab focus-trap.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Accessible-dialog behavior for a hand-rolled modal (FE-01). On open, focus
// moves into the panel; on close it restores to whatever was focused before.
// Tab / Shift+Tab are trapped within the panel, and Escape closes (gated by
// `canDismiss` so modals protecting unsaved/in-flight state can opt out).
//
// Usage: pass a ref to the dialog PANEL element, spread the returned `onKeyDown`
// on the modal's root (overlay) element, and add role="dialog" aria-modal="true"
// plus an accessible name (aria-label / aria-labelledby) to the panel.
//
// `active` supports modals that stay mounted and toggle visibility (pass
// `active: isOpen`) as well as those that mount/unmount (leave it true). When it
// flips true→false the focus restore runs; false→true moves focus back in.
export function useModalA11y(panelRef, { onClose, canDismiss = true, active = true } = {}) {
  useEffect(() => {
    if (!active) return undefined;
    const previouslyFocused = document.activeElement;
    const panel = panelRef.current;
    const focusables = panel ? panel.querySelectorAll(FOCUSABLE_SELECTOR) : [];
    if (focusables.length) focusables[0].focus();
    else if (panel) panel.focus();
    return () => {
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [panelRef, active]);

  function onKeyDown(e) {
    if (e.key === "Escape") {
      if (canDismiss && onClose) {
        e.stopPropagation();
        onClose();
      }
      return;
    }
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = panel.querySelectorAll(FOCUSABLE_SELECTOR);
    if (!focusables.length) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !panel.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return { onKeyDown };
}
