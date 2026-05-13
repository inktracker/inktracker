// Public changelog. Add new entries to the top of the ENTRIES array.
// Keep it honest — only ship things you actually shipped.

const ENTRIES = [
  {
    date: "2026-05-13",
    title: "Every feature has a live preview",
    items: [
      "Filled in the last four product demos on the landing page — Invoicing & Payments, Inventory & Restock, Broker Integration, and Shop Floor — so every chip is clickable.",
      "Renamed 'Mockup Designer' to 'Artwork Proofs' across the pricing card and marketing copy.",
      "Customer replies in the messaging tab now auto-mark as read when you open the thread.",
    ],
  },
  {
    date: "2026-05-12",
    title: "Sharper role guardrails",
    items: [
      "QuickBooks Connect and Stripe payout settings on /Account are now admin-only. Managers keep full operational access; only the shop owner can disconnect financial wiring.",
      "Inventory: errors during restock and double-clicks on Add no longer leave the cart in a weird state.",
      "Broker quotes generate collision-proof IDs even on rapid-fire submissions.",
      "Locked down a handful of internal admin endpoints — cross-shop actions are now refused at the function level.",
    ],
  },
  {
    date: "2026-05-03",
    title: "Quality pass",
    items: [
      "Cleared lingering lint errors so the build stays green.",
      "Launched this changelog and a new security page.",
    ],
  },
  {
    date: "2026-05-01",
    title: "Database lockdown",
    items: [
      "Tightened row-level security policies across all tables.",
      "Internal infrastructure work — no UI changes.",
    ],
  },
  {
    date: "2026-04-29",
    title: "Quote intake gets smarter",
    items: [
      "Added a Paste Order button on quotes — paste a customer's email or message and we extract line items automatically.",
      "Improved the quote parser to handle more vendor formats.",
    ],
  },
  {
    date: "2026-04-23",
    title: "AS Colour integration",
    items: [
      "Wired AS Colour's catalog, inventory, and pricing API into the Catalog page.",
      "Toggle between S&S Activewear and AS Colour from the catalog header.",
    ],
  },
];

export default function Changelog() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-6">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-200 p-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold text-slate-900">Changelog</h1>
          <p className="text-sm text-slate-500">
            What's new in InkTracker. We ship small, often, and write it down so you know what changed.
          </p>
        </header>

        <div className="space-y-8 pt-2">
          {ENTRIES.map((entry) => (
            <article key={entry.date} className="space-y-2 border-l-2 border-indigo-100 pl-5">
              <div className="flex items-baseline gap-3">
                <h2 className="text-lg font-semibold text-slate-800">{entry.title}</h2>
                <time className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  {formatDate(entry.date)}
                </time>
              </div>
              <ul className="list-disc list-inside text-sm text-slate-600 space-y-1 pl-1">
                {entry.items.map((item, i) => (
                  <li key={i} className="leading-relaxed">{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <footer className="pt-6 border-t border-slate-100 text-xs text-slate-500">
          Have a feature request or found a bug?{" "}
          <a href="mailto:support@inktracker.app" className="text-indigo-600 underline">
            support@inktracker.app
          </a>
        </footer>
      </div>
    </div>
  );
}

function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
