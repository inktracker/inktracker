// ─────────────────────────────────────────────────────────────────────────
// Shared calculator primitives — the SINGLE source of the screen-print chart
// pricing math, imported by BOTH the blog widget (generate-blog.mjs) and the
// free /tools calculator (generate-tools.mjs) so their numbers can never
// drift.
//
// chartModel / chartCell are written in ES5-safe style (var/function, no
// arrows/const) on purpose: they run at BUILD TIME (Node, static-first
// render) AND are injected verbatim into the client via `.toString()`, so the
// browser executes the exact same code. Never rewrite them to use closures or
// module refs — the injected copy must stand alone.
// ─────────────────────────────────────────────────────────────────────────

export const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Quantity tiers the chart prices at (columns). Shared so Part B's quantity
// slider snaps to the same breakpoints the chart is built on.
export const QTY_TIERS = [25, 50, 100, 200];

// The screen-print chart model. S = { costs, shirts, margin, vol, color }.
//   cpp  = monthly costs ÷ prints        (what one print costs you)
//   base = cpp ÷ (1 − margin)            (cheapest cell: 1 color, smallest run)
//   tm[] = volume multipliers per qty tier (bigger runs cost less)
//   cm[] = color multipliers (each added color adds a shrinking slice)
export function chartModel(S) {
  var cpp = S.costs / S.shirts;
  // Margin → base = cost ÷ (1 − margin). A true 100% margin divides by zero
  // (price is infinite when cost is 0% of it), so floor the divisor at 0.01
  // to return a large FINITE number instead of Infinity/NaN as margin nears
  // 100%. Never fires below ~99%, so lower margins are unaffected.
  var denom = 1 - S.margin / 100;
  if (denom < 0.01) denom = 0.01;
  var base = cpp / denom;
  var vd = S.vol / 100, ac = S.color / 100;
  var tm = [1];
  for (var i = 1; i < 4; i++) tm[i] = tm[i - 1] * (1 - vd * Math.pow(0.8, i - 1));
  var cm = [1];
  for (var c = 1; c < 8; c++) cm[c] = cm[c - 1] * (1 + ac * Math.pow(0.9, c - 1));
  return { cpp: cpp, base: base, tm: tm, cm: cm };
}

// Per-print price for a color index (0–7) at a quantity-tier index (0–3).
export function chartCell(M, colorIdx, tierIdx) {
  return M.base * M.cm[colorIdx] * M.tm[tierIdx];
}

// One labelled slider row. Shared by every calculator widget.
export function sliderRow(key, label, hint, attrs, initial = "–") {
  return `<div class="calc-row">
    <div class="calc-label"><b>${esc(label)}</b><span>${esc(hint)}</span></div>
    <input type="range" class="calc-slider" data-in="${key}" ${attrs} />
    <output class="calc-val" data-val="${key}">${esc(initial)}</output>
  </div>`;
}

// Calculator-specific CSS. Assumes the brand tokens (--forest, --hair,
// --muted) are defined by the host page's :root. Shared verbatim so the blog
// widget and the /tools calculator look identical.
export const CALC_CSS = `.calc{border:1px solid var(--hair);border-radius:14px;padding:20px;margin:1.6em 0;background:#fafafa}
.calc-row{display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid var(--hair);flex-wrap:wrap}
.calc-row:last-of-type{border-bottom:0}
.calc-label{flex:1 1 210px;min-width:190px}
.calc-label b{display:block;font-size:14px}
.calc-label span{font-size:12px;color:var(--muted)}
.calc-slider{flex:2 1 170px;accent-color:var(--forest);height:22px}
.calc-val{min-width:64px;text-align:right;font-weight:700;color:var(--forest);font-variant-numeric:tabular-nums}
.calc-out{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0 6px}
.calc-stat{border:1px solid var(--hair);border-radius:10px;padding:12px;text-align:center;background:#fff}
.calc-stat .k{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.calc-stat .v{font-family:"Anton",sans-serif;font-size:1.55rem;color:var(--forest)}
.calc-note{font-size:13px;color:#444;margin-top:8px;line-height:1.55}
.calc-digit{font-size:13px;color:var(--forest);font-weight:600;margin-top:8px}
.calc-table{width:100%;border-collapse:collapse;margin:14px 0 4px;font-variant-numeric:tabular-nums;font-size:14px}
.calc-table th{background:var(--forest);color:#fff;padding:8px 10px;text-align:right;font-weight:700}
.calc-table th:first-child{text-align:left}
.calc-table td{padding:7px 10px;text-align:right;border-bottom:1px solid var(--hair)}
.calc-table td.rl{text-align:left;font-weight:700}
.calc-table tbody tr:nth-child(even){background:#f6faf7}`;
