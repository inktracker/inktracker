export default function Privacy() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-6">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-200 p-8 space-y-6">
        <h1 className="text-3xl font-bold text-slate-900">Privacy Policy</h1>
        <p className="text-sm text-slate-500">Last updated: April 10, 2025</p>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">1. Who We Are</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            InkTracker is a business management application operated by Biota Mfg. If you have
            questions about this policy, contact us at{" "}
            <a href="mailto:joe@biotamfg.co" className="text-indigo-600 underline">
              joe@biotamfg.co
            </a>
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">2. Information We Collect</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            We collect information you provide directly, including your name, email address, business
            name, and any data you enter into the application (quotes, orders, customer records,
            expenses). We also collect authentication credentials necessary to connect third-party
            services such as QuickBooks and S&S Activewear on your behalf.
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
            <li>Connecting to S&S Activewear to look up products and place orders on your behalf</li>
            <li>Sending quote and invoice emails to your customers at your direction</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">4. QuickBooks Data</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            When you connect your QuickBooks account, we store OAuth tokens necessary to access your
            QuickBooks data on your behalf. We use this access only to create invoices, sync
            expenses, and retrieve payment status as directed by you. We do not share your QuickBooks
            data with any third parties. You may disconnect QuickBooks at any time from the Account
            settings page, which revokes our access.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">5. Data Storage</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Your data is stored securely using Supabase, a managed database platform. Data is
            encrypted in transit and at rest. We do not sell your data to any third party.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">6. Data Retention</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            We retain your data for as long as your account is active. You may request deletion of
            your account and associated data at any time by contacting{" "}
            <a href="mailto:joe@biotamfg.co" className="text-indigo-600 underline">
              joe@biotamfg.co
            </a>
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">7. Changes to This Policy</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            We may update this policy from time to time. We will notify you of significant changes by
            email or by posting a notice in the application.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">8. Contact</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            For any privacy-related questions or requests, contact us at{" "}
            <a href="mailto:joe@biotamfg.co" className="text-indigo-600 underline">
              joe@biotamfg.co
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
