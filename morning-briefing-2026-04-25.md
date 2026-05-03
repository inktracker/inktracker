**Good morning, Joe ☕**

*Quiet night — no new code, but the lint is grumbling.*

**What happened yesterday**
Nobody touched the app. Last commit was Monday (the sim-process color-picker work). Files are all where you left them.

**Is it working?**
🟢 Build — passing (2.1 MB main bundle, 580 kB gzipped)
🔴 Lint — 9 errors, all unused imports in `Customers.jsx` and `Performance.jsx`. Easy cleanup — `npm run lint -- --fix` will sort it out in one go.

**Needs your eyes**
- Lint won't pass on the next deploy without those unused imports getting cleaned up. One command fixes it.

**Shop stats**
Usage stats aren't connected yet — let me know when you want to hook them up so I can pull live order/customer counts from Supabase.

**Today's suggestion**
Run the lint auto-fix when you sit down — clears the board before any new sep work goes in.

*Not wired up yet: live deploy status (no Vercel CLI in the briefing tool).*
