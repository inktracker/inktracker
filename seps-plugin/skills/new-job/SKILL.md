---
name: new-job
description: "Scaffold a new screen print job — creates folder structure, generates job code, logs the job in inktracker. Use when a new order comes in and you need to set up the file organization before sep work begins."
---

# /new-job

Create a new job folder with the shop's standard structure, generate a job code, and log it for tracking.

## Usage

```
/new-job <customer name> [job description]
```

Examples:
- `/new-job Reno Running Co 5k event shirts`
- `/new-job "Midtown Brewery" stout label crewnecks`
- `/new-job Biota swag hoodies`

## What this skill does

1. **Ask for anything missing** — if the user gave only a customer name, ask for a one-line job description. If they gave both, skip straight to creation.

2. **Generate a job code** — format: `{YYMMDD}-{customer-slug}-{NNN}` where NNN is the next sequential number for that customer. Example: `260417-reno-running-001`. Read the jobs root from `config.json` (`jobsRoot`, default `~/jobs`).

3. **Create the folder structure**:
   ```
   {jobsRoot}/{customer-slug}/{job-code}/
     ├── artwork/
     ├── seps/
     ├── films/
     ├── mockups/
     └── job.json
   ```

4. **Write `job.json`** with metadata:
   ```json
   {
     "jobCode": "260417-reno-running-001",
     "customer": "Reno Running Co",
     "customerSlug": "reno-running",
     "description": "5k event shirts",
     "createdAt": "2026-04-17T10:23:00-07:00",
     "status": "new",
     "garment": null,
     "garmentColor": null,
     "quantity": null,
     "printLocations": [],
     "separations": {
       "type": null,
       "colors": [],
       "filmCount": 0,
       "exportedAt": null
     },
     "ticket": {
       "generatedAt": null,
       "path": null
     }
   }
   ```

5. **Sync to inktracker** (if `config.inktracker.syncOnJobCreate` is true) — POST the job metadata to `config.inktracker.apiUrl`. If the request fails or the app isn't running, log the failure but don't block: the folder is the source of truth, the app is a view on it.

6. **Confirm with a short message**:
   ```
   ✅ Created 260417-reno-running-001
      ~/jobs/reno-running/260417-reno-running-001/
   
   Next: drop the customer's art in artwork/, then run /prep-sim-process or /prep-spot.
   ```

## Customer slug rules

- Lowercase
- Replace spaces and punctuation with hyphens
- Strip "inc", "llc", "co" suffixes
- Collapse multiple hyphens
- Examples:
  - "Reno Running Co" → `reno-running`
  - "Midtown Brewery" → `midtown-brewery`
  - "T&A Graphics LLC" → `t-a-graphics`

## Sequence number

To pick NNN, list existing folders under `{jobsRoot}/{customer-slug}/` and find the highest sequence number for jobs starting with today's `{YYMMDD}-{customer-slug}-` prefix. Default to 001 if none exist.

## Error handling

- If the jobs root doesn't exist, create it.
- If a folder with the generated code already exists, bump NNN and try again.
- If the art file path was provided and doesn't exist, warn but still create the folder.

## Follow-ups

After creating the folder, if the user's message mentioned an artwork file (e.g., "here's the AI file at /Users/joey/Downloads/logo.ai"), offer to move it into `artwork/` and rename it to `original.ai` (or original.psd, etc.). Only do this on confirmation.
