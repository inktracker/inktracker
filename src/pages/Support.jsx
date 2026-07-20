import { usePageMeta } from "@/lib/seo/usePageMeta";

// Public support page. Required by the QuickBooks App Store listing —
// they want a URL where users can get help, not just an email. This
// page also covers the most common QuickBooks-specific support
// questions inline so operators don't have to email for the obvious
// stuff.
//
// When you change content here, also bump the "Last updated" date.

export default function Support() {
  usePageMeta({ title: "Support & Help — InkTracker", path: "/support" });
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-6">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-200 p-8 space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold text-slate-900">Support</h1>
          <p className="text-sm text-slate-500">
            Quick answers to common questions and how to reach us if you need more.
          </p>
          <p className="text-xs text-slate-500">Last updated: May 31, 2026</p>
        </header>

        {/* Contact card — front and center so the obvious case is one click away. */}
        <section className="rounded-xl border border-teal-200 bg-teal-50 p-5 space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">Get in touch</h2>
          <p className="text-sm text-slate-700">
            Email{" "}
            <a href="mailto:support@inktracker.app" className="font-semibold text-teal-700 underline">
              support@inktracker.app
            </a>{" "}
            and a real person will respond. We aim to respond within one business day.
          </p>
          <p className="text-sm text-slate-700">
            For security issues, use{" "}
            <a href="mailto:security@inktracker.app" className="font-semibold text-teal-700 underline">
              security@inktracker.app
            </a>
            . We acknowledge within 48 hours.
          </p>
        </section>

        {/* QuickBooks-specific section — listed first because that's what Intuit
            reviewers will look for, and it's the question category we get the
            most. */}
        <Section title="QuickBooks">
          <Q
            q="I clicked Send and got 'Couldn't update the existing QuickBooks invoice.'"
            a="This means we found a QuickBooks invoice already linked to this quote, but QuickBooks refused to update it. The most common cause is a stale lock or a transient Intuit API hiccup. Open the quote → QuickBooks → click Refresh. If that doesn't resolve it, fix the invoice in QuickBooks directly (open it, save it, even without changes — that often clears the lock). We will not create a duplicate invoice on your behalf."
          />
          <Q
            q="A customer paid in QuickBooks but my quote still says Sent."
            a="The nightly reconciliation cron (runs around midnight Eastern) will catch this and convert the quote to an order automatically — you'll see a notification when it does. If you want to fix it sooner, open the quote → QuickBooks → Refresh. We re-read the invoice's current state from QuickBooks; if it shows paid there, we'll flip your side immediately."
          />
          <Q
            q="I created a QuickBooks invoice outside InkTracker and want to link it to a quote."
            a="Open the quote → QuickBooks → Link Existing → paste the QuickBooks invoice number (e.g. Q-2026-115) or numeric Id. We'll look it up in your QuickBooks account, verify it's unambiguous, and link it to the quote. Payment status carries over."
          />
          <Q
            q="How do I disconnect QuickBooks?"
            a="Account → QuickBooks → Disconnect. That immediately clears your access and refresh tokens from our database. For defense in depth, we also recommend revoking InkTracker from inside QuickBooks (Settings → Apps in QuickBooks Online)."
          />
          <Q
            q="Where can I see what InkTracker has done in my QuickBooks account?"
            a="Open any quote → QuickBooks → Events tab. Every action we take against QuickBooks — invoice create, payment-link mint, webhook receive, nightly reconciliation — writes one row there with the request, response, and timestamp. Per-shop, fully auditable."
          />
          <Q
            q="I see two invoices in QuickBooks for the same quote."
            a="If you ever see two invoices for one InkTracker quote, email support@inktracker.app with the quote number and we'll investigate. We engineered idempotency keys and a paid-state guard specifically to prevent this; if it happens it's a bug we want to know about."
          />
        </Section>

        <Section title="Account & billing">
          <Q
            q="How do I cancel my subscription?"
            a="Account → Billing → Manage Subscription. That takes you to Stripe's customer portal. Cancellation takes effect at the end of your current billing period."
          />
          <Q
            q="Can I export my data?"
            a="Yes. Email support@inktracker.app with what you need (customers, quotes, orders, invoices, or all of it) and we'll send a CSV export within one business day."
          />
          <Q
            q="How do I add another person to my shop?"
            a="Account → Team → Invite. They get a sign-up link and inherit access scoped to your shop."
          />
        </Section>

        <Section title="Quotes & orders">
          <Q
            q="I deleted a quote but it still shows on my calendar."
            a="Hard-refresh the Calendar tab (Cmd-Shift-R / Ctrl-Shift-R). If chips still appear after refresh, they're for quotes whose underlying orders were also deleted — those chips disappear after our cascade trigger runs (immediate). Email support@inktracker.app if you need a manual cleanup."
          />
          <Q
            q="My pricing changed in Account but the quote modal shows old numbers."
            a="The pricing engine reloads after every save in Account → Pricing. If a quote you opened before the save still shows old numbers, close and re-open the quote to pick up the fresh config."
          />
        </Section>

        <Section title="Security & data">
          <Q
            q="Where is my data stored?"
            a="Supabase (PostgreSQL) in AWS US regions. Encrypted at rest with AES-256. Each shop is isolated by row-level security at the database layer. Full details on our security page."
          />
          <Q
            q="Do you sell or share my data?"
            a="No. Your data stays inside your shop. Third-party integrations (QuickBooks, garment suppliers) only see what you direct us to send them on your behalf."
          />
          <Q
            q="How do I report a security issue?"
            a="security@inktracker.app — we acknowledge within 48 hours. See our security page for more on what we cover and what we don't yet."
          />
        </Section>

        <section className="text-center pt-2">
          <a href="/security" className="text-sm font-semibold text-teal-600 hover:underline">
            Full security & trust details →
          </a>
        </section>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Q({ q, a }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-semibold text-slate-800">{q}</div>
      <div className="text-sm text-slate-600 leading-relaxed">{a}</div>
    </div>
  );
}
