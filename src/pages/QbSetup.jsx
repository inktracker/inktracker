// Public QuickBooks setup guide. Linked from the Account → QuickBooks
// integration tab (both connected and not-connected states) and from the
// tester onboarding packet. Canonical version of
// docs/qb-shop-setup-checklist.md — every item is grounded in what qbSync
// actually requires; if the integration's behavior changes, update both.

function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
      <div className="text-sm text-slate-600 leading-relaxed">{children}</div>
    </section>
  );
}

function Check({ title, children }) {
  return (
    <li className="flex gap-2.5">
      <span className="text-teal-600 font-bold shrink-0 mt-0.5">☐</span>
      <span>
        <strong className="text-slate-800">{title}</strong>{" "}
        {children}
      </span>
    </li>
  );
}

export default function QbSetup() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-6">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-200 p-8 space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold text-slate-900">QuickBooks Setup Checklist</h1>
          <p className="text-sm text-slate-500">
            InkTracker connects to your QuickBooks Online in about three clicks. But a few
            settings inside QBO itself decide whether invoices, payment links, and tax all
            behave the way you expect. Run through this once before (or right after) you
            connect — most items take under a minute.
          </p>
          <p className="text-xs text-slate-400">Last updated: June 10, 2026</p>
        </header>

        <Section title="Before you connect">
          <ul className="space-y-3">
            <Check title="Sign in as the QBO admin, on your real company.">
              The connection needs admin permissions, and there's no guard against
              accidentally connecting an Intuit sandbox/test company — make sure the company
              name in the corner is your actual business. In InkTracker, only the shop owner
              account can connect QuickBooks.
            </Check>
            <Check title="Activate QuickBooks Payments">
              if you haven't: QBO → ⚙ Settings → <strong>Payments</strong> → Get Started.
              Without it, InkTracker still creates invoices fine, but the customer-facing
              "pay this invoice" link never appears — your customer gets an invoice they
              can't pay online. InkTracker enables both card and ACH on every invoice once
              Payments is active.
            </Check>
            <Check title="Set up sales tax in QBO">
              (Taxes → Sales tax → Set up) if you charge it. InkTracker doesn't push a tax
              amount — it marks taxable lines and lets QBO calculate using <em>your</em> tax
              agency setup. No tax setup in QBO means taxable invoices can go out with no
              tax on them.
            </Check>
          </ul>
        </Section>

        <Section title="Clean up your customer list">
          <ul className="space-y-3">
            <Check title="Check customer email addresses.">
              The invoice email goes to the customer's email on file. If it's missing or
              malformed, the invoice is created <em>without</em> an email attached and your
              customer never hears about it — no error, just silence.
            </Check>
            <Check title="Merge duplicate customers that share one email.">
              InkTracker matches your InkTracker customer to QB by email address. If two QB
              customers have the same email, the first match wins — glance through your QB
              customer list for known duplicates before your first send.
            </Check>
            <Check title="Mark tax-exempt customers as non-taxable in QB">
              (customer → Tax info → uncheck "This customer is taxable"). InkTracker reads
              that flag and automatically issues their invoices tax-free, even if the quote
              had a tax rate on it.
            </Check>
          </ul>
        </Section>

        <Section title="Make the invoice look like yours">
          <ul className="space-y-3">
            <Check title="Customize your invoice template:">
              QBO → ⚙ Settings → Custom form styles. The email your customer receives comes
              from QuickBooks with your QBO branding (logo, colors, message wording) — not
              from InkTracker. Send yourself a test invoice from inside QBO if you want to
              see it first.
            </Check>
            <Check title="Confirm your company email and name">
              (⚙ Settings → Account and settings → Company) — that's the identity on the
              invoice emails your customers see.
            </Check>
          </ul>
        </Section>

        <Section title="Things InkTracker handles automatically (nothing to set up)">
          <ul className="list-disc list-outside ml-5 space-y-1.5">
            <li>
              <strong>Items:</strong> InkTracker creates service items in QBO as needed (one
              per decoration technique, plus a default "Custom Apparel"). The only
              requirement is that your chart of accounts has an Income account — every
              established QBO company does; only a brand-new empty company might not.
            </li>
            <li>
              <strong>Customers:</strong> created in QB automatically if no email match
              exists.
            </li>
            <li>
              <strong>Payment detection:</strong> when your customer pays the QB invoice,
              InkTracker marks the quote paid and converts it to an order — usually within a
              minute, worst case by the next morning (nightly reconciliation sweep).
            </li>
          </ul>
        </Section>

        <Section title="After your first invoice — 2-minute sanity check">
          <ol className="list-decimal list-outside ml-5 space-y-1.5">
            <li>
              Create a QB invoice from an InkTracker quote (heads up:{" "}
              <strong>
                QuickBooks emails the customer the moment it's created
              </strong>{" "}
              — use a quote addressed to your own email for this test).
            </li>
            <li>
              In QBO → Sales → Invoices: the invoice is there, numbered with the InkTracker
              quote ID (e.g. <span className="font-mono text-xs">Q-2026-954Z</span>).
            </li>
            <li>
              Open the emailed invoice: the <strong>Pay invoice</strong> button is present
              (that's QB Payments working) and the tax line matches what you expect.
            </li>
            <li>
              Pay it (or record a payment in QBO) → the InkTracker quote flips to paid and
              converts to an order.
            </li>
          </ol>
          <p className="mt-2">
            If anything in that sequence doesn't happen, email{" "}
            <a href="mailto:support@inktracker.app" className="text-teal-600 hover:underline">
              support@inktracker.app
            </a>{" "}
            with the quote number and we'll dig in.
          </p>
        </Section>

        <Section title="One maintenance note">
          <p>
            QuickBooks connections expire after <strong>100 days of no activity</strong>. If
            you don't touch the QB side of InkTracker for 3+ months, the next sync will ask
            you to reconnect — Account → QuickBooks → Reconnect, one OAuth round-trip, no
            data loss.
          </p>
        </Section>

        <footer className="pt-4 border-t border-slate-100 text-xs text-slate-400">
          Questions about how we handle your QuickBooks data?{" "}
          <a href="/security" className="text-teal-600 hover:underline">Security &amp; Trust</a>
          {" · "}
          <a href="/support" className="text-teal-600 hover:underline">Support</a>
        </footer>
      </div>
    </div>
  );
}
