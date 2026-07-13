import { usePageMeta } from "@/lib/seo/usePageMeta";

export default function Privacy() {
  usePageMeta({ title: "Privacy Policy — InkTracker", path: "/privacy" });
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-6">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-200 p-8 space-y-6">
        <h1 className="text-3xl font-bold text-slate-900">Privacy Policy</h1>
        <p className="text-sm text-slate-500">Last updated: June 16, 2026</p>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">1. Who We Are</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            InkTracker is a print shop management platform. If you have questions about this policy,
            contact us at{" "}
            <a href="mailto:support@inktracker.app" className="text-teal-600 underline">
              support@inktracker.app
            </a>.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">2. Information We Collect</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            We collect information you provide directly, including your name, email address, business
            name, and any data you enter into the application (quotes, orders, customer records,
            expenses, artwork files). We also collect authentication credentials necessary to connect
            third-party services such as QuickBooks and garment suppliers on your behalf.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">3. How We Use Your Information</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            We use your information solely to operate and improve InkTracker. This includes:
          </p>
          <ul className="list-disc list-inside text-sm text-slate-600 space-y-1 pl-2">
            <li>Providing access to your quotes, orders, and business data</li>
            <li>Connecting to QuickBooks to sync invoices and payments on your behalf</li>
            <li>Connecting to garment suppliers (S&amp;S Activewear, AS Colour) to look up products and pricing</li>
            <li>Sending quote, invoice, and message emails to your customers at your direction via Resend, our email delivery provider</li>
            <li>Processing subscription payments via Stripe</li>
            <li>Processing customer quote payments through your connected QuickBooks Payments account — your shop is the merchant of record</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">4. Third-Party Integrations</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            When you connect third-party accounts (QuickBooks, Gmail), we store the OAuth
            tokens necessary to access those services on your behalf. We use this access only as
            directed by you. We do not share your third-party data with anyone. You may disconnect
            any integration at any time from the Account settings page, which revokes our access.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            Customer email addresses you enter into the platform are transmitted to Resend (our email
            delivery provider) when you send a quote, invoice, or reply. We do not retain any third-party
            access beyond what is necessary to provide these features.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">4a. QuickBooks Data Handling</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Because QuickBooks is the most sensitive integration we offer, this section spells out
            exactly how we handle your QuickBooks data — what we request, where it lives, and how
            you can revoke it.
          </p>
          <ul className="list-disc list-outside text-sm text-slate-600 space-y-1.5 pl-5">
            <li>
              <strong>What we request.</strong> We request the OAuth scopes
              <span className="font-mono mx-1">com.intuit.quickbooks.accounting</span>
              and
              <span className="font-mono mx-1">com.intuit.quickbooks.payment</span>
              from Intuit. These permissions let us create and update invoices, customers, and
              payments on your behalf, and surface customer-facing QuickBooks payment links so your
              clients can pay an invoice from a quote email. We do not request scopes we do not use.
            </li>
            <li>
              <strong>Where tokens live.</strong> Your QuickBooks access token, refresh token, and
              realm ID are stored in a dedicated, service-role-only table inside our database. They
              are never sent to your browser, never appear in network traffic visible to your users,
              and never appear in any client-side code or log. Tokens are encrypted at rest by our
              infrastructure provider.
            </li>
            <li>
              <strong>What you can see we did.</strong> Every action InkTracker takes against your
              QuickBooks account — create invoice, send payment link, receive a paid webhook, run our
              nightly reconciliation — writes one row to a per-shop event log. Open any quote →
              QuickBooks → Events to see the full timeline, including the request and response we
              exchanged with Intuit.
            </li>
            <li>
              <strong>Webhook signatures.</strong> When Intuit notifies us that a payment landed or
              an invoice changed, we cryptographically verify the request came from Intuit using
              HMAC-SHA256 with a constant-time comparison. We refuse any inbound webhook that fails
              verification.
            </li>
            <li>
              <strong>Tenant isolation.</strong> QuickBooks invoice IDs are scoped to your realm,
              not globally unique across Intuit's customer base. Every lookup we perform against a
              QuickBooks payload is scoped by both invoice ID and your shop. We never match an
              inbound event to a quote that doesn't belong to your shop.
            </li>
            <li>
              <strong>Disconnect.</strong> You can disconnect QuickBooks from Account → QuickBooks →
              Disconnect at any time. Disconnecting clears your tokens from our database immediately.
              We recommend also revoking InkTracker from inside QuickBooks (Settings → Apps) as a
              second layer of defense — that severs Intuit's side of the trust as well.
            </li>
            <li>
              <strong>Payment instruments.</strong> Customer card numbers, ACH details, and bank
              account information never touch InkTracker's servers. Those stay inside QuickBooks
              Payments, which is PCI-DSS Level 1 certified through Intuit.
            </li>
            <li>
              <strong>If we have an incident.</strong> If we become aware of unauthorized access
              affecting your QuickBooks data, we will notify you by email within 72 hours of
              confirming the scope and recommend that you immediately revoke our QuickBooks
              connection from Intuit's side. Our written incident-response plan is available on
              request to enterprise customers.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">5. Data Storage & Security</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Your data is stored securely using industry-standard infrastructure. Data is encrypted in
            transit and at rest. Each shop's data is isolated using row-level security policies — no
            other shop can access your data. We do not sell your data to any third party.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            We rely on a small set of trusted service providers (sub-processors) to operate
            InkTracker — including cloud hosting and database (Supabase, Vercel), email delivery
            (Resend), subscription billing (Stripe), and the integrations you connect (e.g.,
            Intuit / QuickBooks). They process data only to provide their service to us.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">6. Data Retention</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            We retain your data for as long as your account is active. On cancellation, your data
            remains available in a read-only state until the end of your billing period. You may
            request deletion of your account and all associated data at any time — verified
            deletion requests are completed within 30 days. We may retain limited information after a
            deletion request where retention is required by law or for legitimate business purposes
            (such as tax, accounting, security, fraud-prevention, or dispute-resolution records); we
            delete or de-identify the remainder. Contact{" "}
            <a href="mailto:support@inktracker.app" className="text-teal-600 underline">
              support@inktracker.app
            </a>.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">7. Cookies & Analytics</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            We use essential cookies for authentication and session management. We do not use
            third-party tracking or advertising cookies.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">8. Your Privacy Rights</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Depending on where you live (for example, California under the CCPA/CPRA, and similar laws
            in other U.S. states), you may have the right to access, correct, or delete the personal
            information we hold about you, to receive a copy of it, and to not be discriminated
            against for exercising these rights. <span className="font-semibold">We do not sell your
            personal information, and we do not "share" it for cross-context behavioral advertising</span>
            {" "}as those terms are defined under California law. To exercise a right, email{" "}
            <a href="mailto:support@inktracker.app" className="text-teal-600 underline">support@inktracker.app</a>;
            we will verify your request and respond within the time required by law.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            If you are an end customer of a shop that uses InkTracker (for example, you received a
            quote or invoice), that shop controls your data and InkTracker processes it on the shop's
            behalf. Please direct access or deletion requests to the shop; we will assist the shop in
            responding.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">9. Changes to This Policy</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            We may update this policy from time to time. We will notify you of significant changes by
            email or by posting a notice in the application.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">10. Contact</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            InkTracker is operated by Biota LLC (doing business as Biota MFG), a Nevada limited liability company based in Reno, Nevada, USA.
            For any privacy-related questions or requests, contact us at{" "}
            <a href="mailto:support@inktracker.app" className="text-teal-600 underline">
              support@inktracker.app
            </a>.
          </p>
        </section>
      </div>
    </div>
  );
}
