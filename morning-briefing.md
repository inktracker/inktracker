**Good morning, Joe ☕**

*Busy night — Claude Code shipped 9 commits, mostly broker portal work. Build is green but the linter is grumbling.*

**What happened yesterday**
A lot of polish on the broker side of the app. The broker portal got its own sidebar layout, QuickBooks hookup, and a configurable commission percentage. Brokers can now mark new clients as tax-exempt and the line item editor saves size-level pricing the same way the shop editor does. A couple of small fixes too — the Edit Quote button is now hidden on quotes that brokers submitted, and the PDF export uses the saved quote totals instead of recalculating on the fly. 14 files touched.

**Is it working?**
🟢 Build — passing (about 2.8 MB total, 760 KB compressed)
🔴 Lint — 15 errors, all unused imports left behind from the broker work
🟡 Database — there's a new migration sitting in the folder (`20260507_broker_customers_rls.sql`) that hasn't been pushed to Supabase yet. The commit message even flags it: "NEEDS MIGRATION."

**Needs your eyes**
- Run the broker customers migration in Supabase before brokers try to add clients, or they'll hit a permission wall.
- Lint cleanup: `BrokerDashboard.jsx` has 9 unused imports, plus a handful in BrokerLayout, BrokerOrderPDFModal, BrokerPricePanel, PricePanel, and pdfExport. `npm run lint -- --fix` should clear them all in one shot.

**Shop stats**
Usage stats aren't connected yet — let me know when you want to hook them up.

**Today's suggestion**
The main JS bundle is about 1.9 MB now. Not urgent, but worth a look at code-splitting before it gets bigger — especially since broker stuff is only used by brokers.
