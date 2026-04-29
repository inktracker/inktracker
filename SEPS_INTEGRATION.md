# Seps Integration Spec

> **For Claude Code:** Read this entire file, then implement the changes described. All file paths are relative to the project root unless noted.

## Context

A Cowork plugin (`seps-plugin/` at the project root) automates screen-print color separations outside the inktracker web app. The plugin creates jobs on the filesystem under `~/jobs/{customer-slug}/{job-code}/`. Each job has a `job.json` with metadata, a `films/` folder with film-ready TIFs, and a `ticket.pdf` when ready for press.

This integration wires those filesystem jobs into the inktracker app so Joe can see sep status, film counts, and ticket links from the UI.

## What to build

### 1. Backend: a `/api/seps` endpoint pair

Add two Supabase edge functions (or Vercel API routes, whichever matches the existing pattern in this codebase — check first):

**POST `/api/seps/job`** — called by the Cowork plugin when a new job is created or updated. Accepts the `job.json` payload verbatim. Upserts a row into a new `seps_jobs` table keyed on `jobCode`.

**GET `/api/seps/jobs`** — returns all seps_jobs for the current user, newest first. Used by the UI to render the list.

Add CORS allowance for `localhost` origins (Cowork runs locally).

### 2. Database: a `seps_jobs` table

Create a new migration in `supabase/migrations/`:

```sql
create table if not exists seps_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  job_code text unique not null,
  customer_name text not null,
  customer_slug text not null,
  description text,
  status text default 'new',
  garment jsonb,
  separations jsonb,
  ticket jsonb,
  folder_path text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index seps_jobs_user_created on seps_jobs(user_id, created_at desc);
```

Add RLS policies so users only see their own jobs.

### 3. Frontend: a Seps dashboard page

Add a new route `/seps` with a page component at `src/pages/Seps.jsx`. It should:

- List all seps_jobs for the current user in a table
- Columns: Job Code, Customer, Status, Films (count), Ticket (link), Created, Actions
- Status badge: `new` (gray), `seps-ready` (blue), `ticket-ready` (green), `in-press` (amber), `shipped` (gray)
- "Films" column shows `{count} films` as a clickable link that opens `file://{folderPath}/films/` in Finder (use the computer:// protocol)
- "Ticket" column shows "View Ticket" link when `ticket.path` is set
- Row click opens a drawer with full job.json details

Derive `status` from the shape of job.json:
- `separations.exportedAt` set → `seps-ready`
- `ticket.generatedAt` set → `ticket-ready`
- `status` field in job.json takes precedence if present

### 4. Navigation

Add a "Seps" nav item to the sidebar in `src/Layout.jsx`, with an icon (use `Layers` from lucide-react). Place it between Orders and Production.

### 5. Job detail integration

On the existing Orders page (`src/pages/Orders.jsx`) and Quotes page, add a small "Seps" column showing either a film count badge (if a matching job_code exists in seps_jobs) or a "Start Seps" button that copies `/new-job {customer}` to the clipboard for the user to paste into Cowork.

Match jobs between orders and seps_jobs by `customer_slug` and by the customer name substring — the Cowork plugin uses the same slug rules (see `seps-plugin/skills/new-job/SKILL.md`).

## Files to create

```
supabase/migrations/{next-number}_seps_jobs.sql
src/api/seps.js                    # client for /api/seps
src/pages/Seps.jsx                 # the dashboard
src/components/seps/JobRow.jsx
src/components/seps/JobDetailDrawer.jsx
src/components/seps/StatusBadge.jsx
```

For the API endpoint, match the existing Supabase function pattern in this repo.

## Files to modify

- `src/Layout.jsx` — add Seps nav item
- `src/App.jsx` (or wherever routes live) — register /seps
- `src/pages/Orders.jsx` — add seps status column
- `src/pages/Quotes.jsx` — optionally add "Start Seps" CTA

## Config

The Cowork plugin reads its API URL from `seps-plugin/config.json` under `inktracker.apiUrl`. Default is `http://localhost:5173/api/seps` for dev. Document the production URL in the plugin README once deployed.

## Acceptance criteria

1. Running `/new-job "Test Customer" test job` in Cowork creates a row in `seps_jobs` visible on `/seps` in the app within a few seconds.
2. Running `/prep-sim-process` updates the row's `separations` field and flips status to `seps-ready`.
3. Running `/make-ticket` updates the `ticket` field and flips status to `ticket-ready`.
4. Clicking "View Ticket" opens the PDF.
5. RLS prevents cross-user access: a job created by user A is not visible to user B.

## Non-goals

- Do NOT try to upload the actual film TIFs into Supabase storage. They're large and stay on the local filesystem. The app only stores the path.
- Do NOT try to trigger Cowork skills from the app. The flow is app → Cowork (Joe triggers manually), not app → Cowork (programmatic). A later phase could add webhooks, but not in this round.
- Do NOT modify anything in `seps-plugin/`. That's owned by Cowork.

## Questions / gotchas

- The Cowork plugin writes to `~/jobs/` by default. On first run, the user_id on a new job is inferred from the auth session when the plugin POSTs — make sure the POST endpoint either accepts an API token or uses a session cookie. If no auth is wired up on localhost, fall back to a single-user dev mode (all jobs belong to the logged-in user). Note this in the code.
- Timestamps in job.json are ISO 8601 with local offset. Supabase will store as UTC.

## Priority

Ship in this order so each piece is useful on its own:
1. Migration + backend endpoints (nothing visible yet but the plumbing is in)
2. Seps dashboard page + nav (visible, even if empty)
3. Orders/Quotes integration (cross-linking)
