**Good morning, Joe ☕**

*Busy night — 11 changes shipped, app builds clean.*

**What happened yesterday**
Plenty got done. Pricing config now takes percentage markups with editable extra fees, and the live pricing screen shows the garment markup breakdown. QuickBooks won't overwrite existing invoices anymore — it auto-versions the doc number instead. The Messages feature got wired up (threads per quote/order/invoice, inline subjects, plus a new sendReply edge function). FedEx shipping was added to orders, and the PDF library is now lazy-loaded so first page loads feel snappier. A new RLS lockdown migration and a shipping-fields migration also landed.

**Is it working?**
🟢 Build — passing (3.5 MB total, main bundle ~502 KB gzipped)
🟢 Lint — 0 errors
🟡 Lint — 96 warnings (mostly unused vars, nothing urgent)
🟢 TODOs — none left in the code

**Shop stats**
Usage stats aren't connected yet — let me know when you want to hook them up.

**Today's suggestion**
Main JS bundle is over 1.9 MB unminified. If pages feel slow on first load for new customers, splitting it into chunks would help. Not urgent — just something to keep on the back burner.

**Not wired up yet**
Vercel CLI isn't available in this environment, so I can't see live deploy status.
