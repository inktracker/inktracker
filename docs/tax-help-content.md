# InkTracker Tax — Help Center Content

**Purpose:** Source content for the in-app help bubble so it can answer every *tax question the software touches*. Written as Q&A the assistant can draw from directly.

**Scope boundary (important — put this in the assistant's system instructions):**
- ANSWER fully: how InkTracker's tax features work, what to click, why a number appears, how to file from our reports. These are product questions.
- DO NOT give tax-law advice: what rate to charge, whether you must collect tax, nexus/registration, taxability of a specific product in a specific state. For those, reply with the general mechanism and: *"InkTracker isn't a tax advisor — for what you're required to collect, check with your accountant or your state's Department of Revenue."*
- Standard disclaimer to append to any tax answer: *"This explains how InkTracker handles tax; it isn't tax advice."*

---

## 0. The one-paragraph model (read first)
InkTracker calculates sales tax one of two ways depending on whether QuickBooks Online is connected. **With QuickBooks connected,** QuickBooks' Automated Sales Tax is the authority — it uses the customer's ship-to address to apply the correct destination-based rate, and InkTracker mirrors that number. **Without QuickBooks,** InkTracker applies a single flat tax rate that you set — it does not look up rates by address, and the customer sees it labeled "Est." (estimated). Either way, you control tax-exempt customers, and (with QuickBooks) every sale is recorded for filing.

---

## 1. How tax is calculated

**Q: How does InkTracker calculate sales tax?**
If QuickBooks is connected, QuickBooks Automated Sales Tax computes it from the customer's ship-to address (correct rate for their location). InkTracker shows and charges that amount. If QuickBooks is not connected, InkTracker applies the flat tax rate you set in Account → Pricing to the taxable part of the quote. *(Not tax advice.)*

**Q: Do I need QuickBooks for tax to work?**
No — tax works without it, but as a single flat rate you set and are responsible for. QuickBooks adds automatic, address-based rates, exemption handling on the invoice, and filing records. If you sell into more than one state, QuickBooks is strongly recommended.

**Q: Where does the tax rate come from when I'm NOT on QuickBooks?**
From the "Tax Rate" you set — a shop default in Account → Pricing, which pre-fills each new quote's rate. You can override the rate on an individual quote. InkTracker does not look up the correct rate for you in this mode.

**Q: Why does the customer's page say "Est. Tax" instead of "Tax"?**
That means QuickBooks isn't the source for this quote, so the tax shown is your flat estimate rather than an address-sourced amount. When QuickBooks is the authority, it shows as "Tax." *(Not tax advice.)*

---

## 2. Setting your tax rate

**Q: Where do I set my default tax rate?**
Account → Pricing → "Tax Rate." It's entered as a percent (e.g. 8.25 = 8.25%) and must be a number between 0 and 100. This becomes the default on new quotes.

**Q: Can I change the tax rate on a single quote?**
Yes — open the quote editor and change its Tax Rate; it only affects that quote. (If QuickBooks is connected, prefer "Calculate tax from QuickBooks" so it matches what QB will bill.)

**Q: I typed a tax rate and it didn't save / showed an error.**
The field only accepts a number between 0 and 100 — no "%" sign or letters. Re-enter it as a plain number (e.g. 7.5).

---

## 3. Tax-exempt customers & resale certificates

**Q: How do I mark a customer as tax-exempt?**
On the customer record, turn on "Tax Exempt" and choose the exemption type (e.g. Resale). You can also store their Tax ID / EIN and upload their exemption certificate. Exempt customers won't be charged sales tax on their quotes/invoices.

**Q: Where do I put a customer's resale / exemption certificate?**
On the customer, upload it in the exemption section. Certificates are stored privately (they contain a tax ID) and are only viewable through a secure, signed link — they are not public.

**Q: Can I set an expiration date on an exemption?**
Yes — exemptions can carry an expiry date (and, for some types, the states they apply to). Once a certificate is expired, InkTracker stops treating the customer as exempt and tax is collected again, so you don't accidentally keep exempting a lapsed certificate. *(Not tax advice — whether a certificate is valid is between you and your customer/state.)*

**Q: I marked someone exempt but they were still charged tax — why?**
Common causes: the exemption expired; the exemption is scoped to certain states and the ship-to state isn't one of them; or the exempt flag was set after the quote's tax was already calculated (recalculate the quote). With QuickBooks connected, InkTracker enforces the exemption on the invoice lines.

**Q: What is the "Tax ID / EIN" field for?**
To store the customer's sales-tax ID / EIN alongside their exemption. It's used for your records and their certificate; it does not itself change the tax calculation.

---

## 4. Ship-to address & multi-state

**Q: Why is InkTracker asking for a ship-to state and ZIP before calculating tax?**
Because QuickBooks needs the destination to source the correct rate. Enter the customer's ship-to state + ZIP, then use "Calculate tax from QuickBooks." Without a complete ship-to, QuickBooks falls back to your shop's location, which may be the wrong rate for an out-of-state customer.

**Q: I sell into multiple states — does InkTracker handle that?**
Only through QuickBooks. With QuickBooks connected and complete ship-to addresses, each order is taxed for its destination. Without QuickBooks, InkTracker uses your one flat rate for everyone, which is not correct for multi-state sales. *(Whether you're required to collect in another state is a nexus question — ask your accountant or that state's Department of Revenue.)*

---

## 5. The "Calculate tax from QuickBooks" button

**Q: What does "Calculate tax from QuickBooks" do?**
It asks QuickBooks for the exact tax it will charge for this quote's line items and ship-to address, and fills that rate into the quote — before you send it. This makes the tax the customer sees on the quote match what the invoice will bill, so there are no surprises at payment.

**Q: It said "Add at least one line item before calculating tax."**
QuickBooks needs items to tax. Add the garments/line items first, then calculate.

**Q: It said "Enter the ship-to state + ZIP…"**
QuickBooks can't source a rate without a destination. Fill in the customer's ship-to state and ZIP, then try again.

**Q: "Tax calculation failed" — what now?**
Usually a QuickBooks connection hiccup or an incomplete address. Check that QuickBooks is still connected (Account → QuickBooks) and the ship-to is complete, then retry. If it persists, you can still send with your manual rate, but the invoice may recompute.

---

## 6. What the customer sees (quote, PDF, payment page)

**Q: Will the tax on the emailed quote/PDF match what the customer actually pays?**
With QuickBooks: yes — especially if you used "Calculate tax from QuickBooks" before sending. Without QuickBooks: the customer sees your flat estimate ("Est."), and that's what the Stripe/checkout total uses.

**Q: The quote total and the QuickBooks invoice total don't match.**
This is what "Calculate tax from QuickBooks" prevents. If you skipped it, the quote used your flat rate and QuickBooks recomputed the real rate. Use the button before sending, or accept QuickBooks' number (see the tax hold below). Note: setup/screen fees and additional charges are now included on the QB invoice, so those no longer cause a mismatch.

---

## 7. The tax "hold" (QuickBooks safety net)

**Q: My invoice is on hold for a tax mismatch — what does that mean?**
InkTracker compared the tax it expected against what QuickBooks calculated and they differ, so it paused rather than charging a wrong amount. You can resolve it by accepting QuickBooks' tax ("Use QuickBooks' tax"), which updates the invoice to QuickBooks' authoritative number and releases the hold. This protects you from over- or under-charging.

**Q: Should I trust InkTracker's number or QuickBooks' number?**
Once QuickBooks is connected, QuickBooks is the authority — accepting its tax is the safe choice. The hold exists precisely so a mismatch never silently reaches the customer.

---

## 8. Taxing shipping and extra charges

**Q: Is shipping / a rush fee / an extra charge taxable?**
Each additional charge has an "Apply sales tax to this charge" toggle. If it's on, the charge is added to the taxed amount; if off, it's added after tax. New additional charges default to taxable. Whether a given charge *should* be taxed depends on your state's rules. *(Taxability of shipping/fees varies by state — check with your accountant or state DoR.)*

---

## 9. Deposits & tax

**Q: How does tax work with a deposit?**
The deposit is a percentage of the full quote total, which already includes tax. So a deposit collects a proportional share of the tax up front; the remaining tax is collected with the balance. The customer's total across deposit + balance equals the full taxed total.

---

## 10. Reports & filing

**Q: How do I get my sales tax numbers for filing?**
Open the Sales Tax report. It aggregates every recorded sale into a by-state summary (taxable sales and tax collected) and lets you export a CSV to hand to your accountant or import elsewhere. *(These records come from QuickBooks-connected sales; see the note below for non-QB shops.)*

**Q: Is the Sales Tax report empty even though I've made sales?**
The filing records are written from QuickBooks-connected invoices. If you're not on QuickBooks (or those sales predate connecting it), they won't appear. Connect QuickBooks going forward, or pull the numbers from your own records for that period.

**Q: Can I see the tax on individual sales, not just totals?**
Yes — the report can export a per-invoice detail CSV (date, customer, ship-to state, taxable amount, tax) in addition to the by-state summary.

---

## 11. "Why is the tax wrong / different?" (troubleshooting)

- **Customer charged tax but should be exempt** → exemption expired, state-scoped and ship-to not covered, or set after the quote was calculated (recalculate).
- **Rate looks wrong for an out-of-state customer** → no complete ship-to, so QuickBooks used your shop location; add ship-to + "Calculate tax from QuickBooks."
- **Quote tax ≠ invoice tax** → flat rate was used instead of QuickBooks; use "Calculate tax from QuickBooks" before sending.
- **No QuickBooks and multi-state** → InkTracker only has your one flat rate in this mode; it can't source per-state rates without QuickBooks.
- **Report shows nothing** → non-QB sales aren't recorded for filing; connect QuickBooks.

---

## 12. What the help bubble should NOT answer (route these)

For any of these, give the general mechanism above, then defer:
- "What tax rate should I charge in [state/city]?"
- "Do I have to collect sales tax in [state]?" / nexus / registration.
- "Is [specific product/service] taxable in [state]?"
- "Is my customer's resale certificate valid?"
- Anything about filing deadlines, penalties, or amounts owed.

Deferral line: *"InkTracker handles the calculation and record-keeping, but what you're required to collect and file is a tax-law question — please check with your accountant or your state's Department of Revenue. InkTracker isn't a tax advisor."*

---

### Honest product note (for you, not the bubble)
This content is accurate for the current build: QuickBooks-connected shops get correct, address-based, exemption-aware, filing-ready tax; non-QuickBooks shops get a manual flat rate they own. The single biggest thing that would let the bubble say "yes, tax is fully automatic for everyone" is adding automated rate lookup for non-QB shops (e.g. Stripe Tax) — until then, the honest answer for non-QB shops is "flat rate you control," and the content above says so plainly.
