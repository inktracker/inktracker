// Builds the operator alert digest from a batch of qb_event_log rows
// with status='error'. Pure logic so the daily cron's "what happened
// overnight" summary can be unit-tested without standing up Resend.
//
// Threshold: 5 errors in the scan window is the floor for "worth
// waking up the operator." Below that, the noise-to-signal ratio
// burns out the alert. Adjust QB_ERROR_DIGEST_THRESHOLD if real-world
// data argues for a different cutoff.

export const QB_ERROR_DIGEST_THRESHOLD = 5;

/**
 * Group + count error rows for the digest body. Pure: takes an array
 * of rows {shop_owner, action, error_message, created_at}, returns
 * a deterministic summary structure.
 *
 * @param {Array<{shop_owner: string, action: string, error_message: string|null, created_at: string}>} rows
 * @returns {{
 *   total: number,
 *   shopCount: number,
 *   byShop: Array<{ shop_owner: string, count: number, actions: Record<string, number>, recentSamples: Array<{action: string, error_message: string|null, created_at: string}> }>,
 *   byAction: Record<string, number>,
 * }}
 */
export function summarizeQbErrors(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const byShopMap = new Map();
  const byAction = {};
  for (const row of safeRows) {
    if (!row || row.status !== "error" && row.status !== undefined && row.status !== null) {
      // Allow status to be omitted by tests; if present it must be 'error'.
      continue;
    }
    const shop = row.shop_owner || "(unknown)";
    const action = row.action || "(unknown)";
    byAction[action] = (byAction[action] || 0) + 1;
    if (!byShopMap.has(shop)) {
      byShopMap.set(shop, {
        shop_owner: shop,
        count: 0,
        actions: {},
        recentSamples: [],
      });
    }
    const bucket = byShopMap.get(shop);
    bucket.count += 1;
    bucket.actions[action] = (bucket.actions[action] || 0) + 1;
    if (bucket.recentSamples.length < 3) {
      bucket.recentSamples.push({
        action,
        error_message: row.error_message ?? null,
        created_at: row.created_at,
      });
    }
  }
  // Sort shops by count desc, then alphabetical for stable output.
  const byShop = Array.from(byShopMap.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.shop_owner.localeCompare(b.shop_owner);
  });
  return {
    total: safeRows.length,
    shopCount: byShopMap.size,
    byShop,
    byAction,
  };
}

/**
 * True when the scan crossed the alert threshold. Threshold is on
 * total error count, not per-shop count — one shop blowing up matters
 * as much as five shops blipping once each.
 *
 * @param {ReturnType<typeof summarizeQbErrors>} summary
 * @returns {boolean}
 */
export function shouldSendErrorDigest(summary) {
  return Boolean(summary && summary.total >= QB_ERROR_DIGEST_THRESHOLD);
}

/**
 * Plain-text body for the alert email. Optimized for skim from a
 * notification preview — counts first, samples second.
 *
 * @param {ReturnType<typeof summarizeQbErrors>} summary
 * @param {{ windowLabel?: string }} [opts]
 */
export function buildQbErrorDigestText(summary, opts = {}) {
  const window = opts.windowLabel || "last 24 hours";
  const lines = [];
  lines.push(`InkTracker — QuickBooks error spike alert`);
  lines.push("");
  lines.push(`${summary.total} QuickBooks error event(s) recorded across ${summary.shopCount} shop(s) in the ${window}.`);
  lines.push("");
  lines.push(`By action:`);
  Object.entries(summary.byAction)
    .sort((a, b) => b[1] - a[1])
    .forEach(([action, count]) => lines.push(`  - ${action}: ${count}`));
  lines.push("");
  lines.push(`By shop:`);
  summary.byShop.forEach((shop) => {
    lines.push(`  - ${shop.shop_owner} (${shop.count})`);
    shop.recentSamples.forEach((s) => {
      const msg = (s.error_message || "(no message)").slice(0, 160);
      lines.push(`      • [${s.action}] ${msg}`);
    });
  });
  lines.push("");
  lines.push(`Check the qb_event_log table or the QB Events tab on the affected quotes for full payloads.`);
  return lines.join("\n");
}

/**
 * HTML version of the digest, for Resend. Visually identical structure
 * to the text body — same counts, same samples, same order — so the
 * digest is reviewable from either format.
 *
 * @param {ReturnType<typeof summarizeQbErrors>} summary
 * @param {{ windowLabel?: string }} [opts]
 */
export function buildQbErrorDigestHtml(summary, opts = {}) {
  const window = opts.windowLabel || "last 24 hours";
  const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
  const actionRows = Object.entries(summary.byAction)
    .sort((a, b) => b[1] - a[1])
    .map(([action, count]) => `<li><code>${escapeHtml(action)}</code>: ${count}</li>`)
    .join("");
  const shopBlocks = summary.byShop.map((shop) => {
    const samples = shop.recentSamples.map((s) => {
      const msg = escapeHtml((s.error_message || "(no message)").slice(0, 160));
      return `<li><code>[${escapeHtml(s.action)}]</code> ${msg}</li>`;
    }).join("");
    return `
      <div style="margin:14px 0;padding:12px;border:1px solid #e5e7eb;border-radius:8px;">
        <div style="font-weight:600;color:#0d9488;">${escapeHtml(shop.shop_owner)} — ${shop.count} error(s)</div>
        <ul style="margin:8px 0 0 0;padding-left:18px;color:#444;font-size:13px;">${samples}</ul>
      </div>
    `;
  }).join("");
  return `
    <div style="font-family:-apple-system,system-ui,sans-serif;line-height:1.5;color:#111;max-width:640px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 8px 0;color:#c2410c;">QuickBooks error spike</h2>
      <p style="margin:0 0 14px 0;">${summary.total} error event(s) across ${summary.shopCount} shop(s) in the ${escapeHtml(window)}.</p>
      <h3 style="margin:16px 0 6px 0;font-size:14px;color:#555;">By action</h3>
      <ul style="margin:0;padding-left:18px;font-size:13px;">${actionRows}</ul>
      <h3 style="margin:20px 0 6px 0;font-size:14px;color:#555;">By shop</h3>
      ${shopBlocks}
      <p style="margin:24px 0 0 0;font-size:12px;color:#888;">
        Inspect <code>qb_event_log</code> or the QB Events tab on the affected quote for full payloads.
      </p>
    </div>
  `;
}
