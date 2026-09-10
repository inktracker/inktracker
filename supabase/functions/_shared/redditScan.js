// Pure logic for the hourly Reddit lead scan (see functions/redditScan).
// Node/Deno portable, no I/O — the edge handler does the fetching + email;
// everything decision-shaped lives here so vitest can pin it.
//
// Goal: surface Reddit threads where someone is ASKING FOR / COMPARING shop
// management software for a decoration business (screen print / embroidery /
// DTG / DTF / promo), so Joe can reply helpfully. Precision matters more than
// recall — a noisy hourly email gets ignored. The wider subreddit set (Etsy,
// smallbusiness, apparel) is gated harder than the decoration-native subs.

// ── Watch list (edit these two arrays to retune the scan) ──────────────────
export const SUBREDDITS = [
  "screenprinting",
  "Embroidery",
  "smallbusiness",
  "promotionalproducts",
  "EntrepreneurRideAlong",
  "Etsy",
  "dtg",
  "apparel",
];

// Per-subreddit search runs this OR-query (Reddit search syntax). Site-wide
// searches (posts outside our subs) run only the strong competitor terms.
export const KEYWORD_QUERY =
  'printavo OR "shop management software" OR "quote software" OR ' +
  '"order tracking" OR "invoicing software" OR "shop software"';

export const SITEWIDE_QUERIES = ["printavo", "printavo alternative"];

// Decoration-native subs: a post here is on-topic by default, so it only needs
// to show software/tool intent. Posts in the broader subs must ALSO name the
// decoration domain to qualify (keeps r/smallbusiness + r/Etsy noise out).
export const DECORATION_SUBS = new Set(
  ["screenprinting", "embroidery", "promotionalproducts", "dtg", "apparel"].map((s) => s.toLowerCase()),
);

// ── Relevance signals ──────────────────────────────────────────────────────
const SOFTWARE_TERMS = [
  /printavo/i, /shopvox/i, /shopworks/i, /teesom/i, /inksoft/i, /deconetwork/i,
  /shop management/i, /order tracking/i, /quot(e|ing) software/i, /invoicing/i,
  /\bcrm\b/i, /spreadsheet/i, /software/i, /\bapp\b/i, /\btool\b/i, /\bsystem\b/i,
];
const INTENT_TERMS = [
  /recommend/i, /looking for/i, /alternative/i, /anyone use/i, /what do you use/i,
  /best (app|software|tool|system|way)/i, /suggest/i, /switch(ing)? from/i,
  /\bvs\.?\b/i, /help me/i, /any(one)? (using|know|tried)/i, /how do you (manage|track|quote)/i,
];
const DOMAIN_TERMS = [
  /screen ?print/i, /\bdtg\b/i, /\bdtf\b/i, /embroider/i, /\bapparel\b/i,
  /print shop/i, /\bt-?shirts?\b/i, /decorat/i, /\bpromo\b/i, /heat press/i,
];

function matchLabels(regexes, text) {
  return regexes.filter((re) => re.test(text)).map((re) => re.source);
}

// Classify a normalized post. Returns { isLead, score, why[], angle }.
export function analyzePost(post) {
  const text = `${post.title || ""}\n${post.selftext || ""}`;
  const software = matchLabels(SOFTWARE_TERMS, text);
  const intent = matchLabels(INTENT_TERMS, text);
  const domain = matchLabels(DOMAIN_TERMS, text);
  const sub = String(post.subreddit || "").toLowerCase();
  const decoSub = DECORATION_SUBS.has(sub);
  const mentionsPrintavo = /printavo/i.test(text);

  const hasDomain = domain.length > 0 || decoSub;
  const hasToolAsk = software.length > 0 || intent.length > 0;
  // A direct Printavo mention is always a lead. Otherwise we need both the
  // decoration domain AND some tool/intent signal.
  const isLead = mentionsPrintavo || (hasDomain && hasToolAsk);

  const score =
    software.length * 2 +
    intent.length * 2 +
    domain.length +
    (mentionsPrintavo ? 4 : 0) +
    (decoSub ? 1 : 0);

  const why = [];
  if (mentionsPrintavo) why.push("mentions Printavo");
  if (software.length) why.push("shop-software terms");
  if (intent.length) why.push("asking/comparing");
  if (domain.length || decoSub) why.push("decoration shop");

  return { isLead, score, why, angle: suggestAngle({ mentionsPrintavo, software, intent }) };
}

// A short, spam-safe suggested reply angle (Joe writes the actual comment).
export function suggestAngle({ mentionsPrintavo, software, intent }) {
  if (mentionsPrintavo) {
    return "Direct Printavo mention — InkTracker is $99/mo flat with QuickBooks sync and a broker portal; first month free for Printavo switchers. Reply helpfully first, mention it only if it fits.";
  }
  if ((software && software.length) || (intent && intent.length)) {
    return "They're shopping for shop software — describe quote → production → invoice → paid + QuickBooks sync, $99 flat, 14-day free trial. Lead with genuinely useful advice, not a pitch.";
  }
  return "On-topic decoration thread — a helpful, experience-based reply; mention InkTracker only if it's clearly relevant.";
}

// Normalize a raw Reddit search listing (either the anonymous *.json shape or
// the OAuth /search shape — both are { data: { children: [{ data }] } }).
export function extractPosts(listingJson) {
  const children = listingJson?.data?.children;
  if (!Array.isArray(children)) return [];
  return children
    .map((c) => c?.data)
    .filter(Boolean)
    .filter((d) => d.name && (d.name.startsWith("t3_") || d.name.startsWith("t1_")))
    .map((d) => ({
      id: d.name, // fullname, e.g. t3_abc123 — stable dedupe key
      subreddit: d.subreddit || "",
      title: d.title || d.link_title || "",
      selftext: d.selftext || d.body || "",
      author: d.author || "",
      permalink: d.permalink ? `https://www.reddit.com${d.permalink}` : d.url || "",
      url: d.url || "",
      num_comments: d.num_comments ?? 0,
      created_utc: d.created_utc ? Math.round(d.created_utc) : null,
    }));
}

// From many (possibly overlapping) posts, produce the ranked list of NEW leads.
//   seenIds: Set<string> of post ids already surfaced (from reddit_scan_seen)
export function filterNewLeads(posts, seenIds, { limit = 20 } = {}) {
  const seen = seenIds instanceof Set ? seenIds : new Set(seenIds || []);
  const byId = new Map();
  for (const p of posts) {
    if (!p?.id || seen.has(p.id) || byId.has(p.id)) continue;
    const a = analyzePost(p);
    if (!a.isLead) continue;
    byId.set(p.id, { ...p, _score: a.score, _why: a.why, _angle: a.angle });
  }
  const ranked = [...byId.values()].sort(
    (x, y) => y._score - x._score || (y.created_utc || 0) - (x.created_utc || 0),
  );
  return { leads: ranked.slice(0, limit), total: ranked.length };
}

// ── Email digest builders ──────────────────────────────────────────────────
export function buildDigestSubject(leads, total) {
  const n = total ?? leads.length;
  const subs = [...new Set(leads.map((l) => `r/${l.subreddit}`))].slice(0, 3).join(", ");
  return `🧵 ${n} Reddit lead${n === 1 ? "" : "s"} to check${subs ? ` — ${subs}` : ""}`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function snippet(text, n = 220) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export function buildDigestText(leads, total) {
  const lines = [
    `${total ?? leads.length} Reddit thread(s) worth a look this hour:`,
    "",
  ];
  leads.forEach((l, i) => {
    lines.push(`${i + 1}. [r/${l.subreddit}] ${l.title}`);
    if (l.selftext) lines.push(`   ${snippet(l.selftext)}`);
    lines.push(`   Why: ${l._why.join(", ")}  ·  ${l.num_comments} comments`);
    lines.push(`   ${l.permalink}`);
    lines.push(`   ↳ ${l._angle}`);
    lines.push("");
  });
  if (total > leads.length) lines.push(`(+${total - leads.length} more, trimmed)`);
  lines.push("");
  lines.push("Reply on Reddit: be helpful first, disclose you build InkTracker, don't lead with a link (that's what trips the spam filter).");
  return lines.join("\n");
}

export function buildDigestHtml(leads, total) {
  const items = leads
    .map(
      (l) => `
      <li style="margin:0 0 16px 0;padding:0 0 14px 0;border-bottom:1px solid #e5e7eb;">
        <div style="font-size:12px;color:#0f766e;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">r/${esc(l.subreddit)} · ${l.num_comments} comments</div>
        <div style="font-size:15px;font-weight:600;margin:2px 0 4px;"><a href="${esc(l.permalink)}" style="color:#0f172a;text-decoration:none;">${esc(l.title)}</a></div>
        ${l.selftext ? `<div style="font-size:13px;color:#475569;margin-bottom:6px;">${esc(snippet(l.selftext))}</div>` : ""}
        <div style="font-size:12px;color:#64748b;margin-bottom:6px;">Why: ${esc(l._why.join(", "))}</div>
        <div style="font-size:13px;color:#334155;background:#f0fdfa;border-left:3px solid #14b8a6;padding:6px 10px;border-radius:4px;">${esc(l._angle)}</div>
        <div style="margin-top:6px;"><a href="${esc(l.permalink)}" style="font-size:13px;color:#0d9488;font-weight:600;">Open thread →</a></div>
      </li>`,
    )
    .join("");
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a;">
      <h2 style="font-size:18px;margin:0 0 4px;">${total ?? leads.length} Reddit lead${(total ?? leads.length) === 1 ? "" : "s"} to check</h2>
      <p style="font-size:13px;color:#64748b;margin:0 0 16px;">Threads where someone's asking about or comparing shop software.</p>
      <ul style="list-style:none;padding:0;margin:0;">${items}</ul>
      ${total > leads.length ? `<p style="font-size:12px;color:#94a3b8;">+${total - leads.length} more this hour, trimmed from this email.</p>` : ""}
      <p style="font-size:12px;color:#94a3b8;margin-top:16px;border-top:1px solid #e5e7eb;padding-top:12px;">Reply be-helpful-first: answer the question, disclose you build InkTracker, and don't lead with a link — that's what the spam filter catches.</p>
    </div>`;
}

// Alert digest when Reddit itself couldn't be reached (never fail silently —
// the health-check philosophy: a scan that returns nothing must be
// distinguishable from a scan that couldn't run).
export function buildBlockedSubject() {
  return "⚠️ Reddit scan couldn't reach Reddit";
}
export function buildBlockedText(detail) {
  return [
    "The hourly Reddit lead scan ran but couldn't read from Reddit.",
    "",
    `Detail: ${detail || "unknown"}`,
    "",
    "Likely Reddit throttled the datacenter IP. Adding REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET (a Reddit 'script' app) switches the scan to authenticated OAuth, which has much higher limits.",
    "This alert means the scan is alive — it just got no data this run. It will retry next hour.",
  ].join("\n");
}
