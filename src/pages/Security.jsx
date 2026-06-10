// Public trust & security page. Honest about what we do today and what we don't.
// If something here changes, update it. Don't claim certifications we don't have.

export default function Security() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-6">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-200 p-8 space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold text-slate-900">Security & Trust</h1>
          <p className="text-sm text-slate-500">
            Plain-English description of how we protect your shop's data. We update this page when
            anything material changes.
          </p>
          <p className="text-xs text-slate-400">Last updated: May 30, 2026</p>
        </header>

        <Section title="QuickBooks integration">
          <p>
            Connecting QuickBooks is the highest-trust thing you do in InkTracker —
            you're letting us read and write to your books. Here's exactly how we
            handle that:
          </p>
          <ul className="list-disc list-outside ml-5 mt-2 space-y-1.5">
            <li>
              <strong>Tokens are server-side only.</strong> Your QuickBooks access
              and refresh tokens live in a service-role-only table. They are never
              sent to your browser, never appear in network traffic, and are
              inaccessible to your own users' API queries.
            </li>
            <li>
              <strong>Every action is auditable.</strong> Every operation we
              perform against QuickBooks — create invoice, send payment link,
              receive paid webhook, nightly reconciliation — writes one row to a
              per-shop event log. Open any quote → QuickBooks → Events to see the
              full timeline.
            </li>
            <li>
              <strong>No duplicate invoices.</strong> Every create-invoice
              attempt carries an idempotency key. A double-click, network
              retry, or mid-flight crash collapses to a single QuickBooks
              write — never two.
            </li>
            <li>
              <strong>Webhook signatures are verified.</strong> Inbound webhook
              payloads from Intuit are HMAC-SHA256 verified with constant-time
              comparison. Nobody can forge a "this invoice was paid" event.
            </li>
            <li>
              <strong>Tenant isolation is hard-coded.</strong> QuickBooks invoice
              IDs are realm-scoped, not globally unique — two shops can each
              have an invoice "1042". Every lookup is scoped by both the
              invoice ID and the shop owner. The webhook handler rejects
              cross-tenant matches by construction.
            </li>
            <li>
              <strong>Nightly reconciliation.</strong> Every night we re-read
              each linked invoice from QuickBooks and reconcile against
              InkTracker. Missed webhooks are caught and converted; totals
              drift triggers a notification.
            </li>
            <li>
              <strong>One-click disconnect.</strong> Disconnecting clears your
              tokens immediately. We also recommend revoking InkTracker from
              the QuickBooks side (Settings → Apps) for defense in depth.
            </li>
            <li>
              <strong>We don't touch payment instruments.</strong> Customer
              card and bank info stays inside QuickBooks Payments — we never
              receive it.
            </li>
          </ul>
        </Section>

        <Section title="Where your data lives">
          <p>
            InkTracker runs on Supabase (PostgreSQL) hosted in AWS US regions. The web app is served
            from Vercel's global edge. All traffic between your browser, our app, and the database is
            encrypted in transit using TLS 1.2+.
          </p>
        </Section>

        <Section title="Data isolation">
          <p>
            Every table that holds shop data uses Postgres row-level security (RLS) policies scoped to
            the shop owner. There is no API endpoint or query that can return another shop's records.
            Even if our application code had a bug, the database itself rejects cross-shop reads.
          </p>
        </Section>

        <Section title="Encryption at rest">
          <p>
            Database storage and file uploads (artwork, logos) are encrypted at rest using AES-256.
            Encryption keys are managed by our infrastructure providers and rotated automatically.
          </p>
        </Section>

        <Section title="Payments & card data">
          <p>
            We do not store credit card numbers, CVVs, or bank account information. All payment
            collection runs through Stripe, which is PCI-DSS Level 1 certified. Card data is entered
            directly into Stripe's secure fields and never touches our servers.
          </p>
        </Section>

        <Section title="Other third-party integrations">
          <p>
            For garment suppliers (S&S Activewear, AS Colour), we store an OAuth
            refresh token or API credential so we can act on your behalf. These credentials are
            stored encrypted, scoped to your shop, and never shared. Disconnect any integration at
            any time from the Account page — it immediately revokes our access.
          </p>
        </Section>

        <Section title="Authentication">
          <p>
            We use Supabase Auth for sign-in. Passwords are hashed with industry-standard
            password-hashing (currently scrypt); we never see your password. Email-based magic-link
            login is supported. Two-factor authentication is available — enable an email sign-in
            code under Account → Security, with single-use recovery links and per-device
            30-day trust.
          </p>
        </Section>

        <Section title="Backups & recovery">
          <p>
            The Postgres database is backed up daily by Supabase with point-in-time recovery for the
            past 7 days. Backups are stored encrypted in a separate region.
          </p>
        </Section>

        <Section title="Access controls">
          <p>
            Only a small number of named operators have production database access, and only for the
            purpose of investigating customer-reported issues. We log every administrative query.
          </p>
        </Section>

        <Section title="Data ownership & export">
          <p>
            Your data is yours. You can export your customers, quotes, orders, and invoices to CSV at
            any time. If you cancel your account, we delete your data within 30 days unless you ask
            us to retain it. Email{" "}
            <a href="mailto:support@inktracker.app" className="text-teal-600 underline">
              support@inktracker.app
            </a>{" "}
            to request deletion or export.
          </p>
        </Section>

        <Section title="What we don't have yet">
          <p>
            We want to be straight about this: we are a small team and have not yet completed a
            formal SOC 2 audit. We are working toward it. If your business requires a SOC 2 report
            today, we are not the right fit yet — and we'd rather tell you that than ship a misleading
            badge.
          </p>
        </Section>

        <Section title="Reporting a vulnerability">
          <p>
            If you believe you've found a security issue, please email{" "}
            <a href="mailto:security@inktracker.app" className="text-teal-600 underline">
              security@inktracker.app
            </a>{" "}
            with details. We will acknowledge within 48 hours. We do not currently run a paid bug
            bounty, but we will publicly thank you (with permission) and treat you well.
          </p>
        </Section>

        <Section title="Questions">
          <p>
            For any security or compliance question — including help responding to your customers'
            vendor security reviews —{" "}
            <a href="mailto:security@inktracker.app" className="text-teal-600 underline">
              security@inktracker.app
            </a>
            .
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
      <div className="text-sm text-slate-600 leading-relaxed">{children}</div>
    </section>
  );
}
