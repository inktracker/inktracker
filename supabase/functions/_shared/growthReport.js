// Pure aggregation + formatting for the weekly growth report, extracted so
// the logic is unit-testable without a live cron run. Wired into
// qbReconcile's nightly sweep (Monday runs only) alongside the QB error
// digest and email-health alert — same piggyback, zero new infrastructure.
//
// The blind spot this closes: signup-notify emails announce each signup as
// it happens, but nothing ever reports what became of them — michael@
// arsupremo.com sat untouched for six days before anyone looked. This is
// the weekly "what happened to the funnel" answer, pushed instead of pulled.
//
// OPERATOR-ONLY: names shops and their activity. Must never route to a
// shop owner — the caller sends strictly to OPERATOR_ALERT_EMAIL.

const DAY_MS = 86400000;

// Collapse raw profile + quote rows into the funnel stats the report
// prints. `profiles` is every role='shop' profile (small table);
// `quoteOwners` is the shop_owner column of quotes created in the last
// 7 days (activity pulse + activation check).
export function summarizeGrowth({ profiles, quoteOwners, orderCount7d }, now = Date.now()) {
  const rows = profiles || [];
  const weekAgo = now - 7 * DAY_MS;
  const ts = (v) => {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  };

  const quotesByOwner = {};
  for (const owner of quoteOwners || []) {
    if (owner) quotesByOwner[owner] = (quotesByOwner[owner] || 0) + 1;
  }

  const newSignups = [];
  const activeTrials = [];
  const trialsEndingSoon = [];
  const expiredLast7d = [];
  let payingShops = 0;

  for (const p of rows) {
    const created = ts(p.created_at);
    const trialEnds = ts(p.trial_ends_at);
    const label = p.shop_name || p.company_name || "(no shop name)";
    const quotes7d = quotesByOwner[p.email] || 0;

    if (created && created >= weekAgo) {
      newSignups.push({ email: p.email, label, tier: p.subscription_tier });
    }

    if (p.subscription_tier === "shop" &&
        (p.subscription_status === "active" || p.subscription_status === "trialing")) {
      payingShops++;
    }

    if (p.subscription_tier === "trial" && trialEnds) {
      if (trialEnds > now) {
        const daysLeft = Math.ceil((trialEnds - now) / DAY_MS);
        const entry = { email: p.email, label, daysLeft, quotes7d };
        activeTrials.push(entry);
        if (daysLeft <= 7) trialsEndingSoon.push(entry);
      } else if (trialEnds >= weekAgo) {
        expiredLast7d.push({ email: p.email, label, quotes7d });
      }
    }
  }

  activeTrials.sort((a, b) => a.daysLeft - b.daysLeft);

  return {
    newSignups,
    activeTrials,
    trialsEndingSoon,
    expiredLast7d,
    payingShops,
    quotes7d: (quoteOwners || []).length,
    orders7d: orderCount7d ?? 0,
  };
}

export function buildGrowthReportText(s) {
  const line = (arr, fmt) => (arr.length ? arr.map(fmt).join("\n") : "  • none");
  return [
    "InkTracker — weekly growth report",
    "",
    `Paying shops: ${s.payingShops}`,
    `Platform activity (7d): ${s.quotes7d} quote(s), ${s.orders7d} order(s)`,
    "",
    `New signups (7d): ${s.newSignups.length}`,
    line(s.newSignups, (x) => `  • ${x.email} — ${x.label} [${x.tier}]`),
    "",
    `Active trials: ${s.activeTrials.length}`,
    line(s.activeTrials, (x) =>
      `  • ${x.email} — ${x.label}: ${x.daysLeft}d left, ${x.quotes7d} quote(s) this week${x.quotes7d === 0 ? "  ⚠ not activated" : ""}`),
    "",
    `Trials ending within 7 days: ${s.trialsEndingSoon.length}`,
    line(s.trialsEndingSoon, (x) => `  • ${x.email} — ${x.label}: ${x.daysLeft}d left`),
    "",
    `Trials expired without converting (7d): ${s.expiredLast7d.length}`,
    line(s.expiredLast7d, (x) => `  • ${x.email} — ${x.label} (${x.quotes7d} quote(s) final week)`),
    "",
    "Signup detail arrives per-signup via notify emails; this is the weekly",
    "what-became-of-them view. Reply to this email to flag anything odd.",
  ].join("\n");
}

export function buildGrowthReportSubject(s) {
  return `[InkTracker] Weekly growth: ${s.newSignups.length} signup(s), ${s.activeTrials.length} trial(s), ${s.payingShops} paying`;
}
