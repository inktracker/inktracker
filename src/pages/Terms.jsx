export default function Terms() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-6">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-200 p-8 space-y-6">
        <h1 className="text-3xl font-bold text-slate-900">Terms of Service</h1>
        <p className="text-sm text-slate-500">Last updated: May 13, 2026</p>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">1. Acceptance of Terms</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            By using InkTracker, you agree to these Terms of Service. If you do not agree, do not
            use the application. InkTracker is operated by Biota MFG, a business based in Reno,
            Nevada, USA. These Terms are governed by the laws of the State of Nevada.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">2. Description of Service</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            InkTracker is a print shop management platform that helps screen printers manage quotes,
            orders, production, invoicing, and customer relationships. The platform integrates with
            third-party services including QuickBooks, Shopify, Stripe, and garment suppliers.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">3. Accounts & Subscriptions</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            You are responsible for maintaining the confidentiality of your account credentials and
            for all activity that occurs under your account. InkTracker offers subscription plans
            billed monthly via Stripe. You may cancel your subscription at any time through the
            Account settings page. Upon cancellation, your account will remain accessible in
            read-only mode until the end of the billing period.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">4. Free Trial</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            New accounts receive a 14-day free trial with full access to all features. No credit
            card is required to start a trial. At the end of the trial, you must select a paid plan
            to continue using InkTracker. If you do not subscribe, your account will enter read-only
            mode.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">5. Third-Party Integrations</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            InkTracker integrates with QuickBooks, Shopify, Stripe, and garment suppliers. By
            connecting these services, you authorize InkTracker to act on your behalf within the
            scope of those integrations. Use of those services is also subject to their respective
            terms of service.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">6. Your Data</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            You retain ownership of all data you enter into InkTracker. We do not claim any
            ownership over your business data. Each shop's data is isolated and inaccessible to
            other users. See our{" "}
            <a href="/privacy" className="text-indigo-600 underline">Privacy Policy</a>{" "}
            for details on how we handle your data.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">7. Acceptable Use</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            You agree to use InkTracker only for lawful business purposes. You may not misuse,
            reverse engineer, or attempt to gain unauthorized access to any part of the service or
            other users' data.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">8. Limitation of Liability</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            InkTracker is not liable for any indirect, incidental, or consequential damages arising
            from your use of the service. The service is provided "as is" without warranties of any
            kind. We are not responsible for the accuracy of data synced from third-party services.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">9. Termination</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            We reserve the right to suspend or terminate accounts that violate these terms. You may
            cancel your account at any time from the Account settings page or by contacting{" "}
            <a href="mailto:support@inktracker.app" className="text-indigo-600 underline">
              support@inktracker.app
            </a>.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">10. Changes to Terms</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            We may update these terms from time to time. Continued use of the service after changes
            constitutes acceptance of the updated terms.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">11. Contact</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Questions about these terms? Contact us at{" "}
            <a href="mailto:support@inktracker.app" className="text-indigo-600 underline">
              support@inktracker.app
            </a>.
          </p>
        </section>
      </div>
    </div>
  );
}
