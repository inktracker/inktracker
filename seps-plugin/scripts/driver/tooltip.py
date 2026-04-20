"""Tiny Tkinter tooltip helper.

Binds <Enter>/<Leave> to any widget and pops a borderless yellow window
with explanatory text on hover. Tkinter has no built-in tooltip, so we
roll our own.
"""

from __future__ import annotations

import tkinter as tk


class Tooltip:
    def __init__(self, widget: tk.Widget, text: str, delay_ms: int = 350, wrap: int = 420):
        self.widget = widget
        self.text = text
        self.delay = delay_ms
        self.wrap = wrap
        self._tip: tk.Toplevel | None = None
        self._after_id: str | None = None

        widget.bind("<Enter>", self._schedule)
        widget.bind("<Leave>", self._hide)
        widget.bind("<ButtonPress>", self._hide)

    def _schedule(self, _evt=None) -> None:
        self._cancel()
        self._after_id = self.widget.after(self.delay, self._show)

    def _cancel(self) -> None:
        if self._after_id:
            try:
                self.widget.after_cancel(self._after_id)
            except Exception:
                pass
            self._after_id = None

    def _show(self) -> None:
        if self._tip is not None:
            return
        try:
            x, y, _w, h = self.widget.bbox("insert")
        except Exception:
            x = y = h = 0
        x = self.widget.winfo_rootx() + 24
        y = self.widget.winfo_rooty() + self.widget.winfo_height() + 4

        self._tip = tip = tk.Toplevel(self.widget)
        tip.wm_overrideredirect(True)   # no title bar
        tip.wm_geometry(f"+{x}+{y}")
        try:
            tip.attributes("-topmost", True)
        except Exception:
            pass

        lbl = tk.Label(
            tip, text=self.text, justify="left",
            background="#fffbcc", foreground="#222",
            relief="solid", borderwidth=1,
            wraplength=self.wrap,
            font=("Helvetica", 11),
            padx=8, pady=6,
        )
        lbl.pack()

    def _hide(self, _evt=None) -> None:
        self._cancel()
        if self._tip is not None:
            try:
                self._tip.destroy()
            except Exception:
                pass
            self._tip = None


def attach(widget: tk.Widget, text: str) -> Tooltip:
    """Convenience: `attach(my_label, "explain this field")` returns a Tooltip."""
    return Tooltip(widget, text)
