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
// Shop-count thresholds Joe watches (2026-08-13 "monitor those things"):
// QB Partner Program Silver (~$300/mo) and the Intuit App Assessment both
// revisit around 10 PAYING shops. "Paying" = a real Stripe subscription —
// comped accounts and the demo shop read active/shop in profiles but pay
// nothing (memory: comped accounts must never count).
export const PAYING_SHOPS_THRESHOLD = 10;
export const PAYING_SHOPS_WARN_AT = 8;
// Resend free plan is 3,000 emails/month; warn at 80%. Override via the
// caller when the plan changes.
export const RESEND_MONTHLY_CAP_DEFAULT = 3000;

export function summarizeGrowth({ profiles, quoteOwners, orderCount7d, stripeSubEmails, emails30d, resendMonthlyCap }, now = Date.now()) {
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
  const stripeSet = new Set((stripeSubEmails || []).map((e) => String(e || "").toLowerCase()));
  let payingShops = 0;
  let compedShops = 0;

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
      // Only a real Stripe subscription counts as PAYING. Everything else
      // in this state (owner's own shop, comps, demo) is "comped" — it
      // must never advance the 10-shop triggers. When the caller can't
      // supply the Stripe set (query failed), fall back to the old
      // overcount but mark it estimated.
      if (stripeSubEmails == null || stripeSet.has(String(p.email || "").toLowerCase())) {
        payingShops++;
      } else {
        compedShops++;
      }
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

  const cap = Number(resendMonthlyCap) > 0 ? Number(resendMonthlyCap) : RESEND_MONTHLY_CAP_DEFAULT;
  return {
    newSignups,
    activeTrials,
    trialsEndingSoon,
    expiredLast7d,
    payingShops,
    payingIsEstimate: stripeSubEmails == null,
    compedShops,
    quotes7d: (quoteOwners || []).length,
    orders7d: orderCount7d ?? 0,
    emails30d: Number(emails30d) || 0,
    resendMonthlyCap: cap,
  };
}

// The threshold-watch block appended to the weekly report. Pure so the
// trigger lines are pinned by tests.
export function buildThresholdWatchText(s) {
  const lines = ["Threshold watch:"];
  const paying = s.payingShops;
  const est = s.payingIsEstimate ? " (ESTIMATE — Stripe lookup failed, may overcount comps)" : "";
  if (paying >= PAYING_SHOPS_THRESHOLD) {
    lines.push(`  • 🔔 ${paying} paying shops${est} — the ${PAYING_SHOPS_THRESHOLD}-shop triggers are DUE: revisit QB Partner Program Silver (~$300/mo) and schedule the Intuit App Assessment.`);
  } else if (paying >= PAYING_SHOPS_WARN_AT) {
    lines.push(`  • ⚠ ${paying} paying shops${est} — approaching the ${PAYING_SHOPS_THRESHOLD}-shop triggers (QB Partner Silver + Intuit App Assessment). Start budgeting/scheduling.`);
  } else {
    lines.push(`  • ${paying} paying shop(s)${est} of ${PAYING_SHOPS_THRESHOLD} before the QB Partner Silver / Intuit App Assessment triggers.`);
  }
  if (s.compedShops > 0) {
    lines.push(`  • ${s.compedShops} comped/demo shop(s) excluded from the paying count.`);
  }
  const pct = s.resendMonthlyCap > 0 ? Math.round((s.emails30d / s.resendMonthlyCap) * 100) : 0;
  if (pct >= 100) {
    lines.push(`  • 🔔 Email volume ${s.emails30d}/30d is AT/OVER the Resend plan cap (${s.resendMonthlyCap}/mo) — upgrade the plan now (sends will start failing).`);
  } else if (pct >= 80) {
    lines.push(`  • ⚠ Email volume ${s.emails30d}/30d is ${pct}% of the Resend plan cap (${s.resendMonthlyCap}/mo) — plan the upgrade.`);
  } else {
    lines.push(`  • Email volume: ${s.emails30d} sends in 30d (${pct}% of the ${s.resendMonthlyCap}/mo Resend cap).`);
  }
  return lines.join("\n");
}

export function buildGrowthReportText(s) {
  const line = (arr, fmt) => (arr.length ? arr.map(fmt).join("\n") : "  • none");
  return [
    "InkTracker — weekly growth report",
    "",
    `Paying shops (Stripe subscriptions): ${s.payingShops}${s.payingIsEstimate ? " (estimate)" : ""}`,
    "",
    buildThresholdWatchText(s),
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
