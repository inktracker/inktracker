"""Quick art editor — crop, rotate/flip, and color-select/replace/remove.

Runs before the separation pipeline so operators can clean up or tweak
an input without bouncing out to Affinity/Photoshop for a 10-second edit.

Scope:
  - Crop: click-drag rectangle, then Apply Crop
  - Color picker: click a pixel → get RGB + tolerance-sized selection
    preview → Remove / Replace with colorchooser RGB / Cancel
  - Rotate: 90° CW, 90° CCW, 180°, Flip H, Flip V
  - Undo (single-step stack), Reset (back to original), Cancel, Apply

Out of scope for v1 (defer to v2 if the shop actually wants it):
  - Brightness / contrast / saturation sliders
  - Levels / curves
  - Paintbrush / clone / eraser
  - Multi-step undo history (we keep a reasonable stack but UI is single)
"""
from __future__ import annotations

import logging
import tkinter as tk
from tkinter import colorchooser, messagebox, ttk
from typing import Callable

import numpy as np
from PIL import Image, ImageTk


log = logging.getLogger("filmseps.editor")


TOOL_CROP = "crop"
TOOL_PICKER = "picker"


class ArtEditor(tk.Toplevel):
    """Modal-ish editor window. Takes a source PIL image, fires `on_apply`
    with the edited image when the operator commits.
    """

    def __init__(
        self,
        parent: tk.Misc,
        source_image: Image.Image,
        on_apply: Callable[[Image.Image], None],
    ) -> None:
        super().__init__(parent)
        self.title("Film Seps — Edit Art")
        self.geometry("1100x820")
        self.minsize(800, 600)

        self.on_apply = on_apply
        self.original: Image.Image = source_image.convert("RGB")
        self.current: Image.Image = self.original.copy()
        self.history: list[Image.Image] = [self.original.copy()]

        self.tool: str = TOOL_CROP
        self.picked_rgb: tuple[int, int, int] | None = None
        self.color_tolerance: int = 40

        # Canvas display state — we keep the image fit-to-canvas and track
        # scale so click events map back to source pixels.
        self._imgtk: ImageTk.PhotoImage | None = None
        self._canvas_image_id: int | None = None
        self._scale: float = 1.0
        self._offset_x: int = 0
        self._offset_y: int = 0
        self._drag_start: tuple[int, int] | None = None
        self._preview_overlay_id: int | None = None

        self._build_ui()
        self._bind_mouse()
        self.bind("<Escape>", lambda e: self._cancel())
        self.after(50, self._refresh_display)

    # --- UI layout ---------------------------------------------------------

    def _build_ui(self) -> None:
        self.columnconfigure(0, weight=1)
        self.rowconfigure(1, weight=1)

        # Top: tool selector + transform buttons
        top = ttk.Frame(self, padding=(14, 10))
        top.grid(row=0, column=0, sticky="ew")
        top.columnconfigure(2, weight=1)

        ttk.Label(top, text="Tool:", font=("Helvetica", 12, "bold")).grid(
            row=0, column=0, padx=(0, 8))
        self.tool_var = tk.StringVar(value=TOOL_CROP)
        crop_rb = ttk.Radiobutton(top, text="Crop", value=TOOL_CROP,
                                   variable=self.tool_var, command=self._on_tool_change)
        crop_rb.grid(row=0, column=1, padx=(0, 8))
        picker_rb = ttk.Radiobutton(top, text="Color Picker",
                                     value=TOOL_PICKER, variable=self.tool_var,
                                     command=self._on_tool_change)
        picker_rb.grid(row=0, column=2, padx=(0, 16), sticky="w")

        # Transform buttons (always available regardless of tool)
        transforms = ttk.Frame(top)
        transforms.grid(row=0, column=3, sticky="e")
        ttk.Label(transforms, text="Transform:", foreground="#666").grid(
            row=0, column=0, padx=(0, 6))
        ttk.Button(transforms, text="↺ 90°", width=6,
                   command=lambda: self._rotate(-90)).grid(row=0, column=1, padx=1)
        ttk.Button(transforms, text="↻ 90°", width=6,
                   command=lambda: self._rotate(90)).grid(row=0, column=2, padx=1)
        ttk.Button(transforms, text="180°", width=6,
                   command=lambda: self._rotate(180)).grid(row=0, column=3, padx=1)
        ttk.Button(transforms, text="Flip H", width=7,
                   command=lambda: self._flip("h")).grid(row=0, column=4, padx=(6, 1))
        ttk.Button(transforms, text="Flip V", width=7,
                   command=lambda: self._flip("v")).grid(row=0, column=5, padx=1)

        # Middle: canvas
        self.canvas = tk.Canvas(self, background="#2a2a2a",
                                 highlightthickness=0, cursor="tcross")
        self.canvas.grid(row=1, column=0, sticky="nsew", padx=14, pady=(4, 6))

        # Tool-specific controls
        self.tool_frame = ttk.Frame(self, padding=(14, 4))
        self.tool_frame.grid(row=2, column=0, sticky="ew")
        self._build_tool_controls()

        # Bottom: Undo / Reset / Cancel / Apply
        bot = ttk.Frame(self, padding=(14, 10))
        bot.grid(row=3, column=0, sticky="ew")
        bot.columnconfigure(1, weight=1)

        left = ttk.Frame(bot)
        left.grid(row=0, column=0, sticky="w")
        ttk.Button(left, text="Undo", command=self._undo).grid(row=0, column=0, padx=(0, 6))
        ttk.Button(left, text="Reset", command=self._reset).grid(row=0, column=1)

        self.status_var = tk.StringVar(value="")
        ttk.Label(bot, textvariable=self.status_var,
                  foreground="#666").grid(row=0, column=1, sticky="w", padx=12)

        right = ttk.Frame(bot)
        right.grid(row=0, column=2, sticky="e")
        ttk.Button(right, text="Cancel", command=self._cancel).grid(row=0, column=0, padx=(0, 6))
        self.apply_btn = ttk.Button(right, text="Apply", command=self._apply)
        self.apply_btn.grid(row=0, column=1)

        self._update_status()

    def _build_tool_controls(self) -> None:
        for w in self.tool_frame.winfo_children():
            w.destroy()

        if self.tool == TOOL_CROP:
            ttk.Label(self.tool_frame,
                      text="Click and drag on the image to draw a crop "
                           "rectangle, then click Apply Crop.",
                      foreground="#555").grid(row=0, column=0, sticky="w")
            self.apply_crop_btn = ttk.Button(
                self.tool_frame, text="Apply Crop",
                command=self._commit_crop, state="disabled",
            )
            self.apply_crop_btn.grid(row=0, column=1, padx=(16, 0), sticky="e")
            self.tool_frame.columnconfigure(0, weight=1)
        elif self.tool == TOOL_PICKER:
            row1 = ttk.Frame(self.tool_frame)
            row1.grid(row=0, column=0, sticky="ew")
            ttk.Label(row1, text="Click a color in the image.",
                      foreground="#555").grid(row=0, column=0, padx=(0, 10))

            self.swatch = tk.Canvas(row1, width=32, height=24, bg="#ccc",
                                     highlightthickness=1,
                                     highlightbackground="#999")
            self.swatch.grid(row=0, column=1, padx=6)
            self.rgb_var = tk.StringVar(value="(none)")
            ttk.Label(row1, textvariable=self.rgb_var,
                      font=("Menlo", 11)).grid(row=0, column=2, padx=6)

            ttk.Label(row1, text="Tolerance:").grid(row=0, column=3, padx=(16, 4))
            self.tol_var = tk.IntVar(value=self.color_tolerance)
            tol_scale = ttk.Scale(
                row1, from_=5, to=120, orient="horizontal",
                variable=self.tol_var,
                command=lambda v: self._on_tolerance_change(),
                length=140,
            )
            tol_scale.grid(row=0, column=4)
            self.tol_label = ttk.Label(row1, text=str(self.color_tolerance), width=4)
            self.tol_label.grid(row=0, column=5, padx=(4, 0))

            row2 = ttk.Frame(self.tool_frame)
            row2.grid(row=1, column=0, sticky="w", pady=(6, 0))
            self.remove_btn = ttk.Button(
                row2, text="Remove color", command=self._remove_color,
                state="disabled",
            )
            self.remove_btn.grid(row=0, column=0, padx=(0, 6))
            self.replace_btn = ttk.Button(
                row2, text="Replace with…", command=self._replace_color,
                state="disabled",
            )
            self.replace_btn.grid(row=0, column=1)

    # --- Mouse events ------------------------------------------------------

    def _bind_mouse(self) -> None:
        self.canvas.bind("<ButtonPress-1>", self._on_press)
        self.canvas.bind("<B1-Motion>", self._on_drag)
        self.canvas.bind("<ButtonRelease-1>", self._on_release)
        self.canvas.bind("<Configure>", lambda e: self._refresh_display())

    def _on_press(self, event) -> None:
        if self.tool == TOOL_CROP:
            self._drag_start = (event.x, event.y)
            if self._preview_overlay_id:
                self.canvas.delete(self._preview_overlay_id)
                self._preview_overlay_id = None
        elif self.tool == TOOL_PICKER:
            self._pick_color_at(event.x, event.y)

    def _on_drag(self, event) -> None:
        if self.tool != TOOL_CROP or self._drag_start is None:
            return
        x0, y0 = self._drag_start
        x1, y1 = event.x, event.y
        if self._preview_overlay_id:
            self.canvas.delete(self._preview_overlay_id)
        self._preview_overlay_id = self.canvas.create_rectangle(
            x0, y0, x1, y1, outline="#ea8020", width=2, dash=(4, 3),
        )

    def _on_release(self, event) -> None:
        if self.tool != TOOL_CROP or self._drag_start is None:
            return
        x0, y0 = self._drag_start
        x1, y1 = event.x, event.y
        self._drag_start = None
        if abs(x1 - x0) < 6 or abs(y1 - y0) < 6:
            # Too small — treat as cancel
            if self._preview_overlay_id:
                self.canvas.delete(self._preview_overlay_id)
                self._preview_overlay_id = None
            self.apply_crop_btn.state(["disabled"])
            return
        # Keep the overlay visible + enable the Apply Crop button
        self.apply_crop_btn.state(["!disabled"])
        # Store canvas-space crop rect for commit
        self._pending_crop_canvas = (
            min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1),
        )

    # --- Picker ------------------------------------------------------------

    def _pick_color_at(self, cx: int, cy: int) -> None:
        ix, iy = self._canvas_to_image(cx, cy)
        if ix is None:
            return
        try:
            rgb = self.current.getpixel((ix, iy))
            if isinstance(rgb, int):
                rgb = (rgb, rgb, rgb)
            self.picked_rgb = tuple(int(v) for v in rgb[:3])
        except Exception:
            log.exception("getpixel failed")
            return
        # Update swatch + RGB label
        hex_color = f"#{self.picked_rgb[0]:02x}{self.picked_rgb[1]:02x}{self.picked_rgb[2]:02x}"
        self.swatch.configure(bg=hex_color)
        self.rgb_var.set(f"RGB {self.picked_rgb}")
        self.remove_btn.state(["!disabled"])
        self.replace_btn.state(["!disabled"])
        self._show_selection_preview()

    def _on_tolerance_change(self) -> None:
        self.color_tolerance = int(self.tol_var.get())
        self.tol_label.configure(text=str(self.color_tolerance))
        self._show_selection_preview()

    def _show_selection_preview(self) -> None:
        """Overlay a dashed outline around pixels that would be affected."""
        if self.picked_rgb is None:
            return
        # Build a mask at display resolution (cheap); find bounding box-ish
        # outline via edge detection on the mask.
        arr = np.array(self.current, dtype=np.int16)
        target = np.array(self.picked_rgb, dtype=np.int16)
        diff = np.abs(arr - target).sum(axis=2)
        mask = diff < self.color_tolerance * 3
        selected = int(mask.sum())
        total = mask.size
        self.status_var.set(
            f"selection: {selected:,} pixels ({100*selected/total:.1f}%)"
        )

    def _remove_color(self) -> None:
        if self.picked_rgb is None:
            return
        self._push_history()
        arr = np.array(self.current, dtype=np.int16)
        target = np.array(self.picked_rgb, dtype=np.int16)
        diff = np.abs(arr - target).sum(axis=2)
        mask = diff < self.color_tolerance * 3
        # Replace with white (canvas). Bg exclusion in the render pipeline
        # will handle this the right way based on garment color.
        arr_u8 = np.array(self.current, dtype=np.uint8)
        arr_u8[mask] = (255, 255, 255)
        self.current = Image.fromarray(arr_u8, "RGB")
        log.info("removed color %s ±%d — %d pixels",
                 self.picked_rgb, self.color_tolerance, int(mask.sum()))
        self._refresh_display()
        self._update_status()

    def _replace_color(self) -> None:
        if self.picked_rgb is None:
            return
        chosen = colorchooser.askcolor(
            title="Replace with…",
            initialcolor=self.picked_rgb,
        )
        if not chosen or not chosen[0]:
            return
        new_rgb = tuple(int(v) for v in chosen[0])
        self._push_history()
        arr = np.array(self.current, dtype=np.int16)
        target = np.array(self.picked_rgb, dtype=np.int16)
        diff = np.abs(arr - target).sum(axis=2)
        mask = diff < self.color_tolerance * 3
        arr_u8 = np.array(self.current, dtype=np.uint8)
        arr_u8[mask] = new_rgb
        self.current = Image.fromarray(arr_u8, "RGB")
        log.info("replaced color %s → %s — %d pixels",
                 self.picked_rgb, new_rgb, int(mask.sum()))
        self.picked_rgb = new_rgb
        hex_color = f"#{new_rgb[0]:02x}{new_rgb[1]:02x}{new_rgb[2]:02x}"
        self.swatch.configure(bg=hex_color)
        self.rgb_var.set(f"RGB {new_rgb}")
        self._refresh_display()
        self._update_status()

    # --- Transforms --------------------------------------------------------

    def _rotate(self, degrees: int) -> None:
        self._push_history()
        # PIL rotate with expand=True for 90/270
        self.current = self.current.rotate(-degrees, expand=True, resample=Image.BICUBIC)
        self._refresh_display()
        self._update_status()

    def _flip(self, direction: str) -> None:
        self._push_history()
        method = Image.FLIP_LEFT_RIGHT if direction == "h" else Image.FLIP_TOP_BOTTOM
        self.current = self.current.transpose(method)
        self._refresh_display()
        self._update_status()

    def _commit_crop(self) -> None:
        if not hasattr(self, "_pending_crop_canvas"):
            return
        x0, y0, x1, y1 = self._pending_crop_canvas
        # Map canvas coords → image coords
        ix0, iy0 = self._canvas_to_image(x0, y0)
        ix1, iy1 = self._canvas_to_image(x1, y1)
        if None in (ix0, iy0, ix1, iy1):
            return
        box = (min(ix0, ix1), min(iy0, iy1), max(ix0, ix1), max(iy0, iy1))
        # Clamp to image bounds
        w, h = self.current.size
        box = (max(0, box[0]), max(0, box[1]),
               min(w, box[2]), min(h, box[3]))
        if box[2] - box[0] < 4 or box[3] - box[1] < 4:
            return
        self._push_history()
        self.current = self.current.crop(box)
        log.info("cropped to %s — new size %s", box, self.current.size)
        if self._preview_overlay_id:
            self.canvas.delete(self._preview_overlay_id)
            self._preview_overlay_id = None
        self.apply_crop_btn.state(["disabled"])
        self._refresh_display()
        self._update_status()

    # --- History -----------------------------------------------------------

    def _push_history(self) -> None:
        # Cap the stack so a pathological session doesn't eat memory
        if len(self.history) >= 20:
            self.history.pop(0)
        self.history.append(self.current.copy())

    def _undo(self) -> None:
        if len(self.history) < 2:
            # Only the original is on the stack
            return
        self.history.pop()          # drop the latest snapshot
        self.current = self.history[-1].copy()
        self._refresh_display()
        self._update_status()

    def _reset(self) -> None:
        if not messagebox.askyesno(
            "Reset edits",
            "Discard all edits and go back to the original?",
            parent=self,
        ):
            return
        self.current = self.original.copy()
        self.history = [self.original.copy()]
        self._refresh_display()
        self._update_status()

    # --- Apply / Cancel ----------------------------------------------------

    def _apply(self) -> None:
        try:
            self.on_apply(self.current.copy())
        except Exception:
            log.exception("on_apply callback failed")
            messagebox.showerror("Edit failed",
                                  "Could not apply the edits. "
                                  "See ~/Library/Logs/FilmSeps.log for details.",
                                  parent=self)
            return
        self.destroy()

    def _cancel(self) -> None:
        if len(self.history) > 1:
            if not messagebox.askyesno(
                "Discard edits",
                "Close without applying your edits?",
                parent=self,
            ):
                return
        self.destroy()

    # --- Display -----------------------------------------------------------

    def _on_tool_change(self) -> None:
        self.tool = self.tool_var.get()
        if self._preview_overlay_id:
            self.canvas.delete(self._preview_overlay_id)
            self._preview_overlay_id = None
        self._build_tool_controls()

    def _refresh_display(self) -> None:
        self.update_idletasks()
        cw = max(200, self.canvas.winfo_width())
        ch = max(200, self.canvas.winfo_height())
        iw, ih = self.current.size
        self._scale = min((cw - 16) / iw, (ch - 16) / ih, 1.0)
        disp_w = max(1, int(iw * self._scale))
        disp_h = max(1, int(ih * self._scale))
        self._offset_x = (cw - disp_w) // 2
        self._offset_y = (ch - disp_h) // 2

        thumb = self.current.resize((disp_w, disp_h),
                                     Image.LANCZOS if self._scale < 1 else Image.NEAREST)
        self._imgtk = ImageTk.PhotoImage(thumb)
        self.canvas.delete("all")
        self._canvas_image_id = self.canvas.create_image(
            self._offset_x + disp_w // 2,
            self._offset_y + disp_h // 2,
            image=self._imgtk, anchor="center",
        )

    def _canvas_to_image(self, cx: int, cy: int) -> tuple[int | None, int | None]:
        """Map canvas-space coords back to current image coords."""
        if self._scale <= 0:
            return None, None
        ix = int((cx - self._offset_x) / self._scale)
        iy = int((cy - self._offset_y) / self._scale)
        w, h = self.current.size
        if ix < 0 or iy < 0 or ix >= w or iy >= h:
            return None, None
        return ix, iy

    def _update_status(self) -> None:
        w, h = self.current.size
        edits = len(self.history) - 1
        self.status_var.set(
            f"{w}×{h} px  ·  {edits} edit{'s' if edits != 1 else ''}"
        )
