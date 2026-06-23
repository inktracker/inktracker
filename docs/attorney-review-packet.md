# InkTracker — Legal Review Packet (Terms of Service & Privacy Policy)

> Prepared for a flat-fee attorney review. A self-review pass on **2026-06-16**
> revised both documents to close known gaps; we now want a licensed
> **Nevada attorney** to confirm enforceability and catch anything we missed.
>
> **Full current (canonical) text:**
> - Terms: https://inktracker.app/terms (Last updated 2026-06-16)
> - Privacy: https://inktracker.app/privacy (Last updated 2026-06-16)
>
> Drafted in-house; **not yet reviewed by counsel.**

---

## 1. Cover memo / context

- **Company:** Biota LLC, a Nevada LLC based in Reno, NV. DBA **Biota MFG**. **Product:** InkTracker.
- **What it is:** B2B SaaS — print-shop management (quotes, orders, production, invoicing). Single plan **$99/mo, 14-day free trial, no card to start.** Subscription billing via **Stripe**.
- **Two biggest liability surfaces:**
  1. **QuickBooks writes** — InkTracker creates/updates invoices, customers, and payments in the *customer's* QuickBooks; their end clients pay via **QuickBooks Payments** (shop is merchant of record; card data never touches our servers).
  2. **User-uploaded artwork** — we host/display/print customer-supplied designs (IP-infringement exposure).
- **Status:** invite-only testing with real shops doing real QuickBooks invoices. Not yet charging.
- **Structural fact:** Biota LLC operates **both** the print shop (Biota MFG) **and** the SaaS (InkTracker) — one entity.

## 2. Priority questions for you

1. **Liability cap (§11)** — enforceable in Nevada? We added carve-outs (indemnity, confidentiality, IP, fees owed, non-waivable liability). Are they sufficient / correctly scoped?
2. **Arbitration + class waiver (§13)** — we named AAA (Commercial Rules), referenced the FAA, added a 30-day opt-out and a class-waiver severance "poison pill," and a Washoe County / videoconference seat. Enforceable as drafted for B2B? Concerns if some users are sole proprietors (consumers)?
3. **Auto-renewal (§4)** — does the disclosure/affirmative-consent/cancellation language meet applicable auto-renewal laws? Do we need renewal reminders?
4. **§14 General / boilerplate** — severability, entire agreement, assignment, force majeure, waiver, notices, no third-party beneficiaries: anything missing or mis-scoped?
5. **Entity structure** — should InkTracker contract through a **separate entity** rather than Biota LLC (which also runs the print shop)?
6. **Privacy** — is the deletion-vs-legal-retention carve-out (§6) adequate? Is the §8 state-privacy-rights / processor-vs-controller language sufficient (CCPA/CPRA + other states)?
7. **DMCA** — confirm we must **register a designated agent** (copyright.gov, ~$6) for the §8 safe harbor to apply.
8. **Defect liability** — how far can we enforceably disclaim liability for our own software defects/negligence, given we write to customers' financial records?

## 3. What we already revised on 2026-06-16 (please confirm sufficiency)

- **§11 cap carve-outs** added (indemnity / confidentiality / IP / fees owed / non-waivable).
- **§14 General** added — severability, entire agreement, assignment, force majeure, waiver, notices, no third-party beneficiaries (renumbered Changes→15, Contact→16).
- **§13 arbitration** rewritten — FAA, AAA Commercial Rules, single arbitrator, Washoe/videoconference seat, fee allocation, **30-day opt-out**, and class-waiver poison pill.
- **§4 auto-renewal** strengthened — explicit authorization-to-charge + easy cancellation language.
- **§2 / §5 accuracy** — clarified shops connect **QuickBooks** (and QB Payments) and suppliers; **Stripe is only our subscription billing** (shops don't connect Stripe).
- **§6 content license** — added sub-processors, backups, and aggregated/de-identified data rights.
- **Privacy §6** — deletion now carves out legally/operationally required retention.
- **Privacy §8 (new)** — CCPA/CPRA + other-state rights, "we don't sell/share," and processor-vs-controller (shops are controllers of their end-customers' data).
- **Privacy §5** — named sub-processors (Supabase, Vercel, Resend, Stripe, Intuit).

## 4. Still open — your judgment / our action

- **Entity separation** (Biota LLC vs. a dedicated InkTracker entity) — strategic, your view.
- **DMCA designated-agent registration** — our action (~$6, copyright.gov).
- **Mutual IP indemnity** — currently one-way (user → us); B2B customers may request we indemnify them for our own IP infringement. Decision, not a defect.
- **Beta/early-access disclaimer** — not added; advise if warranted during live testing.
- **Renewal reminders / consumer auto-renewal edge cases** — pending your read on #3.

## 5. Standing security/privacy commitments (also contract terms)

Privacy §4a commits to **72-hour breach notification** and §6 to **30-day deletion** — both stricter than baseline US law and self-imposed. Worth your glance for exposure; we are operationally responsible for meeting them.
