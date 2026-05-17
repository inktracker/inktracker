import { useEffect, useRef, useState } from "react";
import { decideInputAction, formatDisplayValue } from "@/lib/pricing/numericInputState.js";

// Thin React shell around the pure decideInputAction logic.
//
// Why this exists: every numeric input in the pricing section used
// `parseFloat(value) || 0` to coerce input → number, which silently
// turned typos ("abc") and intermediate states ("") into 0. The shop
// owner had no signal something was wrong. This component:
//
//   - keeps the user's literal typing in local state (so "5." mid-edit
//     isn't yanked out from under them)
//   - only propagates a parsed number to the parent when input is
//     strictly numeric and in range
//   - on empty + clearOnEmpty:false (the default for pricing fields),
//     does NOT push 0 to the parent — the saved value is preserved
//     until the user types something valid, and onBlur snaps display
//     back to the saved value so the cell can't be silently zeroed
//   - shows a red ring on invalid input and a tooltip explaining why
//
// We use type="text" with inputmode="decimal" instead of type="number"
// to avoid browser auto-formatting (which can swallow "5." or display
// scientific notation). The numeric keyboard on mobile is preserved
// via inputmode.

export default function NumericInput({
  value,
  onChange,
  onClear,
  clearOnEmpty = false,
  min = 0,
  max = Infinity,
  integer = false,
  label = "Value",
  className = "",
  ...rest
}) {
  const ref = useRef(null);
  const [display, setDisplay] = useState(() => formatDisplayValue(value));
  const [isInvalid, setIsInvalid] = useState(false);

  // Sync display from the saved value, but never while the user is
  // actively typing in this field — yanking text mid-edit is hostile.
  useEffect(() => {
    if (document.activeElement === ref.current) return;
    setDisplay(formatDisplayValue(value));
    setIsInvalid(false);
  }, [value]);

  function handleChange(e) {
    const raw = e.target.value;
    setDisplay(raw);

    const action = decideInputAction(raw, { clearOnEmpty, label, min, max, integer });
    switch (action.kind) {
      case "save":
        setIsInvalid(false);
        onChange?.(action.value);
        return;
      case "clear":
        setIsInvalid(false);
        onClear?.();
        return;
      case "ignore":
        // Intermediate typing (empty field). Saved value untouched;
        // not flagged as invalid (it's a normal in-progress state).
        setIsInvalid(false);
        return;
      case "invalid":
        // Bad input. Display preserved so user can see what they typed
        // and fix it; saved value untouched.
        setIsInvalid(true);
        return;
    }
  }

  function handleBlur(e) {
    // If field is left empty in non-clear mode, snap display back to
    // the saved value so the user can see what's actually persisted.
    // Without this, the cell visually stays blank but the parent
    // state still holds the previous value — confusing.
    if (display === "" && !clearOnEmpty) {
      setDisplay(formatDisplayValue(value));
      setIsInvalid(false);
    }
    rest.onBlur?.(e);
  }

  const errorCls = isInvalid ? "border-red-400 ring-1 ring-red-300" : "";
  const combinedCls = [className, errorCls].filter(Boolean).join(" ");

  // Don't forward onBlur via spread — we wrap it.
  const { onBlur: _ignored, ...passThrough } = rest;

  return (
    <input
      ref={ref}
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      value={display}
      onChange={handleChange}
      onBlur={handleBlur}
      aria-invalid={isInvalid || undefined}
      title={isInvalid ? `${label} must be a valid number.` : undefined}
      className={combinedCls}
      {...passThrough}
    />
  );
}
