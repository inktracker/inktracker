// ─────────────────────────────────────────────────────────────────────────
// ATTORNEY REVIEW PENDING (drafted 2026-06-14).
// These Terms were expanded from a thin v1 to close real gaps: liability
// cap, content/IP warranty, indemnification, DMCA safe harbor, disclaimers
// (incl. "not accounting/tax advice"), refunds, and governing-law/venue/
// dispute resolution. They are a strong first draft in standard SaaS shape
// — NOT a substitute for a licensed attorney's review. Before charging
// paying customers, have a Nevada-qualified attorney verify enforceability
// (esp. the liability cap, arbitration, and class-action waiver) and file
// the DMCA designated-agent registration ($6, copyright.gov). See
// docs/legal-review-notes.md for the reviewer handoff.
// ─────────────────────────────────────────────────────────────────────────

export default function Terms() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-6">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-200 p-8 space-y-6">
        <h1 className="text-3xl font-bold text-slate-900">Terms of Service</h1>
        <p className="text-sm text-slate-500">Last updated: June 14, 2026</p>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">1. Acceptance of Terms</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            By accessing or using InkTracker, you agree to these Terms of Service. If you do not
            agree, do not use the application. InkTracker is a product of Biota LLC (doing business
            as Biota MFG), a Nevada limited liability company based in Reno, Nevada, USA ("we,"
            "us," or "InkTracker"). These Terms are a contract between you and Biota LLC. You
            represent that you are at least 18 years old and are using InkTracker for business
            purposes, and that you have authority to bind any business on whose behalf you use it.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">2. Description of Service</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            InkTracker is a print shop management platform that helps decorators manage quotes,
            orders, production, invoicing, and customer relationships. The platform integrates with
            third-party services including QuickBooks, Stripe, and garment suppliers. We may add,
            change, or remove features at any time.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">3. Accounts &amp; Eligibility</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            You are responsible for maintaining the confidentiality of your account credentials and
            for all activity that occurs under your account. You agree to provide accurate
            information and to keep it current. You are responsible for your team members' use of
            the account, including any managers or employees you invite.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">4. Fees, Billing &amp; Refunds</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            New accounts receive a 14-day free trial with full access; no credit card is required to
            start. After the trial, continued use requires a paid subscription, billed monthly in
            advance through Stripe. Subscriptions renew automatically each billing period until
            cancelled. You may cancel anytime from the Account settings page; cancellation stops
            future renewals and your account remains accessible through the end of the period you
            have already paid for, after which it enters read-only mode.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            Except where required by law, fees are non-refundable and we do not provide refunds or
            credits for partial periods, unused time, or features not used. We may change pricing
            with at least 30 days' notice; changes take effect on your next billing period.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">5. Third-Party Integrations</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            InkTracker integrates with QuickBooks, Stripe, and garment suppliers. By connecting
            these services, you authorize InkTracker to access and act within the scope of those
            integrations on your behalf. Your use of those services is also governed by their own
            terms. We are not responsible for third-party services, their availability, or the
            accuracy of data they return, and we are not liable for actions you direct us to take
            within them (for example, creating an invoice in your QuickBooks account).
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">6. Your Data &amp; Your Content</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            You retain ownership of all data and content you upload to InkTracker, including artwork,
            logos, customer records, quotes, and orders ("Your Content"). We claim no ownership of
            Your Content. You grant us a limited, non-exclusive license to host, store, process,
            transmit, and display Your Content solely to operate and provide the service to you
            (including generating proofs, sending quote and invoice emails at your direction, and
            syncing to services you connect).
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            <span className="font-semibold">You are solely responsible for Your Content.</span> You
            represent and warrant that you own or have all necessary rights, licenses, and
            permissions to the artwork and other materials you upload or have us print or transmit,
            and that they do not infringe any copyright, trademark, or other intellectual-property
            right or violate any law. InkTracker does not pre-screen Your Content and is not
            responsible for verifying that you hold rights to it. Each shop's data is isolated and
            inaccessible to other shops; see our{" "}
            <a href="/privacy" className="text-teal-600 underline">Privacy Policy</a> for details.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">7. Acceptable Use</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            You agree to use InkTracker only for lawful business purposes. You may not: upload
            content you lack the rights to; infringe others' intellectual property; misuse, reverse
            engineer, scrape, or overload the service; attempt to access another shop's data or any
            part of the system you are not authorized to use; or use the service to send unlawful or
            unsolicited communications. We may suspend or remove content or accounts that violate
            this section.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">8. Copyright &amp; DMCA</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            We respect intellectual-property rights and respond to clear notices of alleged
            infringement under the Digital Millennium Copyright Act (DMCA). If you believe content on
            InkTracker infringes your copyright, send a written notice with the information the DMCA
            requires (identification of the work, the infringing material and its location, your
            contact information, a good-faith statement, and a statement under penalty of perjury
            that you are authorized to act) to our designated agent at{" "}
            <a href="mailto:security@inktracker.app" className="text-teal-600 underline">
              security@inktracker.app
            </a>. We will remove or disable access to infringing material and may terminate repeat
            infringers' accounts.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">9. Disclaimers</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND,
            EXPRESS OR IMPLIED, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
            PARTICULAR PURPOSE, AND NON-INFRINGEMENT. We do not warrant that the service will be
            uninterrupted, error-free, or secure, or that data synced from third parties is accurate.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            <span className="font-semibold">InkTracker is a workflow tool, not accounting, tax, or
            legal advice.</span> Pricing calculations, invoices, tax amounts, and figures synced to
            or from QuickBooks are aids, not professional advice. You are responsible for reviewing
            your own books, invoices, pricing, and tax obligations and for their accuracy. We are
            not responsible for business decisions you make using the service.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">10. Indemnification</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            You agree to defend, indemnify, and hold harmless Biota LLC and its members, officers,
            and employees from any claims, damages, liabilities, and expenses (including reasonable
            attorneys' fees) arising out of or related to: Your Content (including any claim that
            artwork you uploaded or had printed infringes a third party's rights); your use of the
            service; your violation of these Terms; or your violation of any law or the rights of a
            third party.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">11. Limitation of Liability</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, INKTRACKER WILL NOT BE LIABLE FOR ANY INDIRECT,
            INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR ANY LOST PROFITS,
            REVENUE, DATA, OR GOODWILL, ARISING FROM OR RELATED TO THE SERVICE — even if we have been
            advised of the possibility.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL AGGREGATE LIABILITY FOR ALL CLAIMS
            ARISING FROM OR RELATED TO THE SERVICE WILL NOT EXCEED THE GREATER OF (A) THE TOTAL
            SUBSCRIPTION FEES YOU PAID US IN THE TWELVE (12) MONTHS BEFORE THE EVENT GIVING RISE TO
            THE CLAIM, OR (B) ONE HUNDRED U.S. DOLLARS ($100). These limits apply in the aggregate
            and do not reset per claim. Some jurisdictions do not allow certain limitations, so parts
            of this section may not apply to you.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">12. Termination</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            We may suspend or terminate accounts that violate these Terms. You may cancel your
            account at any time from the Account settings page or by contacting{" "}
            <a href="mailto:support@inktracker.app" className="text-teal-600 underline">
              support@inktracker.app
            </a>. You can export your data before cancelling; after termination we retain and delete
            data as described in the{" "}
            <a href="/privacy" className="text-teal-600 underline">Privacy Policy</a>. Sections that
            by their nature should survive termination (including Content ownership, Disclaimers,
            Indemnification, Limitation of Liability, and Dispute Resolution) will survive.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">13. Governing Law &amp; Dispute Resolution</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            These Terms are governed by the laws of the State of Nevada, without regard to its
            conflict-of-laws rules. You and Biota LLC agree that the exclusive venue for any dispute
            that is not subject to arbitration will be the state or federal courts located in Washoe
            County, Nevada, and you consent to their jurisdiction.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            Any dispute arising out of or relating to these Terms or the service will be resolved by
            binding individual arbitration administered under the rules of a recognized arbitration
            body, rather than in court, except that either party may bring an individual claim in
            small-claims court or seek injunctive relief for misuse of intellectual property.{" "}
            <span className="font-semibold">You and Biota LLC agree to bring claims only in an
            individual capacity, and not as a plaintiff or class member in any class or
            representative action.</span>
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">14. Changes to Terms</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            We may update these Terms from time to time. For material changes we will provide notice
            by email or an in-app notice before they take effect. Continued use of the service after
            changes become effective constitutes acceptance of the updated Terms.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">15. Contact</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Questions about these Terms? Contact Biota LLC at{" "}
            <a href="mailto:support@inktracker.app" className="text-teal-600 underline">
              support@inktracker.app
            </a>.
          </p>
        </section>
      </div>
    </div>
  );
}
