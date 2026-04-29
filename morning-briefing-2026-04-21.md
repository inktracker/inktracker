**Good morning, Joe ☕**

*Busy night on the sep engine — 26 commits shipped, web app is green.*

**What happened yesterday**
All the action was on the separation plugin, not the main inktracker site. Big upgrades to how the software picks colors and builds films: smarter color detection in LAB space, a new art editor (crop, color pick/replace, flip) before separating, auto-background stripping, an eyedropper to mark canvas, tonal multi-ink density for photoreal work, auto-add Highlight White on dark garments, a per-ink density slider, and a named ink picker with a live channels preview. The installer build script also got tidied up. No changes to the inktracker web app itself.

**Is it working?**
🟢 Build — passing (2.0 MB bundle, 566 KB gzipped)
🟡 Lint — 2 small errors (unused imports, nothing breaking)
🟢 Deploy — Vercel project is wired up (CLI not available to check live status)

**Needs your eyes**
- Two unused imports cluttering files — `calcGroupPrice` in `InvoiceDetailModal.jsx` and `STANDARD_MARKUP` in `OrderDetailModal.jsx`. `npm run lint -- --fix` will clean them up in one shot.

**Shop stats**
Usage stats aren't connected yet — let me know when you want to hook them up.

**Today's suggestion**
Bundle is pushing 2 MB — not urgent, but when you get a breather, splitting the big `supabaseClient.js` import into a shared chunk would trim load time for customers on slow connections.

**Not wired up yet**
Supabase migrations folder, Vercel CLI for live deploy checks, usage analytics.
