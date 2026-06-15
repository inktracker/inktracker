# Terms of Service — Attorney Review Handoff

The Terms at `/terms` (src/pages/Terms.jsx) were expanded from a thin v1
to a complete draft on 2026-06-14. This is a **first draft in standard
SaaS shape**, not reviewed by counsel. Below is what changed and the
specific items a Nevada-qualified attorney should verify before InkTracker
charges paying customers.

## Context
- Entity: **Biota LLC** (Nevada LLC), DBA **Biota MFG**. Product: InkTracker.
- B2B SaaS, US-based, sole plan $99/mo + 14-day trial.
- The app reads/writes customers' **QuickBooks** (invoices, payments) and
  handles customer-uploaded **artwork** for screen printing — the two
  biggest liability surfaces.

## What was added/changed (gaps closed)
1. **§4 Fees, Billing & Refunds** — auto-renewal disclosure, no-refund
   policy, 30-day price-change notice. *Verify auto-renew disclosure meets
   any applicable auto-renewal law (some states require specific notice).*
2. **§6 Your Data & Your Content** — content ownership stays with the
   shop; limited license to us to operate; **customer warrants they hold
   rights to uploaded artwork** (key for a print shop).
3. **§7 Acceptable Use** — expanded (IP infringement, scraping, cross-tenant
   access).
4. **§8 Copyright / DMCA** — safe-harbor notice procedure + designated
   agent (security@inktracker.app). **ACTION: register the DMCA designated
   agent at copyright.gov (~$6) to actually get safe-harbor protection.**
5. **§9 Disclaimers** — "as is," and explicitly **"not accounting, tax, or
   legal advice"** + shop responsible for its own books/taxes (covers the
   QuickBooks-write exposure).
6. **§10 Indemnification** — user indemnifies Biota LLC, incl. artwork IP
   claims.
7. **§11 Limitation of Liability** — was the biggest gap: v1 only excluded
   indirect damages with **no cap**. Now caps total liability at fees paid
   in prior 12 months (or $100). *Verify enforceability + that the cap
   floor/structure holds in Nevada.*
8. **§13 Governing Law & Dispute Resolution** — Nevada law, Washoe County
   venue, **binding arbitration + class-action waiver**. *This is the
   section most worth a lawyer's eyes — arbitration/class-waiver
   enforceability is fact- and jurisdiction-specific; the arbitration body
   and rules should be named specifically (e.g., AAA/JAMS) and consumer
   carve-outs confirmed.*
9. **§14 Changes** — added material-change notice commitment.

## Top review priorities
- Limitation-of-liability cap (enforceability + interaction with the
  indemnification and disclaimer sections).
- Arbitration clause + class-action waiver (name the administrator/rules;
  confirm enforceable for B2B in NV).
- Auto-renewal disclosure compliance.
- Whether Biota LLC vs a separate InkTracker subsidiary should be the
  contracting entity (liability separation between the print shop and the
  SaaS — see project notes).
- DMCA agent registration (an action, not drafting).

## Companion
Privacy Policy (`/privacy`) already revised for accuracy (2026-06-10). The
72-hour breach-notification and data-deletion commitments there are also
contract terms worth a glance.
