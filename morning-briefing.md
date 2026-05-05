**Good morning, Joe ☕**

*Busy day yesterday — 9 commits, all security and polish work, everything still green.*

**What happened yesterday**
A run of security tightening: customer quote/order links are now token-gated, webhooks fail closed instead of open, CORS is locked to inktracker.app, and the admin panel queries are properly scoped to your shop. Stripe billing now enforces on the server side too. A new profile_secrets table moved sensitive supplier credentials out of the main profile, with a safe fallback if the write fails. Also a small fix so garments show the product name instead of "brand — style number," and customer-facing URLs are pinned to the production domain. 63 files touched.

**Is it working?**
🟢 Build — passing (3.5 MB total, ~500 KB gzipped main bundle)
🟢 Lint — clean
🟢 Migrations — new one yesterday for profile_secrets, looks tidy

**Shop stats**
Usage stats aren't connected yet — let me know when you want to hook them up.

**Today's suggestion**
The main JS bundle is creeping up (1.9 MB un-gzipped). Not urgent, but worth a code-split pass when you have a quiet afternoon — the build is hinting about it.
