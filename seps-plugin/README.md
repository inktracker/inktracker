# inktracker-seps

Cowork plugin for screen-print color separations and film prep. Runs on Affinity (or Photoshop) — the Python sep engine is app-agnostic, so you can drop Adobe entirely if you want.

## What it does

Four commands you run from Cowork:

- `/new-job` — creates the folder structure for a new job, logs it
- `/prep-spot` — spot-color separation (up to 8 colors), labels films with ink call and mesh count
- `/prep-sim-process` — simulated-process separation with halftone (6-10 color photoreal)
- `/make-ticket` — generates the production ticket PDF (mockup, print order, ink list, garment info)

## One-time setup

### 1. Install Python 3.10+ if you don't have it

```bash
python3 --version
```

If missing: `brew install python@3.12` (or download from python.org).

### 2. Install the sep engine's Python dependencies

```bash
python3 -m pip install -r ~/Downloads/inktracker/seps-plugin/scripts/engine/requirements.txt
```

This installs `psd-tools`, `Pillow`, and `numpy` — roughly 50 MB.

### 3. Install Affinity (if replacing Adobe)

Download from [affinity.studio/get-affinity](https://affinity.studio/get-affinity) — it's free with a free Canva account. No subscription.

Read `AFFINITY_WORKFLOW.md` in this folder for how to prep files so the sep engine can read them. Short version: name your color layers (`white_underbase`, `navy`, `red`, etc.) and export as PSD with layers preserved.

### 4. Set your jobs root folder

Edit `config.json` — default is `~/jobs/`.

### 5. Install the Cowork plugin

In Cowork, drag this whole `seps-plugin` folder into the Plugins tab, or run:

```
/setup-cowork add-local-plugin /Users/joeygrennan/Downloads/inktracker/seps-plugin
```

You'll see the four skills appear.

## Job folder convention

Every job gets this structure:

```
~/jobs/{customer-slug}/{job-code}/
  ├── artwork/       original files from customer
  ├── seps/          working files + engine input/output JSON
  ├── films/         output TIFs for AccuRIP
  ├── mockups/       PDF for customer approval
  ├── job.json       job metadata (customer, order #, garment, etc.)
  └── ticket.pdf     production ticket
```

Job codes are generated as `{YYMMDD}-{customer-slug}-{NNN}` (e.g., `260417-reno-running-001`).

## How the engine works

The Python sep engine reads a layered PSD, extracts each color layer as a grayscale density map, optionally adds a halftone dot pattern (for sim-process), and writes film-ready TIFs with registration marks. It's independent of any design app — Affinity, Photoshop, Krita, anything that exports layered PSD works.

### Spot-color mode (`scripts/engine/spot_sep.py`)

Matches color layers by name and exports each as a solid-ink film. Fast (4-10 seconds for most jobs).

### Sim-process mode (`scripts/engine/sim_process.py`)

Quantizes the flattened image against a standard simulated-process palette (white, black, red, yellow, blue, green, gray), generates halftone dots per channel at per-color screen angles, and outputs film-ready TIFs. Good for 80% of sim-process jobs. For the remaining hard cases, fall back to Separo (see `AFFINITY_WORKFLOW.md`).

## Cost

- Cowork plugin: free
- Python engine: free
- Affinity (replaces Adobe CC): free
- **Total: $0** to replace the Adobe-based workflow

## Integration with the inktracker app

See `../SEPS_INTEGRATION.md` in the project root for the spec on wiring sep status into the inktracker UI. That file is designed to be handed to Claude Code.

## Legacy Adobe scripts

The original Photoshop and Illustrator `.jsx` scripts are preserved in `scripts/legacy-adobe/` as a fallback. If you ever need to use ActionSeps specifically (e.g., a tough job where the Python engine falls short), you can copy those scripts into Photoshop's Scripts folder and run the old flow. The skills default to the Python engine.
