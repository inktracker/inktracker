export default function Privacy() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-6">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-200 p-8 space-y-6">
        <h1 className="text-3xl font-bold text-slate-900">Privacy Policy</h1>
        <p className="text-sm text-slate-500">Last updated: May 1, 2026</p>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">1. Who We Are</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            InkTracker is a print shop management platform. If you have questions about this policy,
            contact us at{" "}
            <a href="mailto:support@inktracker.app" className="text-indigo-600 underline">
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
            third-party services such as QuickBooks, Shopify, and garment suppliers on your behalf.
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
            <li>Connecting to garment suppliers to look up products and pricing</li>
            <li>Sending quote and invoice emails to your customers at your direction</li>
            <li>Processing subscription payments via Stripe</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">4. Third-Party Integrations</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            When you connect third-party accounts (QuickBooks, Shopify, etc.), we store OAuth tokens
            necessary to access those services on your behalf. We use this access only as directed by
            you. We do not share your third-party data with anyone. You may disconnect any integration
            at any time from the Account settings page, which revokes our access.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">5. Data Storage & Security</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Your data is stored securely using industry-standard infrastructure. Data is encrypted in
            transit and at rest. Each shop's data is isolated using row-level security policies — no
            other shop can access your data. We do not sell your data to any third party.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">6. Data Retention</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            We retain your data for as long as your account is active. You may request deletion of
            your account and all associated data at any time by contacting{" "}
            <a href="mailto:support@inktracker.app" className="text-indigo-600 underline">
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
          <h2 className="text-lg font-semibold text-slate-800">8. Changes to This Policy</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            We may update this policy from time to time. We will notify you of significant changes by
            email or by posting a notice in the application.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">9. Contact</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            For any privacy-related questions or requests, contact us at{" "}
            <a href="mailto:support@inktracker.app" className="text-indigo-600 underline">
              support@inktracker.app
            </a>.
          </p>
        </section>
      </div>
    </div>
  );
}
