**Good morning, Joe ☕**

*Quiet weekend — no new code in the last 24 hours, app builds clean, but a few stray imports are tripping the linter.*

**What happened yesterday**
Nothing new committed. The last work was Wednesday's "Paste Order" button and the smarter quote parser. A new Supabase migration landed Friday locking down row-level security on the database — worth knowing about, but it's already in.

**Is it working?**
🟢 Build — passing (3.4 MB total)
🔴 Lint — 3 errors (unused imports, easy fix)
🟢 Deploy — Vercel project still linked and ready

**Needs your eyes**
- Lint is failing on two files with leftover imports nobody's using: `LineItemEditor.jsx` (TECHNIQUES) and `Account.jsx` (Plus, Trash2). Two-minute cleanup — `npm run lint -- --fix` will sort it.
- Heads up: the main JavaScript bundle is now 2.25 MB (610 KB gzipped). Not broken, but it's getting hefty. Worth splitting up sometime soon so first page loads stay snappy.

**Shop stats**
Usage stats aren't connected yet — let me know when you want to hook them up.

**Today's suggestion**
Run the lint auto-fix and you're back to all green in a minute.
