# Playwright e2e tests

End-to-end tests that drive the actual app in Chromium. Live coverage
for the MFA rollout (Phases 1-5) — the full lifecycle a real shop owner
would walk: sign up → see the nudge banner → enroll TOTP → sign out →
sign back in with the 6-digit code → sign out → recover with a backup
code.

## Run locally

```bash
npm run e2e        # headless, list reporter
npm run e2e:headed # opens Chromium so you can watch it
npm run e2e:debug  # Playwright Inspector — step through one assertion at a time
```

The default config (`playwright.config.js`) spins up the local Vite
dev server on `http://localhost:5173` and points the tests there. If
you'd rather hit a deployed URL, set `PLAYWRIGHT_BASE_URL`:

```bash
PLAYWRIGHT_BASE_URL=https://inktracker-preview-abc.vercel.app npm run e2e
```

The webServer auto-start is skipped when `PLAYWRIGHT_BASE_URL` doesn't
point at localhost.

## Required env vars

Both come out of `.env.local` (loaded by `playwright.config.js` via dotenv):

- `SUPABASE_URL` (or `VITE_SUPABASE_URL`) — the project's URL
- `SUPABASE_SERVICE_ROLE_KEY` — used by `e2e/_helpers/testUser.js` to
  create + tear down a confirmed test user per run

The service-role key NEVER reaches the browser — the helper module is
only imported by spec files, which run in the Node test runner.

## Test user lifecycle

Each test that needs auth creates its own user in `beforeAll`:

- random email like `playwright+<uuid>@inktracker.test`
- known password (returned to the spec)
- email pre-confirmed (skips the magic-link step)

`afterAll` deletes the user via the admin API. The cascade-delete on
`mfa_recovery_codes`, `mfa_audit_log`, and `mfa_trusted_devices`
cleans up the related rows automatically.

## Coverage

- `smoke.spec.js` — landing page renders (no auth)
- `authScope.spec.js` — owner signs in, sees their own shop's customer + quote (auth + tenant scoping)
- `managerPermissions.spec.js` — owner restricts a section; manager can't see it in nav or reach it by URL, but still sees the owner's data
- `mfa.spec.js` — full MFA lifecycle (currently `.skip()`, selector tuning pending)

## CI

A future PR will add a GitHub Actions job that:

1. Installs Playwright + Chromium
2. Boots the Vite dev server
3. Runs `npm run e2e` with the service-role key from secrets

The reporter mode auto-switches to `github` annotations when `CI` is
set. Retries are bumped to 2 in CI to absorb the occasional flake.
