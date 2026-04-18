export default function Terms() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-6">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-200 p-8 space-y-6">
        <h1 className="text-3xl font-bold text-slate-900">Terms of Service</h1>
        <p className="text-sm text-slate-500">Last updated: April 10, 2025</p>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">1. Acceptance of Terms</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            By using InkTracker, operated by Biota Mfg, you agree to these Terms of Service. If you
            do not agree, do not use the application.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">2. Use of the Service</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            InkTracker is a business management tool for print shops and their authorized brokers.
            You agree to use it only for lawful business purposes and not to misuse, reverse
            engineer, or attempt to gain unauthorized access to any part of the service.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">3. Accounts</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            You are responsible for maintaining the confidentiality of your account credentials and
            for all activity that occurs under your account. Notify us immediately at{" "}
            <a href="mailto:joe@biotamfg.co" className="text-indigo-600 underline">
              joe@biotamfg.co
            </a>{" "}
            if you suspect unauthorized access.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">4. Third-Party Integrations</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            InkTracker integrates with QuickBooks and S&S Activewear. By connecting these services,
            you authorize InkTracker to act on your behalf within the scope of those integrations.
            Use of those services is also subject to their respective terms of service.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">5. Your Data</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            You retain ownership of all data you enter into InkTracker. We do not claim any
            ownership over your business data. See our{" "}
            <a href="/privacy" className="text-indigo-600 underline">
              Privacy Policy
            </a>{" "}
            for details on how we handle your data.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">6. Limitation of Liability</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            InkTracker and Biota Mfg are not liable for any indirect, incidental, or consequential
            damages arising from your use of the service. The service is provided "as is" without
            warranties of any kind.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">7. Termination</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            We reserve the right to suspend or terminate accounts that violate these terms. You may
            cancel your account at any time by contacting{" "}
            <a href="mailto:joe@biotamfg.co" className="text-indigo-600 underline">
              joe@biotamfg.co
            </a>
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">8. Changes to Terms</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            We may update these terms from time to time. Continued use of the service after changes
            constitutes acceptance of the updated terms.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">9. Production Terms (Print Orders)</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            <strong>Production tolerance.</strong> Industry-standard spoilage applies. For orders
            short up to 3%, we will issue a credit to your account for the missing quantity,
            applicable to any future order. Defect rates above 3% will be reprinted at no
            additional charge within 7–10 business days.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            <strong>Reporting defects.</strong> Claims must be submitted with photos within 72
            hours of delivery. Approved proofs are final.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            <strong>Returns.</strong> Misprinted garments do not need to be returned — please
            dispose of or donate them. Reprints or credits are issued based on photo evidence.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">10. Contact</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Questions about these terms? Contact us at{" "}
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
