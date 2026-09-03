// Pure logic for the daily systemHealthCheck edge function. No I/O here —
// the function's index.ts runs the network probes and hands the results to
// these builders. Contract-tested in __tests__/systemHealthCheck.test.js.
//
// A probe result is:
//   { name, tier: 'critical'|'secondary', ok, status: 'ok'|'warn'|'down',
//     detail, latencyMs }
// tier decides how loud a failure is:
//   critical  → a failure means the product is broken for real users → 'down'
//   secondary → a failure is degraded/nice-to-have (a supplier API, a cron
//               that didn't run) → 'degraded', worth a look but not a fire.

export const OK = "ok";
export const WARN = "warn";
export const DOWN = "down";

/**
 * Roll a list of probe results (+ any auto-fixes performed) into a summary.
 * @param {Array} probes
 * @param {Array<{action:string, result:string, ok:boolean}>} [autofixes]
 */
export function summarizeHealth(probes, autofixes = []) {
  const list = Array.isArray(probes) ? probes : [];
  const critical = list.filter((p) => p.tier === "critical" && p.ok === false);
  const warnings = list.filter((p) => p.tier !== "critical" && p.ok === false);
  const okCount = list.filter((p) => p.ok === true).length;

  let overall = OK;
  if (critical.length > 0) overall = DOWN;
  else if (warnings.length > 0) overall = "degraded";

  const fixes = Array.isArray(autofixes) ? autofixes : [];
  return {
    overall,               // 'ok' | 'degraded' | 'down'
    total: list.length,
    okCount,
    critical,              // failed critical probes
    warnings,              // failed secondary probes
    autofixes: fixes,
    // Did an auto-fix fail? That itself is worth surfacing.
    autofixFailed: fixes.filter((f) => f.ok === false),
  };
}

function statusIcon(overall) {
  if (overall === DOWN) return "🔴";
  if (overall === "degraded") return "🟡";
  return "✅";
}

export function buildHealthSubject(summary, dateStr) {
  const icon = statusIcon(summary.overall);
  if (summary.overall === DOWN) {
    const names = summary.critical.map((p) => p.name).join(", ");
    return `${icon} InkTracker health: DOWN — ${names} (${dateStr})`;
  }
  if (summary.overall === "degraded") {
    const names = summary.warnings.map((p) => p.name).join(", ");
    return `${icon} InkTracker health: degraded — ${names} (${dateStr})`;
  }
  return `${icon} InkTracker health: all clear (${dateStr})`;
}

function line(p) {
  const dot = p.ok ? "✓" : p.status === DOWN ? "✗" : "!";
  const lat = Number.isFinite(p.latencyMs) ? ` (${p.latencyMs}ms)` : "";
  return `  ${dot} ${p.name}: ${p.detail || (p.ok ? "ok" : "failed")}${lat}`;
}

export function buildHealthText(summary, probes, dateStr) {
  const list = Array.isArray(probes) ? probes : [];
  const parts = [];
  parts.push(`InkTracker system health — ${dateStr}`);
  parts.push(
    summary.overall === DOWN
      ? "STATUS: DOWN — one or more critical systems are failing."
      : summary.overall === "degraded"
        ? "STATUS: DEGRADED — everything customer-facing is up; a secondary system needs a look."
        : "STATUS: ALL CLEAR — every system responded normally.",
  );
  parts.push("");

  if (summary.critical.length > 0) {
    parts.push("NEEDS YOU NOW (critical):");
    for (const p of summary.critical) parts.push(line(p));
    parts.push("");
  }
  if (summary.warnings.length > 0) {
    parts.push("WORTH A LOOK (secondary):");
    for (const p of summary.warnings) parts.push(line(p));
    parts.push("");
  }
  if (summary.autofixes.length > 0) {
    parts.push("AUTO-HANDLED:");
    for (const f of summary.autofixes) {
      parts.push(`  ${f.ok ? "✓" : "✗"} ${f.action}: ${f.result}`);
    }
    parts.push("");
  }

  parts.push(`All ${list.length} checks:`);
  for (const p of list) parts.push(line(p));
  parts.push("");
  parts.push("— InkTracker daily system check (6am). Green mornings still send so a silent monitor can't pass for a healthy one.");
  return parts.join("\n");
}

export function buildHealthHtml(summary, probes, dateStr) {
  const list = Array.isArray(probes) ? probes : [];
  const color = summary.overall === DOWN ? "#dc2626" : summary.overall === "degraded" ? "#d97706" : "#0d9488";
  const rows = list
    .map((p) => {
      const c = p.ok ? "#0d9488" : p.status === DOWN ? "#dc2626" : "#d97706";
      const dot = p.ok ? "✓" : p.status === DOWN ? "✗" : "!";
      const lat = Number.isFinite(p.latencyMs) ? `${p.latencyMs}ms` : "";
      return `<tr>
        <td style="padding:6px 10px;color:${c};font-weight:700">${dot}</td>
        <td style="padding:6px 10px;font-weight:600">${esc(p.name)}</td>
        <td style="padding:6px 10px;color:#475569">${esc(p.detail || (p.ok ? "ok" : "failed"))}</td>
        <td style="padding:6px 10px;color:#94a3b8;text-align:right">${lat}</td>
      </tr>`;
    })
    .join("");
  const fixHtml = summary.autofixes.length
    ? `<h3 style="margin:18px 0 6px">Auto-handled</h3><ul>${summary.autofixes
        .map((f) => `<li style="color:${f.ok ? "#0d9488" : "#dc2626"}">${esc(f.action)}: ${esc(f.result)}</li>`)
        .join("")}</ul>`
    : "";
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;max-width:640px;margin:0 auto;padding:20px">
  <h2 style="margin:0 0 4px;color:${color}">${esc(buildHealthSubject(summary, dateStr))}</h2>
  <p style="color:#475569;margin:0 0 14px">${summary.okCount}/${summary.total} checks passed.</p>
  ${fixHtml}
  <table style="border-collapse:collapse;width:100%;font-size:14px">${rows}</table>
  <p style="color:#94a3b8;font-size:12px;margin-top:18px">InkTracker daily system check · runs 6am · green mornings still send on purpose.</p>
</body></html>`;
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
