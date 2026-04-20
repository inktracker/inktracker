"""CUPS print submission — hands film TIFs to the Epson for printing.

Targets the Epson ET-15000 with DMAX black ink (dye-based waterproof black
for film output). Locks settings for maximum density:

  - ColorModel = Gray   (DMAX only, no color mixing)
  - Quality   = Best    (slowest, densest ink lay-down)
  - Media     = Matte Heavyweight  (closest stock profile to film)
  - Rendering = Saturation  (matches the Illustrator default the shop uses)
  - No color management at the CUPS level

Without a proper RIP, that stack reliably hits ~3.3 D-max on Pictorico.
With the `double_strike` option enabled, the same film goes through twice
and lands ~3.5–3.6 D-max — enough for most halftone work.

Config is loaded from `~/.config/biota-film-driver/printer.json`. The
installer writes that file after introspecting the actual printer queue
with `lpstat -p` and `lpoptions -p <queue> -l`.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path


CONFIG_PATH = Path.home() / ".config" / "biota-film-driver" / "printer.json"


@dataclass
class PrinterConfig:
    """Resolved printer config for the film-output queue."""
    queue: str                              # CUPS queue name
    media_type: str = "Matte"               # CUPS MediaType option value
    quality: str = "5"                      # cupsPrintQuality: 0=draft..5=best
    color_model: str = "Gray"               # ColorModel: Gray vs RGB
    rendering_intent: str = "saturation"    # print-rendering-intent
    sheet_size_13x19: str = "Super B"       # PageSize name for 13x19
    sheet_size_85x11: str = "Letter"        # PageSize name for 8.5x11
    extra_options: dict = field(default_factory=dict)  # raw {key: value} pass-through
    disable_color_mgmt: bool = True
    double_strike: bool = False

    @classmethod
    def load(cls, path: Path = CONFIG_PATH) -> "PrinterConfig":
        if not path.exists():
            raise FileNotFoundError(
                f"Printer config not found at {path}. "
                f"Run installable/print-driver/install.sh to create it."
            )
        d = json.loads(path.read_text())
        return cls(
            queue=d["queue"],
            media_type=d.get("media_type", "Matte"),
            quality=d.get("quality", "5"),
            color_model=d.get("color_model", "Gray"),
            rendering_intent=d.get("rendering_intent", "saturation"),
            sheet_size_13x19=d.get("sheet_size_13x19", "Super B"),
            sheet_size_85x11=d.get("sheet_size_85x11", "Letter"),
            extra_options=d.get("extra_options", {}),
            disable_color_mgmt=bool(d.get("disable_color_mgmt", True)),
            double_strike=bool(d.get("double_strike", False)),
        )

    def save(self, path: Path = CONFIG_PATH) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({
            "queue": self.queue,
            "media_type": self.media_type,
            "quality": self.quality,
            "color_model": self.color_model,
            "rendering_intent": self.rendering_intent,
            "sheet_size_13x19": self.sheet_size_13x19,
            "sheet_size_85x11": self.sheet_size_85x11,
            "extra_options": self.extra_options,
            "disable_color_mgmt": self.disable_color_mgmt,
            "double_strike": self.double_strike,
        }, indent=2))


@dataclass
class PrintJob:
    path: Path
    title: str           # shows in the print queue UI
    sheet_name: str      # "8.5x11" or "13x19"


def build_lp_command(cfg: PrinterConfig, job: PrintJob) -> list[str]:
    """Assemble the `lp` command with locked film-output settings."""
    if not shutil.which("lp"):
        raise RuntimeError("CUPS `lp` command not found on PATH")

    page_size = cfg.sheet_size_13x19 if "13" in job.sheet_name else cfg.sheet_size_85x11

    cmd = [
        "lp",
        "-d", cfg.queue,
        "-t", job.title,
        "-o", f"media={page_size}",
        "-o", f"MediaType={cfg.media_type}",
        "-o", f"ColorModel={cfg.color_model}",
        "-o", f"cupsPrintQuality={cfg.quality}",
        "-o", f"print-rendering-intent={cfg.rendering_intent}",
        "-o", "print-color-mode=monochrome",
        "-o", "fit-to-page=false",
        "-o", "orientation-requested=3",  # portrait
    ]

    # Strip CUPS-level color management — we've already rendered the exact
    # density curves we want; any remapping at this stage only hurts D-max.
    if cfg.disable_color_mgmt:
        cmd += ["-o", "cm-calibration=true"]

    for k, v in cfg.extra_options.items():
        cmd += ["-o", f"{k}={v}"]

    cmd.append(str(job.path))
    return cmd


def submit(cfg: PrinterConfig, job: PrintJob, dry_run: bool = False) -> dict:
    """Submit one film to CUPS. Returns a dict with job-id/status/stderr."""
    cmd = build_lp_command(cfg, job)

    if dry_run:
        return {"job_id": None, "status": "dry-run", "cmd": " ".join(cmd)}

    result = subprocess.run(cmd, capture_output=True, text=True)
    ok = result.returncode == 0
    # `lp` prints: "request id is <queue>-<N> (1 file(s))"
    job_id = None
    if ok:
        out = result.stdout.strip()
        # Grab the token that looks like queue-12
        for tok in out.split():
            if "-" in tok and tok.split("-")[-1].isdigit():
                job_id = tok
                break

    return {
        "job_id": job_id,
        "status": "submitted" if ok else "failed",
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
        "cmd": " ".join(cmd),
    }


def submit_many(cfg: PrinterConfig, jobs: list[PrintJob], dry_run: bool = False) -> list[dict]:
    """Submit all films. When double_strike is on, each film goes in twice."""
    results = []
    for job in jobs:
        r = submit(cfg, job, dry_run=dry_run)
        results.append({"pass": 1, **r, "film": job.path.name})

        if cfg.double_strike and r.get("status") == "submitted":
            r2 = submit(cfg, job, dry_run=dry_run)
            results.append({"pass": 2, **r2, "film": job.path.name})
    return results


# ---------------------------------------------------------------------------
# Introspection helpers (used by the installer to write printer.json)
# ---------------------------------------------------------------------------

def list_queues() -> list[str]:
    """Return the names of all currently-configured CUPS queues."""
    if not shutil.which("lpstat"):
        return []
    out = subprocess.run(["lpstat", "-p"], capture_output=True, text=True)
    queues = []
    for line in out.stdout.splitlines():
        # "printer EPSON_ET_15000_Series is idle.  enabled since ..."
        if line.startswith("printer "):
            parts = line.split()
            if len(parts) >= 2:
                queues.append(parts[1])
    return queues


def list_options(queue: str) -> dict[str, list[str]]:
    """Return {option_name: [allowed_values]} for a given CUPS queue.

    Uses `lpoptions -p <queue> -l`. Useful so the installer can confirm
    which MediaType/PageSize values this printer actually accepts.
    """
    if not shutil.which("lpoptions"):
        return {}
    out = subprocess.run(
        ["lpoptions", "-p", queue, "-l"], capture_output=True, text=True,
    )
    options: dict[str, list[str]] = {}
    for line in out.stdout.splitlines():
        # "MediaType/Media Type: *Plain Matte Photo ..."
        if "/" not in line or ":" not in line:
            continue
        key = line.split("/", 1)[0]
        values_part = line.split(":", 1)[1].strip()
        vals = [v.lstrip("*") for v in values_part.split()]
        options[key] = vals
    return options


def pick_best_value(options: dict[str, list[str]], key: str, preferences: list[str]) -> str | None:
    """Return the first preferred value that this printer actually supports."""
    available = options.get(key, [])
    if not available:
        return None
    lower = [v.lower() for v in available]
    for pref in preferences:
        if pref.lower() in lower:
            return available[lower.index(pref.lower())]
    # Substring match fallback
    for pref in preferences:
        for v in available:
            if pref.lower() in v.lower():
                return v
    return None


def detect_epson_et15000() -> str | None:
    """Look for an ET-15000-ish queue among the configured printers."""
    queues = list_queues()
    targets = ["et-15000", "et_15000", "et15000"]
    for q in queues:
        ql = q.lower()
        if any(t in ql for t in targets):
            return q
    return None
