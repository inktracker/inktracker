"""In-app sep preview viewer — flip through one film at a time.

Opens as a Toplevel window inside Film Seps. Position 0 is the source
artwork (so you can eyeball whether the separation captured it faithfully);
positions 1..N are the individual film TIFs.

Navigation: Prev / Next buttons, ← / → arrow keys, 1–9 keys for direct jump.
"""
from __future__ import annotations

import logging
import tkinter as tk
from pathlib import Path
from tkinter import ttk
from typing import Sequence

from PIL import Image, ImageTk


log = logging.getLogger("filmseps.sepviewer")


class SepViewer(tk.Toplevel):
    """Modal-ish window that shows the source art and each rendered film
    one at a time with Prev / Next navigation.
    """

    def __init__(
        self,
        parent: tk.Misc,
        source_image: Image.Image,
        films: Sequence[dict],
        header: str = "Film Seps Preview",
    ) -> None:
        super().__init__(parent)
        self.title(f"{header} — Sep Viewer")
        self.geometry("1100x820")
        self.minsize(720, 560)

        # Build the slides list: source first, then each film
        self.slides: list[dict] = [
            {"title": "SOURCE", "subtitle": f"{source_image.size[0]}×{source_image.size[1]} px",
             "image": source_image.convert("RGB"), "kind": "source"},
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

        self.idx = 0
        self._imgtk: ImageTk.PhotoImage | None = None
        self._build_ui()
        self.bind("<Left>", lambda e: self.prev())
        self.bind("<Right>", lambda e: self.next())
        self.bind("<Key-1>", lambda e: self.jump(0))
        self.bind("<Escape>", lambda e: self.destroy())
        for k in range(1, 10):
            self.bind(f"<Key-{k}>",
                      lambda e, idx=k - 1: self.jump(idx) if idx < len(self.slides) else None)

        self.focus_set()
        self._show()
        # Re-show on resize so the image rescales to fit
        self.canvas.bind("<Configure>", lambda e: self._show())

    # ---- layout -----------------------------------------------------------

    def _build_ui(self) -> None:
        self.columnconfigure(0, weight=1)
        self.rowconfigure(1, weight=1)

        # Top bar — title + counter
        top = ttk.Frame(self, padding=(14, 10))
        top.grid(row=0, column=0, sticky="ew")
        top.columnconfigure(0, weight=1)

        self.title_var = tk.StringVar()
        self.sub_var = tk.StringVar()
        ttk.Label(top, textvariable=self.title_var,
                  font=("Helvetica", 18, "bold")).grid(row=0, column=0, sticky="w")
        self.counter_var = tk.StringVar()
        ttk.Label(top, textvariable=self.counter_var,
                  foreground="#666").grid(row=0, column=1, sticky="e")
        ttk.Label(top, textvariable=self.sub_var,
                  foreground="#444").grid(row=1, column=0, columnspan=2, sticky="w")

        # Image area
        self.canvas = tk.Canvas(self, background="#2a2a2a",
                                highlightthickness=0)
        self.canvas.grid(row=1, column=0, sticky="nsew", padx=14, pady=(4, 8))

        # Bottom bar — nav buttons
        bot = ttk.Frame(self, padding=(14, 10))
        bot.grid(row=2, column=0, sticky="ew")
        bot.columnconfigure(1, weight=1)

        self.prev_btn = ttk.Button(bot, text="◀  Prev", command=self.prev)
        self.prev_btn.grid(row=0, column=0)
        self.next_btn = ttk.Button(bot, text="Next  ▶", command=self.next)
        self.next_btn.grid(row=0, column=2)
        ttk.Label(bot, text="←/→ arrow keys  ·  Esc to close",
                  foreground="#666").grid(row=0, column=1)

    # ---- state ------------------------------------------------------------

    def prev(self) -> None:
        self.idx = (self.idx - 1) % len(self.slides)
        self._show()

    def next(self) -> None:
        self.idx = (self.idx + 1) % len(self.slides)
        self._show()

    def jump(self, idx: int) -> None:
        if 0 <= idx < len(self.slides):
            self.idx = idx
            self._show()

    def _show(self) -> None:
        slide = self.slides[self.idx]
        self.title_var.set(slide["title"])
        self.sub_var.set(slide["subtitle"])
        self.counter_var.set(f"{self.idx + 1} / {len(self.slides)}")

        self.update_idletasks()
        cw = max(400, self.canvas.winfo_width())
        ch = max(300, self.canvas.winfo_height())

        img = slide["image"]
        thumb = img.copy()
        thumb.thumbnail((cw - 16, ch - 16), Image.LANCZOS)
        # Convert film TIFs (L mode) to RGB so they render crisply on a dark canvas
        if thumb.mode != "RGB":
            thumb = thumb.convert("RGB")
        self._imgtk = ImageTk.PhotoImage(thumb)
        self.canvas.delete("all")
        self.canvas.create_image(cw // 2, ch // 2,
                                 image=self._imgtk, anchor="center")

        # Nav buttons always enabled — wrap-around
        self.prev_btn.state(["!disabled"])
        self.next_btn.state(["!disabled"])
