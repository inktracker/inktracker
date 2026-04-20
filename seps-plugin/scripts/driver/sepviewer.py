"""In-app sep preview viewer — flip through one film at a time with
pixel-perfect zoom for inspecting individual halftone dots and edges.

Slide 0 is the source artwork; slides 1..N are the individual film TIFs.

Navigation
----------
- ← / → arrow keys or Prev / Next buttons: change slide
- click-drag: pan (only meaningful when zoomed in)
- +/= : zoom in,  − : zoom out
- 0 : fit to window,  1 : 100%,  2 : 200%,  4 : 400%,  8 : 800%
- Cmd + mouse wheel : zoom centered at cursor
- Esc : close

Implementation notes
--------------------
At zoom >= 1.0 we display the original film pixels via Image.NEAREST so
halftone dots remain crisp (no interpolation blur). At zoom < 1.0 we use
LANCZOS for smooth downsampling.

For memory/perf, we only crop the visible viewport from the full-res
image and resize that crop to canvas size — never upsample the whole
12k×12k film.
"""
from __future__ import annotations

import logging
import sys
import tkinter as tk
from pathlib import Path
from tkinter import ttk
from typing import Sequence

from PIL import Image, ImageTk


log = logging.getLogger("filmseps.sepviewer")


# Discrete zoom levels the +/- buttons step through.
ZOOM_STEPS = [0.125, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0]


class SepViewer(tk.Toplevel):
    def __init__(
        self,
        parent: tk.Misc,
        source_image: Image.Image,
        films: Sequence[dict],
        header: str = "Film Seps Preview",
    ) -> None:
        super().__init__(parent)
        self.title(f"{header} — Sep Viewer")
        self.geometry("1200x880")
        self.minsize(720, 560)

        # Build the slides list: source first, then each film
        self.slides: list[dict] = [
            {
                "title": "SOURCE",
                "subtitle": f"{source_image.size[0]}×{source_image.size[1]} px",
                "image": source_image.convert("RGB"),
                "kind": "source",
            }
        ]
        for f in films:
            try:
                img = Image.open(f["path"]).convert("L")
            except Exception as e:
                log.warning("could not open film %s: %s", f.get("path"), e)
                continue
            parts = [f"{f.get('mesh', '?')} mesh"]
            if f.get("angle") is not None:
                parts.append(f"{f.get('lpi', '?')} LPI @ {f['angle']}°")
            else:
                parts.append("solid")
            parts.append(f.get("purpose", "color"))
            self.slides.append({
                "title": f"{f.get('index', '?'):02d}  {f.get('ink', '?').upper()}",
                "subtitle": "  ·  ".join(parts),
                "image": img,
                "kind": "film",
                "path": f.get("path"),
            })

        # View state
        self.idx = 0
        self.fit_mode = True           # True = auto-fit; False = explicit zoom
        self.zoom = 1.0                 # only used when fit_mode is False
        self.pan_x = 0.0                # source-image-coord offset
        self.pan_y = 0.0
        self._drag_anchor: tuple[int, int, float, float] | None = None
        self._imgtk: ImageTk.PhotoImage | None = None

        self._build_ui()
        self._bind_keys()
        self._bind_mouse()

        self.focus_set()
        self._show()
        self.canvas.bind("<Configure>", lambda e: self._show())

    # ---- layout -----------------------------------------------------------

    def _build_ui(self) -> None:
        self.columnconfigure(0, weight=1)
        self.rowconfigure(1, weight=1)

        # Top bar — title + counter + zoom level
        top = ttk.Frame(self, padding=(14, 10))
        top.grid(row=0, column=0, sticky="ew")
        top.columnconfigure(0, weight=1)

        self.title_var = tk.StringVar()
        self.sub_var = tk.StringVar()
        self.counter_var = tk.StringVar()
        self.zoom_var = tk.StringVar()

        ttk.Label(top, textvariable=self.title_var,
                  font=("Helvetica", 18, "bold")).grid(row=0, column=0, sticky="w")
        ttk.Label(top, textvariable=self.zoom_var,
                  font=("Helvetica", 12, "bold"),
                  foreground="#d96f1f").grid(row=0, column=1, padx=(0, 12), sticky="e")
        ttk.Label(top, textvariable=self.counter_var,
                  foreground="#666").grid(row=0, column=2, sticky="e")
        ttk.Label(top, textvariable=self.sub_var,
                  foreground="#444").grid(row=1, column=0, columnspan=3, sticky="w")

        # Image canvas — dark background so film positives contrast nicely
        self.canvas = tk.Canvas(
            self, background="#2a2a2a",
            highlightthickness=0,
            cursor="fleur",  # hint: click-drag to pan
        )
        self.canvas.grid(row=1, column=0, sticky="nsew", padx=14, pady=(4, 8))

        # Bottom bar — nav buttons + zoom controls
        bot = ttk.Frame(self, padding=(14, 10))
        bot.grid(row=2, column=0, sticky="ew")
        bot.columnconfigure(1, weight=1)

        nav = ttk.Frame(bot)
        nav.grid(row=0, column=0, sticky="w")
        ttk.Button(nav, text="◀  Prev", command=self.prev).grid(row=0, column=0, padx=(0, 6))
        ttk.Button(nav, text="Next  ▶", command=self.next).grid(row=0, column=1)

        ttk.Label(bot, text="←/→ slides  ·  drag to pan  ·  +/− zoom  ·  0/1/2/4/8",
                  foreground="#666").grid(row=0, column=1)

        zoom_frame = ttk.Frame(bot)
        zoom_frame.grid(row=0, column=2, sticky="e")
        ttk.Button(zoom_frame, text="Fit", width=5, command=self.fit).grid(row=0, column=0)
        ttk.Button(zoom_frame, text="100%", width=6, command=lambda: self.set_zoom(1.0)).grid(row=0, column=1, padx=(4, 0))
        ttk.Button(zoom_frame, text="200%", width=6, command=lambda: self.set_zoom(2.0)).grid(row=0, column=2, padx=(4, 0))
        ttk.Button(zoom_frame, text="400%", width=6, command=lambda: self.set_zoom(4.0)).grid(row=0, column=3, padx=(4, 0))
        ttk.Button(zoom_frame, text="800%", width=6, command=lambda: self.set_zoom(8.0)).grid(row=0, column=4, padx=(4, 0))
        ttk.Button(zoom_frame, text="−", width=3, command=self.zoom_out).grid(row=0, column=5, padx=(8, 0))
        ttk.Button(zoom_frame, text="+", width=3, command=self.zoom_in).grid(row=0, column=6)

    def _bind_keys(self) -> None:
        self.bind("<Left>", lambda e: self.prev())
        self.bind("<Right>", lambda e: self.next())
        self.bind("<Escape>", lambda e: self.destroy())
        # Zoom presets
        self.bind("<Key-0>", lambda e: self.fit())
        self.bind("<Key-1>", lambda e: self.set_zoom(1.0))
        self.bind("<Key-2>", lambda e: self.set_zoom(2.0))
        self.bind("<Key-4>", lambda e: self.set_zoom(4.0))
        self.bind("<Key-8>", lambda e: self.set_zoom(8.0))
        # Incremental zoom (both +/= since shift can be annoying)
        self.bind("<Key-equal>", lambda e: self.zoom_in())
        self.bind("<Key-plus>", lambda e: self.zoom_in())
        self.bind("<Key-minus>", lambda e: self.zoom_out())
        self.bind("<Key-underscore>", lambda e: self.zoom_out())

    def _bind_mouse(self) -> None:
        self.canvas.bind("<ButtonPress-1>", self._on_press)
        self.canvas.bind("<B1-Motion>", self._on_drag)
        self.canvas.bind("<ButtonRelease-1>", self._on_release)
        # Cmd+scroll on macOS = zoom; plain scroll = pan vertically when zoomed
        if sys.platform == "darwin":
            self.canvas.bind("<Command-MouseWheel>",
                             lambda e: self._wheel_zoom(e, e.delta))
        else:
            self.canvas.bind("<Control-MouseWheel>",
                             lambda e: self._wheel_zoom(e, e.delta))
        self.canvas.bind("<MouseWheel>", self._on_wheel_pan)

    # ---- slide navigation -------------------------------------------------

    def prev(self) -> None:
        self.idx = (self.idx - 1) % len(self.slides)
        # Reset pan but keep zoom setting between slides — operator wants to
        # inspect the same feature across all films.
        self.pan_x = self.pan_y = 0.0
        self._show()

    def next(self) -> None:
        self.idx = (self.idx + 1) % len(self.slides)
        self.pan_x = self.pan_y = 0.0
        self._show()

    # ---- zoom -------------------------------------------------------------

    def fit(self) -> None:
        self.fit_mode = True
        self.pan_x = self.pan_y = 0.0
        self._show()

    def set_zoom(self, factor: float) -> None:
        self.fit_mode = False
        self.zoom = float(factor)
        self._show()

    def zoom_in(self) -> None:
        current = self._current_zoom_factor()
        for step in ZOOM_STEPS:
            if step > current + 1e-3:
                self.set_zoom(step)
                return

    def zoom_out(self) -> None:
        current = self._current_zoom_factor()
        for step in reversed(ZOOM_STEPS):
            if step < current - 1e-3:
                if step <= self._fit_scale():
                    self.fit()
                else:
                    self.set_zoom(step)
                return
        self.fit()

    def _current_zoom_factor(self) -> float:
        if self.fit_mode:
            return self._fit_scale()
        return self.zoom

    def _fit_scale(self) -> float:
        """Scale factor that fits the current image into the canvas."""
        img = self.slides[self.idx]["image"]
        iw, ih = img.size
        cw = max(1, self.canvas.winfo_width() - 16)
        ch = max(1, self.canvas.winfo_height() - 16)
        return min(cw / iw, ch / ih)

    def _wheel_zoom(self, event, delta: int) -> None:
        """Cmd+scroll — zoom toward the cursor position."""
        if delta > 0:
            self.zoom_in()
        elif delta < 0:
            self.zoom_out()

    # ---- pan --------------------------------------------------------------

    def _on_press(self, event) -> None:
        self._drag_anchor = (event.x, event.y, self.pan_x, self.pan_y)

    def _on_drag(self, event) -> None:
        if self._drag_anchor is None or self.fit_mode:
            return
        x0, y0, px0, py0 = self._drag_anchor
        dx = (x0 - event.x) / self.zoom
        dy = (y0 - event.y) / self.zoom
        self.pan_x = px0 + dx
        self.pan_y = py0 + dy
        self._show()

    def _on_release(self, _event) -> None:
        self._drag_anchor = None

    def _on_wheel_pan(self, event) -> None:
        """Two-finger scroll pans vertically (or horizontally w/ shift)."""
        if self.fit_mode:
            return
        # macOS delta is already in pixels (approximate)
        dy = -event.delta / self.zoom
        if getattr(event, "state", 0) & 0x0001:  # Shift → horizontal
            self.pan_x += dy
        else:
            self.pan_y += dy
        self._show()

    # ---- render -----------------------------------------------------------

    def _show(self) -> None:
        slide = self.slides[self.idx]
        self.title_var.set(slide["title"])
        self.sub_var.set(slide["subtitle"])
        self.counter_var.set(f"{self.idx + 1} / {len(self.slides)}")

        self.update_idletasks()
        cw = max(400, self.canvas.winfo_width())
        ch = max(300, self.canvas.winfo_height())

        img: Image.Image = slide["image"]
        iw, ih = img.size

        if self.fit_mode:
            scale = min((cw - 16) / iw, (ch - 16) / ih)
            self.zoom_var.set(f"Fit · {scale * 100:.0f}%")
            new_w = max(1, int(iw * scale))
            new_h = max(1, int(ih * scale))
            resized = img.resize((new_w, new_h), Image.LANCZOS)
            if resized.mode != "RGB":
                resized = resized.convert("RGB")
            self._imgtk = ImageTk.PhotoImage(resized)
            self.canvas.delete("all")
            self.canvas.create_image(cw // 2, ch // 2,
                                     image=self._imgtk, anchor="center")
            return

        # Zoomed mode: crop viewport from source, upsample to canvas size.
        # Viewport size in source-image coords:
        vp_w = cw / self.zoom
        vp_h = ch / self.zoom

        # Clamp pan so we don't scroll past the image
        max_px = max(0.0, iw - vp_w)
        max_py = max(0.0, ih - vp_h)
        self.pan_x = max(0.0, min(self.pan_x, max_px))
        self.pan_y = max(0.0, min(self.pan_y, max_py))

        # Handle zoom that makes the image smaller than the viewport
        # (happens when zoom is between fit and 100% on very large films).
        if vp_w >= iw and vp_h >= ih:
            # Image fits entirely inside viewport → center it
            resized = img.resize(
                (int(iw * self.zoom), int(ih * self.zoom)),
                Image.NEAREST if self.zoom >= 1 else Image.LANCZOS,
            )
            if resized.mode != "RGB":
                resized = resized.convert("RGB")
            self._imgtk = ImageTk.PhotoImage(resized)
            self.canvas.delete("all")
            self.canvas.create_image(cw // 2, ch // 2,
                                     image=self._imgtk, anchor="center")
        else:
            x0 = int(self.pan_x)
            y0 = int(self.pan_y)
            x1 = min(iw, int(self.pan_x + vp_w + 1))
            y1 = min(ih, int(self.pan_y + vp_h + 1))
            crop = img.crop((x0, y0, x1, y1))
            # Resize the crop up to fit the canvas
            target_w = int((x1 - x0) * self.zoom)
            target_h = int((y1 - y0) * self.zoom)
            # NEAREST at zoom >= 1 keeps halftone dots crisp — no interpolation
            # blur. LANCZOS only when we're actually downscaling.
            filt = Image.NEAREST if self.zoom >= 1 else Image.LANCZOS
            resized = crop.resize((max(1, target_w), max(1, target_h)), filt)
            if resized.mode != "RGB":
                resized = resized.convert("RGB")
            self._imgtk = ImageTk.PhotoImage(resized)
            self.canvas.delete("all")
            # Top-left placement so pan is 1:1 intuitive
            cx = (cw - target_w) // 2 if target_w < cw else 0
            cy = (ch - target_h) // 2 if target_h < ch else 0
            self.canvas.create_image(cx, cy, image=self._imgtk, anchor="nw")

        # Zoom indicator
        self.zoom_var.set(f"{self.zoom * 100:.0f}%")
