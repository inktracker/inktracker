#!/usr/bin/env python3
"""Film Seps — Tkinter GUI.

A real app window for the film-output driver. Studies incoming artwork,
recommends a sep mode, lets the operator adjust every knob (with hover
tooltips on every field), runs the render in a background thread with
a live progress bar, opens the preview in Preview.app, then submits
to the Epson.
"""

from __future__ import annotations

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
from film_driver import _load_source_thumbnail, drive  # noqa: E402
from preferences import DriverConfig, FILM_DPI_DEFAULT  # noqa: E402
from preview import build_contact_sheet, open_in_preview  # noqa: E402
from printer import PrinterConfig, PrintJob, submit_many  # noqa: E402
from tooltip import attach as attach_tooltip  # noqa: E402


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

        # Background-thread → main-thread message queue
        self._q: queue.Queue = queue.Queue()

        # Keep a reference to the preview thumbnail so Tk doesn't GC it
        self._preview_imgtk: ImageTk.PhotoImage | None = None

        self._build_ui()
        self._drain_queue()

        if initial_source:
            self._load_source(initial_source)

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

        self.analysis_var = tk.StringVar(value="Pick a file to begin.")
        analysis_lbl = ttk.Label(
            box, textvariable=self.analysis_var, justify="left",
            wraplength=440, foreground="#333",
        )
        analysis_lbl.grid(row=1, column=0, sticky="ew", pady=(8, 0))
        attach_tooltip(
            analysis_lbl,
            "Auto-analysis of the source: distinct color count, photoreal "
            "vs flat, and the driver's recommended mode. The mode dropdown "
            "on the right is pre-filled from this — you can always override."
        )

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

    def _load_source(self, path: Path) -> None:
        self.source_path = path
        self.source_var.set(str(path))
        self.label_var.set(self.label_var.get() or path.stem)
        self._log(f"loaded: {path.name}")

        # Analyze in the main thread — it's fast
        try:
            self.analysis = analyze(path)
            self._update_analysis_display()
            self._show_preview(path)
        except Exception as e:
            messagebox.showerror("Analyze failed", str(e))
            self._log(f"analyze error: {e}")

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

    def _show_preview(self, path: Path) -> None:
        try:
            img = _load_source_thumbnail(path)
        except Exception:
            return
        self.root.update_idletasks()
        cw = max(320, self.preview_canvas.winfo_width())
        ch = max(200, self.preview_canvas.winfo_height())
        thumb = img.copy()
        thumb.thumbnail((cw - 16, ch - 16), Image.LANCZOS)
        self._preview_imgtk = ImageTk.PhotoImage(thumb)
        self.preview_canvas.delete("all")
        self.preview_canvas.create_image(
            cw // 2, ch // 2, image=self._preview_imgtk, anchor="center",
        )

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

        cfg = DriverConfig(
            ink_system=ink,
            garment_color=garment,
            film_dpi=dpi,
            mirror=self.mirror_var.get(),
            label_prefix=label,
        )

        self.render_btn.configure(state="disabled")
        self.print_btn.configure(state="disabled")
        self.progress.configure(value=0, maximum=100)
        self.status_var.set("starting…")
        self._log(f"— render start — {self.source_path.name} → {job_dir}")

        t = threading.Thread(
            target=self._render_worker,
            args=(self.source_path, out_films, width, height, cfg, mode,
                  max_colors, label, job_dir),
            daemon=True,
        )
        t.start()

    def _render_worker(self, source, out_films, width, height, cfg, mode,
                       max_colors, label, job_dir):
        try:
            def progress_cb(step: str, cur: int, total: int) -> None:
                self._q.put(("progress", step, cur, total))

            result = drive(
                source_path=source,
                output_dir=out_films,
                print_width_in=width,
                print_height_in=height,
                cfg=cfg,
                mode=mode,
                max_colors=max_colors,
                label_prefix=label,
                progress=progress_cb,
            )

            # Build the preview contact sheet
            if result.get("success"):
                self._q.put(("progress", "building preview", 0, 0))
                try:
                    src_img = _load_source_thumbnail(source)
                    preview_path = job_dir / "preview.png"
                    header = (f"{label} — {width}\" on {cfg.garment_color} "
                              f"({cfg.ink_system})")
                    build_contact_sheet(src_img, result["films"], header, preview_path)
                    open_in_preview(preview_path)
                    result["preview_path"] = str(preview_path)
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
                          f"{result['elapsed_seconds']}s — preview open")
                for w in result.get("warnings", []):
                    self._log(f"  warn: {w}")
                self.print_btn.configure(state="normal")
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

    # --- Misc --------------------------------------------------------------

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
