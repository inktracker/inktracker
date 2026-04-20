#!/usr/bin/env python3
"""Film Seps — Tkinter GUI.

A real app window for the film-output driver. Studies incoming artwork,
recommends a sep mode, lets the operator adjust every knob (with hover
tooltips on every field), runs the render in a background thread with
a live progress bar, opens the preview in Preview.app, then submits
to the Epson.
"""

from __future__ import annotations

import logging
import queue
import sys
import threading
import time
import traceback
from datetime import datetime
from pathlib import Path

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from PIL import Image, ImageTk  # noqa: E402

from analyzer import Analysis, analyze  # noqa: E402
from film_driver import (  # noqa: E402
    _garment_rgb, _load_source_keep_alpha, _load_source_thumbnail,
    _source_has_alpha, drive,
)
import macdrop  # noqa: E402
from preferences import DriverConfig, FILM_DPI_DEFAULT  # noqa: E402
from preview import build_contact_sheet, open_in_preview  # noqa: E402
from editor import ArtEditor  # noqa: E402
from sepviewer import SepViewer  # noqa: E402
from printer import PrinterConfig, PrintJob, submit_many  # noqa: E402
from tooltip import attach as attach_tooltip  # noqa: E402


# ---- Logging — stdout/stderr are swallowed by py2app when the app is
# launched from the Dock, so every event goes to a rotating file the
# user can `tail -f`.
_LOG_DIR = Path.home() / "Library" / "Logs"
_LOG_DIR.mkdir(parents=True, exist_ok=True)
_LOG_FILE = _LOG_DIR / "FilmSeps.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-5s  %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.FileHandler(str(_LOG_FILE), encoding="utf-8"),
    ],
)
log = logging.getLogger("filmseps.gui")
log.info("=" * 60)
log.info("Film Seps starting — argv=%s", sys.argv)


APP_TITLE = "Film Seps"
APP_W, APP_H = 980, 720
DEFAULT_OUTPUT_ROOT = Path.home() / "Downloads" / "film-seps"


TIPS = {
    "source": (
        "The art file to separate. PSD keeps named layers. JPG / PNG / PDF work "
        "too — the driver will detect distinct colors automatically."
    ),
    "mode": (
        "How to split the art into inks.\n\n"
        "• Spot-layered — one film per named PSD layer. Most control. "
        "Requires a layered PSD with lowercase, underscore-separated names "
        "like white_underbase / red / pantone-289-c / white_highlight.\n\n"
        "• Spot-flat — auto-detects distinct colors in a flat image. "
        "Good for logos, text, illustrations with flat color areas.\n\n"
        "• Sim-process — photoreal mode. Auto-picks up to 8 inks and halftones "
        "each. Use for photos or art with smooth gradients."
    ),
    "garment": (
        "Color of the shirt. Drives underbase strategy (any dark color needs "
        "one) and which pixels get ignored when detecting colors from a flat "
        "image (garment color is subtracted as 'background')."
    ),
    "ink_system": (
        "Waterbase — the shop default. ~5% dot gain on press; the driver "
        "holds back midtones on film so they print correctly.\n\n"
        "Discharge — reactive-dyed cotton only. Near-zero dot gain because "
        "the ink activates the garment's dye instead of sitting on top. "
        "Switch to this for dark-garment prints on 100% cotton tees."
    ),
    "print_width": (
        "Final print width on the garment, in inches.\n\n"
        "Rules of thumb:\n"
        "• Left chest: 3.5–4\"\n"
        "• Full front (adult tee): 11–12\"\n"
        "• Full back: 12–13\"\n"
        "• Youth / baby: scale down proportionally"
    ),
    "print_height": (
        "Optional. Leave blank to preserve the source's aspect ratio — the "
        "driver will compute the height from the width and scale proportionally."
    ),
    "film_dpi": (
        "Film output resolution.\n\n"
        "720 DPI — shop standard. Supports LPI up to ~65 cleanly. Epson P800 "
        "and ET-15000 native. Recommended for anything with halftones.\n\n"
        "360 DPI — acceptable only when LPI ≤ 45 (low-detail jobs). Faster to "
        "print, uses less ink. Not recommended for fine halftones."
    ),
    "exclude_background": (
        "Tell the sep engine which pixels are the canvas the art was drawn on "
        "(not inks you want to print). Common when the source is a stock "
        "illustration on a beige paper, a scanned sheet, a transparent PNG, "
        "or anything where the background color isn't the garment you're "
        "printing on.\n\n"
        "Off — don't exclude anything; treat every pixel as potentially ink.\n\n"
        "Auto (recommended) — detect transparent pixels (alpha channel) AND "
        "any uniform canvas color connected to the image border via "
        "flood-fill. Leaves holes inside the design intact (e.g. a white "
        "highlight inside a character's eye stays as ink).\n\n"
        "Alpha only — trust the source's alpha channel and nothing else. "
        "Use when your art has a transparent background but the opaque "
        "pixels include uniform regions you DO want to print (e.g. white "
        "ink on transparent)."
    ),
    "enhance": (
        "Runs before separation detection. Cleans up the source art so the "
        "sep engine has a better input — especially valuable for low-quality "
        "JPEGs, compressed scans, or small web-sized images.\n\n"
        "None — use source as-is. Correct for clean vector/PSD sources.\n\n"
        "Light — 2× upscale (if source < 2000 px) + mild Gaussian denoise + "
        "unsharp mask. Safe default for most JPEGs.\n\n"
        "Strong — 2× upscale + heavy median filter (removes JPEG block noise) "
        "+ unsharp mask. For heavily-compressed JPEGs, phone screenshots, or "
        "scanned art.\n\n"
        "Vectorize — Strong + quantize every pixel to the nearest target ink. "
        "Produces flat-color regions that look like vector art. Best for "
        "low-quality stock art or art that's fundamentally a clean "
        "illustration buried under JPEG noise."
    ),
    "media_size": (
        "Physical film sheet size the driver composes each sep onto. "
        "Registration marks and labels land in the sheet margin; the halftoned "
        "design is centered.\n\n"
        "Auto — picks 8.5×11 when the design fits in a 7.5×10 usable area, "
        "else 13×19.\n\n"
        "8.5×11 — letter. Economical for small designs (left chest, youth, "
        "patches). Epson auto-sheet-fed.\n\n"
        "13×19 — super B. Required for full-front and full-back adult prints "
        "on most designs."
    ),
    "max_colors": (
        "For sim-process or spot-flat modes: the maximum number of ink colors "
        "the driver will auto-pick. 6 is typical for sim-process; use 8 for "
        "photoreal portraits; use 3–4 for bold illustration work."
    ),
    "job_label": (
        "Short text that prints next to every reg mark on every film so films "
        "are self-identifying on the light table. Usually the job code "
        "(e.g. '260419-reno-running') — gets printed on every sep in the job."
    ),
    "mirror": (
        "Off (right-reading / emulsion-up) — standard for most exposure units. "
        "Use this unless you have a specific reason otherwise.\n\n"
        "On (mirrored / emulsion-down) — required when burning through the "
        "mesh side of the screen instead of the flat side. Rare on modern setups."
    ),
    "double_strike": (
        "Submits each film to the printer twice, so the DMAX ink lays down "
        "in two passes on the same sheet.\n\n"
        "Doubles print time. Reliably pushes D-max from ~3.3 to ~3.5–3.6. "
        "Use when a test burn under-exposes — especially on fine halftones "
        "or dense shadow areas."
    ),
    "output_dir": (
        "Where the films/ folder and preview contact sheet land. Each job "
        "creates its own timestamped subfolder inside this root, so nothing "
        "gets overwritten between jobs."
    ),
    "render": (
        "Separate the artwork into film TIFs and open a contact-sheet preview "
        "in Preview.app. No printing happens yet — this is the QC checkpoint."
    ),
    "print": (
        "Submit every film to the Epson ET-15000 with locked max-density "
        "settings: ColorModel=Gray (DMAX only), Quality=Best, "
        "Saturation rendering intent, CUPS color management disabled. "
        "Always review the preview first."
    ),
}


# ---------------------------------------------------------------------------
# Main app
# ---------------------------------------------------------------------------

class FilmSepsApp:
    def __init__(self, initial_source: Path | None = None):
        self.root = tk.Tk()
        self.root.title(APP_TITLE)
        self.root.geometry(f"{APP_W}x{APP_H}")
        self.root.minsize(880, 620)

        # State
        self.source_path: Path | None = None
        self.analysis: Analysis | None = None
        self.render_result: dict | None = None
        self.output_root = DEFAULT_OUTPUT_ROOT
        # If the operator used the Edit window, this holds the edited PIL
        # image. The render flow uses this in preference to loading the raw
        # source from disk. Cleared on load-source.
        self.edited_image: Image.Image | None = None
        # Detected palette for the current source. list[dict] with keys:
        #   rgb, lab, suggested_name, fraction, enabled (bool)
        self.detected_palette: list[dict] = []
        # Eyedropper state
        self._eyedrop_active = False
        self._preview_source_img: Image.Image | None = None
        self._preview_scale: float = 1.0
        self._preview_offset: tuple[int, int] = (0, 0)

        # Background-thread → main-thread message queue
        self._q: queue.Queue = queue.Queue()

        # Keep a reference to the preview thumbnail so Tk doesn't GC it
        self._preview_imgtk: ImageTk.PhotoImage | None = None

        # Force a ttk theme that paints every widget explicitly.
        # The macOS 'aqua' theme honors dark mode but renders many ttk widgets
        # (labels, frames, combobox text) as transparent/blank inside a py2app
        # bundle — leaves the window looking empty. 'clam' is the cross-
        # platform default and always draws backgrounds/foregrounds.
        try:
            style = ttk.Style(self.root)
            style.theme_use("clam")
            # Tune colors so the clam theme feels native-ish on macOS.
            style.configure(".", background="#ececec", foreground="#222")
            style.configure("TLabel", background="#ececec")
            style.configure("TFrame", background="#ececec")
            style.configure("TLabelframe", background="#ececec", foreground="#222")
            style.configure("TLabelframe.Label", background="#ececec", foreground="#222")
            style.configure("TCheckbutton", background="#ececec")
            style.configure("TButton", padding=(10, 4))
            self.root.configure(background="#ececec")
            log.info("ttk theme: clam")
        except Exception:
            log.exception("ttk theme switch failed")

        self._build_ui()
        self._drain_queue()
        self._register_mac_handlers()

        # Force a sane on-screen position so the window can't end up off-screen
        # (happens occasionally on multi-display setups / after a space switch).
        try:
            sw = self.root.winfo_screenwidth()
            sh = self.root.winfo_screenheight()
            x = max(20, (sw - APP_W) // 2)
            y = max(20, (sh - APP_H) // 3)
            self.root.geometry(f"{APP_W}x{APP_H}+{x}+{y}")
            self.root.wm_state("normal")
            log.info("window placed at +%d+%d (screen %dx%d)", x, y, sw, sh)
        except Exception:
            log.exception("window placement failed")

        if initial_source:
            self._load_source(initial_source)

    def _register_mac_handlers(self) -> None:
        """Wire up macOS-specific drag-drop handling.

        Primary path: pyobjc injects `application:openFile:` on NSApp's
        existing Tk delegate class. Drops on the Dock icon and 'Open With...'
        from Finder go through this.

        Fallback path: Tk's `::tk::mac::OpenDocument` command. Flaky on
        Tk 8.5 but costs nothing to register in case pyobjc is missing.

        Also handles 'Reopen' (Dock click with no drop) to bring the
        window forward instead of silently spawning a new process.
        """
        ok = macdrop.install(self._on_mac_drop)
        log.info("macdrop handler install: %s", "ok" if ok else "failed")

        try:
            self.root.createcommand("::tk::mac::OpenDocument", self._on_mac_drop)
            log.info("Tk OpenDocument handler registered")
        except tk.TclError as e:
            log.warning("Tk OpenDocument handler skipped: %s", e)

        try:
            self.root.createcommand("::tk::mac::ReopenApplication", self._on_mac_reopen)
        except tk.TclError:
            pass

    def _on_mac_drop(self, *paths: str) -> None:
        """Receive a dropped file path from either pyobjc or Tk and load it."""
        log.info("_on_mac_drop: %s", paths)
        for p in paths:
            if not p:
                continue
            path = Path(str(p))
            if not path.exists():
                log.warning("dropped path doesn't exist: %s", path)
                continue
            # Hop to the Tk thread — pyobjc calls us from the AppKit thread
            self._q.put(("open-file", str(path)))
            break

    def _on_mac_reopen(self, *_args) -> None:
        self._bring_to_front()

    def _bring_to_front(self) -> None:
        # Log current window state so we can tell if it's hidden, iconified, or
        # just sitting off-screen somewhere.
        try:
            state = self.root.wm_state()
            geom = self.root.geometry()
            visible = self.root.winfo_viewable()
            log.info("_bring_to_front: state=%s geom=%s viewable=%s",
                     state, geom, visible)
        except Exception:
            pass

        try:
            # First: un-hide via AppKit, because deiconify alone doesn't reverse
            # a Cmd-H hide. Also set the regular activation policy in case py2app
            # initialized us as an accessory.
            try:
                from AppKit import (
                    NSApplication,
                    NSApp,
                    NSApplicationActivationPolicyRegular,
                )
                app = NSApp() or NSApplication.sharedApplication()
                app.setActivationPolicy_(NSApplicationActivationPolicyRegular)
                app.unhide_(None)
                app.activateIgnoringOtherApps_(True)
                log.info("_bring_to_front: NSApp unhide + activate")
            except Exception:
                log.exception("NSApp activate failed")

            # Recenter in case geometry drifted off-screen
            try:
                sw = self.root.winfo_screenwidth()
                sh = self.root.winfo_screenheight()
                x = max(20, (sw - APP_W) // 2)
                y = max(20, (sh - APP_H) // 3)
                self.root.geometry(f"{APP_W}x{APP_H}+{x}+{y}")
            except Exception:
                pass

            self.root.wm_state("normal")
            self.root.deiconify()
            self.root.update_idletasks()
            self.root.lift()
            self.root.focus_force()
            self.root.attributes("-topmost", True)
            self.root.after(250, lambda: self.root.attributes("-topmost", False))

            # Re-log state after the whole chain ran
            try:
                log.info("_bring_to_front: post-state=%s geom=%s viewable=%s",
                         self.root.wm_state(),
                         self.root.geometry(),
                         self.root.winfo_viewable())
            except Exception:
                pass
        except tk.TclError:
            log.exception("_bring_to_front: Tcl error")

    # --- UI layout ---------------------------------------------------------

    def _build_ui(self) -> None:
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(1, weight=1)

        self._build_top_bar()
        self._build_middle()
        self._build_bottom_bar()

    def _build_top_bar(self) -> None:
        bar = ttk.Frame(self.root, padding=(12, 10))
        bar.grid(row=0, column=0, sticky="ew")
        bar.columnconfigure(1, weight=1)

        ttk.Label(bar, text="Source:", font=("Helvetica", 12, "bold")).grid(
            row=0, column=0, sticky="w", padx=(0, 6))
        self.source_var = tk.StringVar(value="no file selected")
        entry = ttk.Entry(bar, textvariable=self.source_var, state="readonly")
        entry.grid(row=0, column=1, sticky="ew")
        attach_tooltip(entry, TIPS["source"])

        btn = ttk.Button(bar, text="Browse…", command=self._on_pick_source)
        btn.grid(row=0, column=2, padx=(8, 0))

        self.edit_btn = ttk.Button(bar, text="Edit art…",
                                    command=self._on_edit_art,
                                    state="disabled")
        self.edit_btn.grid(row=0, column=3, padx=(6, 0))
        attach_tooltip(
            self.edit_btn,
            "Open a quick editor to crop the art, rotate/flip, or pick and "
            "remove/replace colors before separation. Edits stay in-memory "
            "(the original file on disk isn't modified).",
        )

    def _build_middle(self) -> None:
        mid = ttk.Frame(self.root, padding=(12, 0))
        mid.grid(row=1, column=0, sticky="nsew")
        mid.columnconfigure(0, weight=1)
        mid.columnconfigure(1, weight=1)
        mid.rowconfigure(0, weight=1)

        self._build_preview_panel(mid)
        self._build_form_panel(mid)

    def _build_preview_panel(self, parent: ttk.Frame) -> None:
        box = ttk.LabelFrame(parent, text="Source preview", padding=8)
        box.grid(row=0, column=0, sticky="nsew", padx=(0, 6))
        box.columnconfigure(0, weight=1)
        box.rowconfigure(0, weight=1)

        self.preview_canvas = tk.Canvas(
            box, background="#f4f4f4", highlightthickness=0,
        )
        self.preview_canvas.grid(row=0, column=0, sticky="nsew")

        # Analysis var is still used internally (mode/color-count pre-fill
        # comes from it) but no longer displayed — removed per operator
        # request. If we need to show it again, uncomment the label below.
        self.analysis_var = tk.StringVar(value="")

        # --- Detected palette review ---
        # Shows swatches for each detected ink. Click a swatch to toggle
        # it on/off. Click "+ Sample color" to arm the eyedropper, then
        # click on the preview to add a sampled pixel color as a new ink.
        hdr_row = ttk.Frame(box)
        hdr_row.grid(row=1, column=0, sticky="ew", pady=(10, 2))
        hdr_row.columnconfigure(1, weight=1)

        ttk.Label(hdr_row, text="Detected inks:",
                  font=("Helvetica", 11, "bold"),
                  foreground="#222").grid(row=0, column=0, sticky="w")
        self.eyedrop_btn = ttk.Button(
            hdr_row, text="+ Sample color",
            command=self._toggle_eyedropper, state="disabled",
        )
        self.eyedrop_btn.grid(row=0, column=1, sticky="w", padx=(10, 0))
        attach_tooltip(
            self.eyedrop_btn,
            "Arm the eyedropper, then click anywhere on the source preview "
            "to sample that pixel's color and add it as a new ink. Use for "
            "colors the auto-detect missed — e.g. a small accent that fell "
            "below the minimum-coverage threshold."
        )

        self.palette_frame = ttk.Frame(box)
        self.palette_frame.grid(row=2, column=0, sticky="ew")

        self.palette_hint_var = tk.StringVar(
            value="(palette appears after a file is loaded)"
        )
        ttk.Label(box, textvariable=self.palette_hint_var,
                  foreground="#888", font=("Helvetica", 10)).grid(
            row=3, column=0, sticky="w", pady=(4, 0))

    def _build_form_panel(self, parent: ttk.Frame) -> None:
        form = ttk.LabelFrame(parent, text="Job settings", padding=10)
        form.grid(row=0, column=1, sticky="nsew")
        form.columnconfigure(1, weight=1)

        row = 0

        # Mode
        self.mode_var = tk.StringVar(value="spot-flat")
        self._field(form, row, "Mode",
                    ttk.Combobox(form, textvariable=self.mode_var, state="readonly",
                                 values=["spot-layered", "spot-flat", "sim-process"],
                                 width=20),
                    TIPS["mode"])
        row += 1

        # Garment color
        self.garment_var = tk.StringVar(value="black")
        self._field(form, row, "Garment color",
                    ttk.Combobox(form, textvariable=self.garment_var, state="readonly",
                                 values=["black", "white", "navy", "charcoal",
                                         "royal", "heather", "red", "natural"],
                                 width=20),
                    TIPS["garment"])
        row += 1

        # Ink system
        self.ink_var = tk.StringVar(value="waterbase")
        self._field(form, row, "Ink system",
                    ttk.Combobox(form, textvariable=self.ink_var, state="readonly",
                                 values=["waterbase", "discharge"], width=20),
                    TIPS["ink_system"])
        row += 1

        # Print width
        self.width_var = tk.StringVar(value="12.0")
        self._field(form, row, "Print width (in)",
                    ttk.Entry(form, textvariable=self.width_var, width=10),
                    TIPS["print_width"])
        row += 1

        # Print height
        self.height_var = tk.StringVar(value="")
        self._field(form, row, "Print height (in)",
                    ttk.Entry(form, textvariable=self.height_var, width=10),
                    TIPS["print_height"])
        row += 1

        # Film DPI
        self.dpi_var = tk.StringVar(value=str(FILM_DPI_DEFAULT))
        self._field(form, row, "Film DPI",
                    ttk.Combobox(form, textvariable=self.dpi_var, state="readonly",
                                 values=["720", "360"], width=10),
                    TIPS["film_dpi"])
        row += 1

        # Media size (physical sheet to print films on)
        self.media_var = tk.StringVar(value="auto")
        self._field(form, row, "Media size",
                    ttk.Combobox(form, textvariable=self.media_var, state="readonly",
                                 values=["auto", "8.5 × 11", "13 × 19"], width=14),
                    TIPS["media_size"])
        row += 1

        # Enhancement (pre-processing before sep detection)
        self.enhance_var = tk.StringVar(value="light")
        self._field(form, row, "Enhance art",
                    ttk.Combobox(form, textvariable=self.enhance_var, state="readonly",
                                 values=["none", "light", "strong", "vectorize"],
                                 width=14),
                    TIPS["enhance"])
        row += 1

        # Background exclusion (canvas vs print)
        self.exclude_bg_var = tk.StringVar(value="auto")
        self._field(form, row, "Exclude background",
                    ttk.Combobox(form, textvariable=self.exclude_bg_var,
                                 state="readonly",
                                 values=["off", "auto", "alpha-only"],
                                 width=14),
                    TIPS["exclude_background"])
        row += 1

        # Max colors
        self.max_colors_var = tk.StringVar(value="6")
        self._field(form, row, "Max colors",
                    ttk.Spinbox(form, from_=1, to=8, textvariable=self.max_colors_var,
                                width=5, state="readonly"),
                    TIPS["max_colors"])
        row += 1

        # Job label
        self.label_var = tk.StringVar(value="")
        self._field(form, row, "Job label",
                    ttk.Entry(form, textvariable=self.label_var, width=22),
                    TIPS["job_label"])
        row += 1

        # Mirror
        self.mirror_var = tk.BooleanVar(value=False)
        self._checkbox_field(form, row, "Mirror (emulsion-down)",
                             self.mirror_var, TIPS["mirror"])
        row += 1

        # Double strike
        self.double_var = tk.BooleanVar(value=False)
        self._checkbox_field(form, row, "Double strike",
                             self.double_var, TIPS["double_strike"])
        row += 1

        # Output dir
        self.output_var = tk.StringVar(value=str(DEFAULT_OUTPUT_ROOT))
        out_label = ttk.Label(form, text="Output folder")
        out_label.grid(row=row, column=0, sticky="w", pady=2)
        out_q = self._qmark(form, TIPS["output_dir"])
        out_q.grid(row=row, column=0, sticky="e", padx=(0, 4), pady=2)
        out_row = ttk.Frame(form)
        out_row.grid(row=row, column=1, sticky="ew", pady=2)
        out_row.columnconfigure(0, weight=1)
        ttk.Entry(out_row, textvariable=self.output_var).grid(row=0, column=0, sticky="ew")
        ttk.Button(out_row, text="…", width=3, command=self._on_pick_output).grid(
            row=0, column=1, padx=(4, 0))
        row += 1

    def _field(self, parent, row: int, label: str, widget, tip: str) -> None:
        lbl = ttk.Label(parent, text=label)
        lbl.grid(row=row, column=0, sticky="w", pady=2)
        q = self._qmark(parent, tip)
        q.grid(row=row, column=0, sticky="e", padx=(0, 4), pady=2)
        widget.grid(row=row, column=1, sticky="w", pady=2)
        attach_tooltip(lbl, tip)
        attach_tooltip(widget, tip)

    def _checkbox_field(self, parent, row: int, label: str,
                         var: tk.BooleanVar, tip: str) -> None:
        q = self._qmark(parent, tip)
        q.grid(row=row, column=0, sticky="e", padx=(0, 4), pady=2)
        cb = ttk.Checkbutton(parent, text=label, variable=var)
        cb.grid(row=row, column=1, sticky="w", pady=2)
        attach_tooltip(cb, tip)

    def _qmark(self, parent, tip: str) -> tk.Widget:
        """A small '?' widget with a tooltip. Uses a ttk.Label so it inherits theme."""
        lbl = ttk.Label(
            parent, text="?", foreground="#2d62b3", cursor="question_arrow",
            font=("Helvetica", 11, "bold"),
        )
        attach_tooltip(lbl, tip)
        return lbl

    def _build_bottom_bar(self) -> None:
        bot = ttk.Frame(self.root, padding=(12, 10))
        bot.grid(row=2, column=0, sticky="ew")
        bot.columnconfigure(0, weight=1)

        # Log area
        log_frame = ttk.LabelFrame(bot, text="Log", padding=4)
        log_frame.grid(row=0, column=0, sticky="ew", columnspan=3, pady=(0, 8))
        log_frame.columnconfigure(0, weight=1)

        self.log_text = tk.Text(
            log_frame, height=7, wrap="word",
            background="#1e1e1e", foreground="#d4d4d4",
            font=("Menlo", 10),
        )
        self.log_text.grid(row=0, column=0, sticky="ew")
        self.log_text.configure(state="disabled")
        scroll = ttk.Scrollbar(log_frame, command=self.log_text.yview)
        scroll.grid(row=0, column=1, sticky="ns")
        self.log_text.configure(yscrollcommand=scroll.set)

        # Progress bar + status text
        self.status_var = tk.StringVar(value="ready")
        ttk.Label(bot, textvariable=self.status_var, foreground="#555").grid(
            row=1, column=0, sticky="w")

        self.progress = ttk.Progressbar(
            bot, mode="determinate", length=320,
        )
        self.progress.grid(row=1, column=1, padx=8, sticky="e")

        # Buttons
        btn_frame = ttk.Frame(bot)
        btn_frame.grid(row=1, column=2, sticky="e")

        self.render_btn = ttk.Button(
            btn_frame, text="Render & Preview", command=self._on_render,
        )
        self.render_btn.grid(row=0, column=0, padx=(0, 6))
        attach_tooltip(self.render_btn, TIPS["render"])

        self.print_btn = ttk.Button(
            btn_frame, text="Print", command=self._on_print,
            state="disabled",
        )
        self.print_btn.grid(row=0, column=1)
        attach_tooltip(self.print_btn, TIPS["print"])

    # --- Actions -----------------------------------------------------------

    def _on_pick_source(self) -> None:
        path = filedialog.askopenfilename(
            title="Pick an art file",
            filetypes=[
                ("Supported", "*.psd *.psb *.png *.jpg *.jpeg *.tif *.tiff *.pdf *.bmp *.gif"),
                ("All files", "*.*"),
            ],
        )
        if path:
            self._load_source(Path(path))

    def _on_pick_output(self) -> None:
        d = filedialog.askdirectory(
            title="Where should films be saved?",
            initialdir=self.output_var.get() or str(DEFAULT_OUTPUT_ROOT),
        )
        if d:
            self.output_var.set(d)

    def _on_edit_art(self) -> None:
        """Open the ArtEditor on the current source (or prior edit)."""
        if not self.source_path:
            return
        try:
            base_img = self.edited_image if self.edited_image is not None \
                else _load_source_thumbnail(self.source_path)
        except Exception as e:
            messagebox.showerror("Load failed",
                                  f"Could not load the source for editing:\n{e}")
            return
        ArtEditor(self.root, base_img, on_apply=self._on_edit_applied)

    def _on_edit_applied(self, edited: "Image.Image") -> None:
        """Callback from ArtEditor: store edited image + refresh previews."""
        self.edited_image = edited
        log.info("edit applied: %dx%d", edited.size[0], edited.size[1])
        self._log(f"edits applied ({edited.size[0]}×{edited.size[1]})")
        # Re-run analyzer on the edited image (temp-file path so analyze()
        # can use its existing file-based signature)
        try:
            import tempfile, os
            tmp = tempfile.NamedTemporaryFile(
                prefix="filmseps-edited-", suffix=".png", delete=False,
            )
            edited.save(tmp.name, "PNG")
            tmp.close()
            self.analysis = analyze(Path(tmp.name))
            self._update_analysis_display()
            os.unlink(tmp.name)
        except Exception:
            log.exception("re-analyze after edit failed")
        # Refresh preview pane to show the edited image
        self._render_preview_image(edited)
        # Indicate edited state in the source field
        self.source_var.set(f"{self.source_path}  (edited)")

    def _load_source(self, path: Path) -> None:
        log.info("_load_source: entering for %s", path)
        self.source_path = path
        self.source_var.set(str(path))
        self.label_var.set(self.label_var.get() or path.stem)
        # New source — discard any lingering edits from a previous file
        self.edited_image = None
        try:
            self.edit_btn.configure(state="normal")
            self.eyedrop_btn.configure(state="normal")
        except Exception:
            pass
        self._log(f"loaded: {path.name}")
        log.info("_load_source: Tk vars set")

        try:
            log.info("_load_source: analyzing…")
            self.analysis = analyze(path)
            log.info("_load_source: analysis → mode=%s colors=%d",
                     self.analysis.mode, self.analysis.distinct_colors)
            self._update_analysis_display()
            log.info("_load_source: analysis display updated")
            self._show_preview(path)
            log.info("_load_source: preview rendered")
        except Exception:
            log.exception("_load_source: FAILED")
            try:
                messagebox.showerror("Analyze failed",
                                     f"Could not load {path.name}.\n\n"
                                     f"See ~/Library/Logs/FilmSeps.log for details.")
            except Exception:
                log.exception("messagebox failed too")
            self._log(f"analyze error: see log")

    def _update_analysis_display(self) -> None:
        a = self.analysis
        if not a:
            return

        lines = [f"Recommended mode: {a.mode}"]
        for r in a.reasoning:
            lines.append(f"  • {r}")
        if a.source_size:
            w, h = a.source_size
            lines.append(f"Source: {w}×{h} px"
                         + (f" @ {a.source_dpi} DPI" if a.source_dpi else ""))
        self.analysis_var.set("\n".join(lines))

        # Pre-fill form from recommendation
        self.mode_var.set(a.mode)
        self.max_colors_var.set(str(a.suggested_color_count or 4))
        # Re-run full color detection and populate the palette swatches
        self._refresh_detected_palette()

    def _refresh_detected_palette(self) -> None:
        """Run color_detect on the current source at the currently-selected
        ink count + garment + bg exclusion, and render swatches."""
        # Clear previous swatches
        for w in self.palette_frame.winfo_children():
            w.destroy()

        src_img = self.edited_image
        if src_img is None and self.source_path:
            try:
                src_img = _load_source_thumbnail(self.source_path)
            except Exception:
                self.palette_hint_var.set("(couldn't load source for palette)")
                return
        if src_img is None:
            return

        try:
            from color_detect import detect_ink_colors, resolve_unique_names
            try:
                n = int(self.max_colors_var.get())
            except ValueError:
                n = 4
            garment = _garment_rgb(self.garment_var.get())
            detected = detect_ink_colors(src_img, n_colors=n, garment_rgb=garment)
            names = resolve_unique_names(detected)
            for c, nm in zip(detected, names):
                c["suggested_name"] = nm
                c["enabled"] = True
            self.detected_palette = detected
        except Exception:
            log.exception("palette detection failed")
            self.palette_hint_var.set("(palette detection failed — see log)")
            return

        if not self.detected_palette:
            self.palette_hint_var.set("(no inks detected)")
            return

        self._render_palette_swatches()
        enabled = sum(1 for c in self.detected_palette if c["enabled"])
        total = len(self.detected_palette)
        self.palette_hint_var.set(
            f"{enabled} of {total} inks will be sepped. "
            f"Click a swatch to exclude it."
        )

    def _render_palette_swatches(self) -> None:
        SWATCH_W, SWATCH_H = 78, 64
        for col, c in enumerate(self.detected_palette):
            r, g, b = c["rgb"]
            hex_fg = "#fff" if (0.299 * r + 0.587 * g + 0.114 * b) < 110 else "#111"
            hex_bg = f"#{r:02x}{g:02x}{b:02x}"
            enabled = c["enabled"]

            tile = tk.Frame(self.palette_frame, cursor="hand2")
            tile.grid(row=0, column=col, padx=(0, 6))

            canvas = tk.Canvas(
                tile, width=SWATCH_W, height=SWATCH_H,
                background=hex_bg if enabled else "#e0e0e0",
                highlightthickness=2,
                highlightbackground="#555" if enabled else "#bbb",
            )
            canvas.pack()

            # Disabled overlay — big X through the swatch
            if not enabled:
                canvas.create_line(2, 2, SWATCH_W - 4, SWATCH_H - 4,
                                    fill="#888", width=3)
                canvas.create_line(2, SWATCH_H - 4, SWATCH_W - 4, 2,
                                    fill="#888", width=3)

            # Name + coverage text on the tile
            canvas.create_text(
                SWATCH_W / 2, SWATCH_H / 2 - 6,
                text=c["suggested_name"],
                fill=hex_fg if enabled else "#999",
                font=("Helvetica", 10, "bold"),
            )
            canvas.create_text(
                SWATCH_W / 2, SWATCH_H / 2 + 10,
                text=f"{c['fraction'] * 100:.1f}%",
                fill=hex_fg if enabled else "#999",
                font=("Helvetica", 9),
            )

            # Click to toggle
            def make_toggle(idx):
                return lambda e=None: self._toggle_palette_entry(idx)
            canvas.bind("<Button-1>", make_toggle(col))

    def _toggle_palette_entry(self, idx: int) -> None:
        if 0 <= idx < len(self.detected_palette):
            self.detected_palette[idx]["enabled"] = not self.detected_palette[idx]["enabled"]
            self._render_palette_swatches()
            enabled = sum(1 for c in self.detected_palette if c["enabled"])
            total = len(self.detected_palette)
            self.palette_hint_var.set(
                f"{enabled} of {total} inks will be sepped. "
                f"Click a swatch to toggle."
            )

    # --- eyedropper ---------------------------------------------------------

    def _toggle_eyedropper(self) -> None:
        """Arm / disarm the eyedropper. While armed, a click on the preview
        canvas samples that pixel's color and appends it to the palette."""
        self._eyedrop_active = not self._eyedrop_active
        if self._eyedrop_active:
            self.eyedrop_btn.configure(text="Cancel sample")
            self.preview_canvas.configure(cursor="tcross")
            self.preview_canvas.bind("<ButtonPress-1>", self._on_preview_sample)
            self.palette_hint_var.set(
                "Eyedropper armed — click anywhere on the preview to add that "
                "color as a new ink. Click Cancel sample to abort."
            )
        else:
            self.eyedrop_btn.configure(text="+ Sample color")
            self.preview_canvas.configure(cursor="")
            self.preview_canvas.unbind("<ButtonPress-1>")
            self._update_palette_hint()

    def _on_preview_sample(self, event) -> None:
        """Pick the pixel under the cursor, add as a new ink."""
        if self._preview_source_img is None:
            return
        # Map canvas coords back to source image pixels
        ox, oy = self._preview_offset
        sx = (event.x - ox) / max(self._preview_scale, 1e-6)
        sy = (event.y - oy) / max(self._preview_scale, 1e-6)
        iw, ih = self._preview_source_img.size
        if sx < 0 or sy < 0 or sx >= iw or sy >= ih:
            self.palette_hint_var.set("Clicked outside the image — try again.")
            return
        try:
            px = self._preview_source_img.getpixel((int(sx), int(sy)))
            if isinstance(px, int):
                px = (px, px, px)
            rgb = tuple(int(v) for v in px[:3])
        except Exception:
            log.exception("sample pixel failed")
            self._toggle_eyedropper()
            return

        # Avoid adding a near-duplicate of an existing ink
        from color_detect import rgb_to_lab, _suggest_lab_name
        import numpy as _np
        sampled_lab = rgb_to_lab(
            _np.array([rgb], dtype=_np.float32) / 255.0
        ).reshape(3)
        for existing in self.detected_palette:
            ex_lab = _np.array(existing["lab"], dtype=_np.float32)
            if _np.linalg.norm(ex_lab - sampled_lab) < 8:
                self.palette_hint_var.set(
                    f"RGB {rgb} is ~the same ink as "
                    f"'{existing['suggested_name']}' already in the palette."
                )
                self._toggle_eyedropper()
                return

        name = _suggest_lab_name(sampled_lab)
        # Avoid name collision with existing entries
        existing_names = {e["suggested_name"] for e in self.detected_palette}
        if name in existing_names:
            n = 2
            while f"{name}-{n}" in existing_names:
                n += 1
            name = f"{name}-{n}"

        self.detected_palette.append({
            "rgb": rgb,
            "lab": tuple(float(v) for v in sampled_lab),
            "pixel_count": 0,
            "fraction": 0.0,
            "suggested_name": name,
            "enabled": True,
            "sampled": True,  # marker: user-added, not auto-detected
        })
        log.info("eyedropper: added %s %s (sampled at source %d,%d)",
                 name, rgb, int(sx), int(sy))
        self._render_palette_swatches()
        self.palette_hint_var.set(
            f"Added '{name}' (RGB {rgb}) from sample at ({int(sx)}, {int(sy)})."
        )
        self._toggle_eyedropper()

    def _update_palette_hint(self) -> None:
        if not self.detected_palette:
            self.palette_hint_var.set("(no inks detected)")
            return
        enabled = sum(1 for c in self.detected_palette if c["enabled"])
        total = len(self.detected_palette)
        self.palette_hint_var.set(
            f"{enabled} of {total} inks will be sepped. "
            "Click a swatch to toggle; + Sample color adds one manually."
        )

    def _show_preview(self, path: Path) -> None:
        log.info("_show_preview: opening thumbnail for %s", path)
        try:
            img = _load_source_thumbnail(path)
        except Exception:
            log.exception("_show_preview: thumbnail load failed")
            return
        self._render_preview_image(img)

    def _render_preview_image(self, img: "Image.Image") -> None:
        """Draw `img` into the preview canvas and track scale + offset so
        eyedropper clicks can map canvas coords back to source pixels."""
        self.root.update_idletasks()
        cw = max(320, self.preview_canvas.winfo_width())
        ch = max(200, self.preview_canvas.winfo_height())
        iw, ih = img.size
        scale = min((cw - 16) / iw, (ch - 16) / ih, 1.0)
        disp_w = max(1, int(iw * scale))
        disp_h = max(1, int(ih * scale))
        offset_x = (cw - disp_w) // 2
        offset_y = (ch - disp_h) // 2

        thumb = img.resize((disp_w, disp_h),
                            Image.LANCZOS if scale < 1 else Image.NEAREST)
        try:
            self._preview_imgtk = ImageTk.PhotoImage(thumb)
        except Exception:
            log.exception("_show_preview: PhotoImage failed")
            return

        self.preview_canvas.delete("all")
        self.preview_canvas.create_image(
            offset_x + disp_w // 2, offset_y + disp_h // 2,
            image=self._preview_imgtk, anchor="center",
        )

        # Remember what's on screen — eyedropper sampling needs this
        self._preview_source_img = img
        self._preview_scale = scale
        self._preview_offset = (offset_x, offset_y)
        log.info("_show_preview: rendered scale=%.3f offset=(%d,%d)",
                 scale, offset_x, offset_y)

    def _on_render(self) -> None:
        if not self.source_path:
            messagebox.showwarning("No source", "Pick an art file first.")
            return

        try:
            width = float(self.width_var.get())
        except ValueError:
            messagebox.showerror("Bad width", "Print width must be a number of inches.")
            return

        height: float | None
        if self.height_var.get().strip():
            try:
                height = float(self.height_var.get())
            except ValueError:
                messagebox.showerror("Bad height",
                                     "Height must be a number or left blank.")
                return
        else:
            height = None

        try:
            dpi = int(self.dpi_var.get())
        except ValueError:
            dpi = FILM_DPI_DEFAULT

        try:
            max_colors = int(self.max_colors_var.get())
        except ValueError:
            max_colors = 6

        label = self.label_var.get().strip() or self.source_path.stem
        ink = self.ink_var.get()
        mode = self.mode_var.get()
        garment = self.garment_var.get()

        # Output dir: timestamped subfolder under the user-picked root
        root_dir = Path(self.output_var.get()).expanduser()
        stamp = datetime.now().strftime("%y%m%d-%H%M%S")
        safe_label = "-".join(
            c if c.isalnum() else "-"
            for c in label.lower()
        ).replace("---", "-").replace("--", "-").strip("-")
        job_dir = root_dir / f"{stamp}-{safe_label or 'untitled'}"
        out_films = job_dir / "films"

        # Resolve media-size choice → SheetSize override (None = auto-pick)
        media_choice = self.media_var.get()
        sheet_override = None
        if media_choice.startswith("8.5"):
            from preferences import SHEET_SMALL
            sheet_override = SHEET_SMALL
        elif media_choice.startswith("13"):
            from preferences import SHEET_LARGE
            sheet_override = SHEET_LARGE

        cfg = DriverConfig(
            ink_system=ink,
            garment_color=garment,
            film_dpi=dpi,
            mirror=self.mirror_var.get(),
            label_prefix=label,
            sheet_size=sheet_override,
        )

        self.render_btn.configure(state="disabled")
        self.print_btn.configure(state="disabled")
        self.progress.configure(value=0, maximum=100)
        self.status_var.set("starting…")
        self._log(f"— render start — {self.source_path.name} → {job_dir}")

        enhance_level = self.enhance_var.get()
        exclude_bg_mode = self.exclude_bg_var.get()

        # If the operator edited the art in the ArtEditor, we start the
        # pipeline from that PIL image (saved to a temp PNG so every
        # downstream component — enhance, bg, drive — can treat it as a
        # normal file path).
        edited_snapshot = self.edited_image.copy() if self.edited_image else None

        # User-curated palette: only pass through if the operator either
        # toggled a swatch off OR sampled a color with the eyedropper. If
        # the palette is untouched auto-detect output, let the driver do
        # its own fresh detection (so cluster merges etc. still apply).
        curated_palette = None
        if self.detected_palette:
            enabled_inks = [dict(c) for c in self.detected_palette if c.get("enabled")]
            any_disabled = any(not c.get("enabled", True) for c in self.detected_palette)
            any_sampled = any(c.get("sampled") for c in self.detected_palette)
            if (any_disabled or any_sampled) and enabled_inks:
                curated_palette = enabled_inks
                log.info("curated palette: %d enabled inks "
                         "(%d sampled, %d disabled)",
                         len(enabled_inks),
                         sum(1 for c in self.detected_palette if c.get("sampled")),
                         sum(1 for c in self.detected_palette if not c.get("enabled", True)))

        t = threading.Thread(
            target=self._render_worker,
            args=(self.source_path, out_films, width, height, cfg, mode,
                  max_colors, label, job_dir, enhance_level, exclude_bg_mode,
                  edited_snapshot, curated_palette),
            daemon=True,
        )
        t.start()

    def _render_worker(self, source, out_films, width, height, cfg, mode,
                       max_colors, label, job_dir, enhance_level="light",
                       exclude_bg_mode="auto", edited_image=None,
                       curated_palette=None):
        try:
            def progress_cb(step: str, cur: int, total: int) -> None:
                self._q.put(("progress", step, cur, total))

            # If the editor was used, save the edited PIL image to the job
            # folder and use it as the effective source. Downstream stages
            # (enhance, bg, drive) all operate on this file going forward.
            source_for_drive = source
            working_img = None
            if edited_image is not None:
                job_dir.mkdir(parents=True, exist_ok=True)
                edited_path = job_dir / "edited-source.png"
                edited_image.save(str(edited_path), "PNG")
                source_for_drive = edited_path
                working_img = edited_image
                log.info("using edited image: %s", edited_path)
            if enhance_level and enhance_level != "none":
                self._q.put(("progress", f"enhancing ({enhance_level})", 0, 0))
                try:
                    from enhance import enhance as _enhance
                    # Use the edited image if the operator ran the editor,
                    # else load the raw source from disk.
                    pil = working_img if working_img is not None \
                        else _load_source_thumbnail(source)
                    garment = _garment_rgb(cfg.garment_color)
                    res = _enhance(
                        pil, level=enhance_level,
                        target_colors=max_colors, garment_rgb=garment,
                    )
                    working_img = res.image
                    log.info("enhance: %s → %dx%d (%s)",
                             enhance_level, res.image.size[0], res.image.size[1],
                             "; ".join(res.notes))
                except Exception:
                    log.exception("enhance pass failed — using raw source")

            # --- Background exclusion (canvas vs print) ---
            if exclude_bg_mode and exclude_bg_mode != "off":
                self._q.put(("progress", "detecting background", 0, 0))
                try:
                    from background import (
                        detect_background_mask, apply_background_mask,
                    )
                    # Work on either the enhanced image OR the raw source if
                    # enhance was 'none'. Respect alpha on the raw source
                    # (enhance converts to RGB which drops alpha).
                    pil_for_bg = working_img or _load_source_thumbnail(source)
                    # If enhance ran and the original had alpha, we've already
                    # lost transparency info — reload the raw source for alpha
                    # detection in this case.
                    if working_img is not None and _source_has_alpha(source):
                        pil_for_bg = _load_source_keep_alpha(source)
                    garment = _garment_rgb(cfg.garment_color)
                    bg_mask = detect_background_mask(
                        pil_for_bg,
                        garment_rgb=garment,
                        mode=exclude_bg_mode,
                    )
                    if bg_mask is not None:
                        # Replace bg pixels in the working image with garment
                        # color so downstream filters drop them
                        base = working_img or _load_source_thumbnail(source)
                        # bg_mask shape must match base; if not, rescale
                        if bg_mask.shape != (base.size[1], base.size[0]):
                            from PIL import Image as _I
                            bg_img = _I.fromarray(
                                (bg_mask.astype("uint8") * 255), mode="L",
                            ).resize(base.size, _I.NEAREST)
                            import numpy as _np
                            bg_mask = _np.array(bg_img) > 127
                        working_img = apply_background_mask(
                            base, bg_mask, garment,
                        )
                        log.info("bg exclusion: replaced %d bg pixels with garment",
                                 int(bg_mask.sum()))
                    else:
                        log.info("bg exclusion: no background detected")
                except Exception:
                    log.exception("bg exclusion failed — continuing without it")

            # Save whatever we ended up with as the source the driver will read
            if working_img is not None:
                job_dir.mkdir(parents=True, exist_ok=True)
                processed_path = job_dir / "processed-source.png"
                working_img.save(str(processed_path), "PNG")
                source_for_drive = processed_path

            result = drive(
                source_path=source_for_drive,
                output_dir=out_films,
                print_width_in=width,
                print_height_in=height,
                cfg=cfg,
                mode=mode,
                max_colors=max_colors,
                label_prefix=label,
                progress=progress_cb,
                user_palette=curated_palette,
            )
            # Remember which source we actually used — preview + label use this
            result["_enhanced_source"] = str(source_for_drive) if source_for_drive != source else None
            result["_enhance_level"] = enhance_level

            # Build the contact-sheet PNG for on-disk reference (saved next
            # to the films). The interactive per-film viewer is opened from
            # the Tk thread in _handle("done") below.
            if result.get("success"):
                self._q.put(("progress", "building preview", 0, 0))
                try:
                    src_img = _load_source_thumbnail(source)
                    preview_path = job_dir / "preview.png"
                    header = (f"{label} — {width}\" on {cfg.garment_color} "
                              f"({cfg.ink_system})")
                    build_contact_sheet(src_img, result["films"], header, preview_path)
                    result["preview_path"] = str(preview_path)
                    result["_source_path"] = str(source)
                    result["_header"] = header
                except Exception as e:
                    result.setdefault("warnings", []).append(f"preview: {e}")

            self._q.put(("done", result))
        except Exception as e:
            self._q.put(("error", e, traceback.format_exc()))

    def _on_print(self) -> None:
        if not self.render_result or not self.render_result.get("success"):
            return
        try:
            cfg = PrinterConfig.load()
        except Exception as e:
            messagebox.showerror("Printer not configured",
                                 f"{e}\n\nRun configure_printer.py first.")
            return

        if self.double_var.get():
            cfg.double_strike = True

        if not messagebox.askyesno(
            "Print films",
            f"Submit {len(self.render_result['films'])} films to "
            f"{cfg.queue}"
            f"{' (2× double strike)' if cfg.double_strike else ''}?",
        ):
            return

        self.render_btn.configure(state="disabled")
        self.print_btn.configure(state="disabled")
        self.status_var.set("submitting to printer…")
        self._log(f"— submitting to {cfg.queue} —")

        t = threading.Thread(
            target=self._print_worker, args=(cfg,), daemon=True,
        )
        t.start()

    def _print_worker(self, cfg: PrinterConfig):
        try:
            sheet = self.render_result["sheet"]["name"]
            label = self.label_var.get() or "job"
            jobs = [
                PrintJob(
                    path=Path(f["path"]),
                    title=f"{label} — {f['name']}",
                    sheet_name=sheet,
                )
                for f in self.render_result["films"]
            ]
            results = submit_many(cfg, jobs)
            self._q.put(("print-done", results))
        except Exception as e:
            self._q.put(("error", e, traceback.format_exc()))

    # --- UI thread queue drain --------------------------------------------

    def _drain_queue(self) -> None:
        try:
            while True:
                msg = self._q.get_nowait()
                self._handle(msg)
        except queue.Empty:
            pass
        self.root.after(80, self._drain_queue)

    def _handle(self, msg: tuple) -> None:
        kind = msg[0]
        if kind == "progress":
            _, step, cur, total = msg
            self.status_var.set(step)
            if total > 0:
                self.progress.configure(maximum=total, value=cur)
            self._log(f"… {step}")
        elif kind == "done":
            _, result = msg
            self.render_result = result
            self.render_btn.configure(state="normal")
            if result.get("success"):
                self.progress.configure(value=self.progress["maximum"])
                self.status_var.set(f"✓ {len(result['films'])} films rendered")
                self._log(f"✓ {len(result['films'])} films in "
                          f"{result['elapsed_seconds']}s")
                for w in result.get("warnings", []):
                    self._log(f"  warn: {w}")
                self.print_btn.configure(state="normal")
                # Open the interactive sep flipper on the Tk thread
                self._open_sep_viewer(result)
            else:
                self.status_var.set("✗ render failed")
                self._log("✗ render failed — no films produced")
                for w in result.get("warnings", []):
                    self._log(f"  warn: {w}")
        elif kind == "print-done":
            _, results = msg
            ok = sum(1 for r in results if r.get("status") == "submitted")
            fail = sum(1 for r in results if r.get("status") == "failed")
            self.render_btn.configure(state="normal")
            self.print_btn.configure(state="normal")
            if fail:
                self.status_var.set(f"✗ {fail} failed, {ok} submitted")
                self._log(f"✗ {fail} print submissions failed")
                for r in results:
                    if r.get("status") == "failed":
                        self._log(f"    {r.get('film')}: {r.get('stderr','')}")
            else:
                self.status_var.set(f"✓ {ok} films submitted to printer")
                self._log(f"✓ {ok} films sent to Epson")
        elif kind == "error":
            _, err, tb = msg
            self.render_btn.configure(state="normal")
            self.status_var.set(f"✗ error: {err}")
            self._log(f"✗ {err}")
            self._log(tb)
        elif kind == "open-file":
            # Dropped on Dock icon or 'Open With...' from Finder.
            # Runs on the Tk thread, so it's safe to touch widgets.
            _, raw_path = msg
            path = Path(raw_path)
            log.info("handling open-file: %s (exists=%s)", path, path.exists())
            if path.exists():
                self._load_source(path)
                self._bring_to_front()
            else:
                self._log(f"dropped file not found: {path}")

    # --- Misc --------------------------------------------------------------

    def _open_sep_viewer(self, result: dict) -> None:
        """Open the per-film flipper window. Runs on the Tk thread."""
        try:
            src_path = result.get("_source_path")
            header = result.get("_header", "Film Seps Preview")
            if not src_path:
                return
            src_img = _load_source_thumbnail(Path(src_path))
            viewer = SepViewer(
                parent=self.root,
                source_image=src_img,
                films=result.get("films", []),
                header=header,
            )
            # Stack it above the main window
            viewer.lift(self.root)
            viewer.focus_set()
            log.info("opened SepViewer with %d slides", len(result.get('films', [])) + 1)
        except Exception:
            log.exception("failed to open SepViewer")
            self._log("warn: couldn't open sep viewer — see FilmSeps.log")

    def _log(self, line: str) -> None:
        self.log_text.configure(state="normal")
        self.log_text.insert("end", f"{line}\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def run(self) -> None:
        self.root.mainloop()


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    initial: Path | None = None
    if args:
        p = Path(args[0]).expanduser()
        if p.exists():
            initial = p
    app = FilmSepsApp(initial_source=initial)
    app.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
