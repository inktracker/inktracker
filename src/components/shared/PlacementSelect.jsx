// Placement (print-location) picker with custom entry. Normally a select
// over the preset locations plus a "Custom…" option. Choosing Custom…
// SWAPS the select for a single free-text input (so shops can name
// placements we don't list — Nape, Hem, Pocket flap…) with a small ↺ to
// return to the preset list. Only one control shows at a time so it stays
// tidy in both the mockup header and the narrow quote-editor column.
//
// The value is just a string — a preset OR whatever they typed — so
// callers store and display it identically.
import { useRef } from "react";

const CUSTOM = "__custom__";
const toOpt = (o) => (typeof o === "string" ? { value: o, label: o } : o);

export default function PlacementSelect({
  value,
  onChange,
  options,
  // `className` applies to the active control unless a more specific
  // selectClassName / inputClassName is provided.
  className = "",
  selectClassName,
  inputClassName,
  selectStyle,
  customPlaceholder = "Custom placement",
}) {
  const inputRef = useRef(null);
  const opts = (options || []).map(toOpt);
  // A value that isn't one of the presets is a custom placement.
  const isPreset = opts.some((o) => o.value === value);

  if (!isPreset) {
    return (
      <div className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={value}
          // Focus only when freshly entering custom mode (value empty) so
          // a saved custom value on page load doesn't steal focus.
          autoFocus={!value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={customPlaceholder}
          className={inputClassName ?? className}
        />
        <button
          type="button"
          onClick={() => onChange(opts[0]?.value ?? "")}
          title="Use a preset location"
          className="text-slate-400 hover:text-slate-600 text-sm leading-none px-1"
        >
          ↺
        </button>
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === CUSTOM) {
          onChange(""); // enter custom mode; input renders + focuses
        } else {
          onChange(v);
        }
      }}
      style={selectStyle}
      className={selectClassName ?? className}
    >
      {opts.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
      <option value={CUSTOM}>Custom…</option>
    </select>
  );
}
