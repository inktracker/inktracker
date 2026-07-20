# Real-UI demo screenshots

Renders **real InkTracker screenshots** with fabricated demo data (fictional shop
"Summit Ridge Printing" — no client data). It boots the actual app, seeds a fake
session, and intercepts every backend call with demo JSON, so the screenshots are
the real React UI.

## Run

1. **Terminal A** — start the app:
   ```
   npm run dev
   ```
   Note the port it prints (usually `5173`).

2. **Terminal B** — install Playwright once, then render:
   ```
   npm i -D playwright
   npx playwright install chromium
   BASE=http://localhost:5173 node demo-shots/render-real-ui.mjs
   ```
   (Change `5173` if your dev server used a different port.)

Screenshots land in `demo-shots/app-*.png` (2× retina, full page):
`app-01-dashboard`, `app-02-production`, `app-03-invoices`, `app-04-performance`.

## Notes

- `SUPABASE_REF` defaults to the subdomain of your `VITE_SUPABASE_URL`
  (`skmltfbibaqcjddmeqvi`). If that ever changes, pass `SUPABASE_REF=<newref>`.
- Nothing hits your real Supabase — all `/auth`, `/rest`, `/functions` calls are
  intercepted and answered with the demo data inside the script. Safe to run.
- Want different demo numbers, more orders, or extra pages? Edit the data objects
  at the top of `render-real-ui.mjs` and re-run. To add a page, append to the
  `pages` array (e.g. `["Customers","app-05-customers"]`).
- The revenue figures are set to land in the $600k–$999k/yr range
  (Performance → "This Year" = $812,450).
