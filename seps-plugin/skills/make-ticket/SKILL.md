---
name: make-ticket
description: "Generate the production ticket PDF for a job — mockup, film list with mesh counts, print order, ink calls, garment info, and space for the press operator to sign off. Use once seps are exported and before the job goes to press."
---

# /make-ticket

Generates the shop's production ticket as a PDF. The ticket is the single sheet that goes with the job to press — everything the operator needs in one glance.

## Usage

```
/make-ticket <job-code | job-folder-path>
```

Examples:
- `/make-ticket 260417-reno-running-001`

## What this skill does

### 1. Load the job

Read `job.json` from the job folder. Verify that seps have been exported (`separations.exportedAt` is set). If not, refuse and ask the user to run `/prep-sim-process` or `/prep-spot` first.

### 2. Gather any missing job info

If `job.json` is missing garment type, color, quantity, or print locations, ask for them:

```
Missing a few details for the ticket:
  - Garment (e.g., Gildan 5000, Bella+Canvas 3001)?
  - Quantity?
  - Print locations (e.g., front, back, left chest)?
  - Due date?
```

Save answers back to `job.json`.

### 3. Generate a mockup if missing

Look for a PDF in `mockups/`. If none exists, run the Illustrator mockup script:

```bash
osascript -e 'tell application "Adobe Illustrator 2026" to do javascript file ".../inktracker-generate-mockup.jsx" with arguments {"/path/to/job.json"}'
```

This places the art on a garment template matching the garment color and saves `mockup-front.pdf` (and back if a back print exists).

### 4. Build the ticket PDF

Use the `pdf` skill to generate a single-page PDF with these sections:

**Header**
- Shop name / logo (from `~/jobs/.shop-info.json` if present)
- Job code (big, top-right)
- Date printed

**Customer & Job**
- Customer name
- Job description
- Due date
- Quantity
- Contact info (from `job.json` if present)

**Garment**
- Blank: Gildan 5000 (example)
- Color: Black
- Sizes: S(4) M(8) L(12) XL(6) (from `job.json.sizes` if present)

**Mockup**
- Embed the mockup image(s) — one for each print location
- Dimension callouts (width × height of the print)

**Films / Print Order**
- Table with columns: #, Ink Color, Mesh Count, Purpose, Film Ready
- Check boxes next to "Film Ready" for the operator to mark

**Press Setup**
- Platen: Standard / Youth / Sleeve
- Flash between: Y/N
- Cure: 320°F for 60s (standard) — editable
- Notes: [blank space]

**Sign-off**
- Press operator: __________
- Final inspection: __________
- Completed date: __________

Save as `{job-folder}/ticket.pdf`.

### 5. Update job.json

```json
"ticket": {
  "generatedAt": "2026-04-17T12:45:00-07:00",
  "path": ".../ticket.pdf",
  "version": 1
}
```

If a ticket already exists, increment the version and save as `ticket-v2.pdf` (keeping the previous one).

### 6. Report

```
✅ Production ticket ready
   ~/jobs/reno-running/260417-reno-running-001/ticket.pdf

Opens with: open ~/jobs/reno-running/260417-reno-running-001/ticket.pdf

Films + ticket together — job is ready for press.
```

Offer: "Want me to open it now?"

## Notes

- The PDF is one page. If a job has more than 3 print locations or >10 colors, the skill falls back to a two-page version: page 1 is customer/garment/mockup, page 2 is films/press-setup.
- The ticket is designed to print on 8.5×11 and fit in a standard job folder.
- All information comes from `job.json` — if the user needs to change something after the ticket is generated, they edit `job.json` and re-run this skill.
