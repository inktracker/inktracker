# Film Seps — macOS Print Dialog Hook

Adds a **"Film Seps"** entry to the PDF dropdown in macOS Print dialogs.
From Photoshop/Illustrator/Affinity/anything: `File → Print → PDF ▾ → Film Seps`
pops a small dialog for print width + garment, then emits press-ready
film TIFs via the [film driver](../../scripts/driver/).

## Install

```sh
./install.sh
```

That does three things:

1. Symlinks `Film Seps` into `~/Library/PDF Services/`
2. Writes an env file at `~/.config/biota-film-driver/env.sh` pointing at
   the driver directory
3. Checks that Python deps are installed

If deps are missing it prints the pip command — run it, then re-run `install.sh`.

## Use

1. Open any app with the artwork to print (Photoshop, Illustrator, Affinity
   Designer/Publisher, Preview, etc.)
2. `File → Print…`
3. In the Print dialog: click the **PDF ▾** dropdown at the bottom-left →
   **Film Seps**
4. Answer the three prompts:
   - Print width (Left chest / Full front / Custom...)
   - Garment color (black / white / navy / heather / ...)
   - Ink system (waterbase / discharge)
5. Wait for the notification. The films folder opens in Finder.

## Output

```
~/Downloads/film-seps/<YYMMDD-HHMMSS>-<document-title>/
  source.pdf          — the PDF macOS handed us (kept for traceability)
  film-driver.log     — driver stdout/stderr
  films/
    01_<ink>_<mesh>.tif
    02_...
    driver-output.json
```

## Debugging

- **Nothing happens when I pick "Film Seps"** — the symlink may be broken or
  the script isn't executable. Re-run `install.sh`.
- **"film_driver.py not found"** — edit `~/.config/biota-film-driver/env.sh`
  to point `DRIVER_DIR` at your driver folder.
- **Driver fails** — the log opens automatically. Check
  `film-driver.log` in the job folder for the full error.

## Uninstall

```sh
rm "$HOME/Library/PDF Services/Film Seps"
rm -rf "$HOME/.config/biota-film-driver"
```

## What's in the "Film Seps" script

It's a plain bash script that:
1. Picks the PDF argument out of the CUPS/macOS argv contract (which varies
   by macOS version)
2. Shows three native dialogs via `osascript`
3. Calls `python3 film_driver.py ...` with the user's choices
4. Opens the output folder / shows a notification

The menu text is exactly the filename (`Film Seps`) — rename the symlink if
you want a different label.
