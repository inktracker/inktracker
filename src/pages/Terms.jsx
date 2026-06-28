// ─────────────────────────────────────────────────────────────────────────
// ATTORNEY REVIEW PENDING (drafted 2026-06-14; self-review revisions 2026-06-16).
// 2026-06-16 pass closed self-identified red flags before the attorney review:
// liability-cap carve-outs (§11), a General/boilerplate section incl.
// severability (§14), named-administrator arbitration + FAA + 30-day opt-out +
// class-waiver poison pill (§13), Stripe-vs-QuickBooks accuracy (§2/§5), and a
// sub-processor/de-identified-data license grant (§6). STILL a draft in
// standard SaaS shape — NOT a substitute for a licensed attorney's review.
// Before charging paying customers, have a Nevada-qualified attorney verify
// enforceability (esp. the liability cap + carve-outs, arbitration, and class
// waiver), confirm auto-renewal-law compliance, and file the DMCA designated-
// agent registration ($6, copyright.gov). See docs/attorney-review-packet.md.
// ─────────────────────────────────────────────────────────────────────────

export default function Terms() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-6">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-200 p-8 space-y-6">
        <h1 className="text-3xl font-bold text-slate-900">Terms of Service</h1>
        <p className="text-sm text-slate-500">Last updated: June 16, 2026</p>

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
            QuickBooks (including QuickBooks Payments, used to collect your customers' payments,
            where your shop is the merchant of record) and garment suppliers. We separately use
            Stripe to bill your subscription to us. We may add, change, or remove features at any time.
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
            New accounts receive a 14-day free trial with full access. A valid payment method is
            required to start the trial; you will not be charged until the trial ends, and you can
            cancel any time before then to avoid a charge. After the trial, continued use requires a
            paid subscription, billed monthly in advance through Stripe. <span className="font-semibold">Your subscription renews
            automatically:</span> by starting a paid subscription you authorize us to charge your
            payment method the then-current fee at the start of each billing period until you cancel.
            You may cancel at any time from the Account settings page (or by emailing{" "}
            <a href="mailto:support@inktracker.app" className="text-teal-600 underline">support@inktracker.app</a>);
            cancellation stops future renewals and takes effect at the end of the current paid
            period, after which your account remains accessible in read-only mode.
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
            You connect QuickBooks (including QuickBooks Payments) and garment-supplier accounts to
            InkTracker; by connecting them, you authorize InkTracker to access and act within the
            scope of those integrations on your behalf. We separately use Stripe to process your
            subscription payments to us — you do not connect a Stripe account. Your use of any
            third-party service is also governed by its own terms. We are not responsible for
            third-party services, their availability, or the accuracy of data they return, and we
            are not liable for actions you direct us to take within them (for example, creating an
            invoice in your QuickBooks account).
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
            syncing to services you connect). This license includes the right to use trusted service
            providers (sub-processors) acting on our behalf — such as our hosting, database, and
            email-delivery vendors — and to make backups, in each case to provide the service. We
            may also create and use aggregated or de-identified data that does not identify you or
            any individual to operate, secure, and improve the service.
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
          <p className="text-sm text-slate-600 leading-relaxed">
            The exclusions and limitations above do not apply to: (a) your indemnification
            obligations under Section 10; (b) a party's breach of its confidentiality obligations;
            (c) a party's infringement or misappropriation of the other party's intellectual
            property; (d) amounts you owe us for the service; or (e) any liability that cannot be
            excluded or limited under applicable law (which may include liability for fraud, gross
            negligence, or willful misconduct).
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
            This arbitration agreement is governed by the Federal Arbitration Act. Any dispute
            arising out of or relating to these Terms or the service will be resolved by binding
            individual arbitration administered by the American Arbitration Association (AAA) under
            its Commercial Arbitration Rules, before a single arbitrator, rather than in court. The
            arbitration will take place in Washoe County, Nevada, or by videoconference at the
            parties' election; arbitration fees are governed by the AAA rules, and each party bears
            its own attorneys' fees except as those rules or the arbitrator allow. As exceptions,
            either party may bring an individual claim in small-claims court, and either party may
            seek injunctive or other equitable relief in court to protect its intellectual property
            or confidential information.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            <span className="font-semibold">You and Biota LLC agree to bring claims only in an
            individual capacity, and not as a plaintiff or class member in any class, consolidated,
            or representative action.</span> If this class-action waiver is found unenforceable as to
            a particular claim, then that claim (and only that claim) will be severed and proceed in
            the courts identified above rather than in arbitration.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            <span className="font-semibold">Opt-out.</span> You may opt out of this arbitration
            agreement by emailing{" "}
            <a href="mailto:support@inktracker.app" className="text-teal-600 underline">support@inktracker.app</a>{" "}
            within 30 days of first accepting these Terms, stating your account email and that you
            opt out of arbitration. Opting out does not affect any other provision of these Terms.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">14. General</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            <span className="font-semibold">Severability.</span> If any provision of these Terms is
            held invalid or unenforceable, it will be limited or severed to the minimum extent
            necessary, and the remaining provisions will remain in full force and effect.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            <span className="font-semibold">Entire agreement.</span> These Terms, together with the{" "}
            <a href="/privacy" className="text-teal-600 underline">Privacy Policy</a> and any order or
            pricing page you agree to, are the entire agreement between you and Biota LLC regarding the
            service and supersede all prior agreements on that subject.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            <span className="font-semibold">Assignment.</span> You may not assign or transfer these
            Terms without our prior written consent. We may assign them to an affiliate or in
            connection with a merger, acquisition, reorganization, or sale of assets.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            <span className="font-semibold">Force majeure.</span> Neither party is liable for any
            delay or failure to perform caused by events beyond its reasonable control.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            <span className="font-semibold">Waiver, notices &amp; beneficiaries.</span> Our failure to
            enforce any provision is not a waiver of it. Notices to you may be given by email or
            in-app notice; notices to us must be sent to{" "}
            <a href="mailto:support@inktracker.app" className="text-teal-600 underline">support@inktracker.app</a>.
            These Terms create no third-party beneficiaries.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">15. Changes to Terms</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            We may update these Terms from time to time. For material changes we will provide notice
            by email or an in-app notice before they take effect. Continued use of the service after
            changes become effective constitutes acceptance of the updated Terms.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">16. Contact</h2>
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
