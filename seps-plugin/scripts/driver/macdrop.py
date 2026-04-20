"""macOS drag-drop handler via pyobjc.

Injects `application:openFile:` / `application:openFiles:` methods into
Tk's existing NSApp delegate so macOS AppleEvents (dropped-on-Dock-icon,
'Open With...', double-click a registered doc type) are delivered to
our callback reliably — bypassing Tk 8.5's flaky `::tk::mac::OpenDocument`
bridge.

If pyobjc isn't installed, install() returns False and the caller is
expected to fall back to the Tk command handler.
"""

from __future__ import annotations

import logging
from typing import Callable


log = logging.getLogger("filmseps.macdrop")

# Module-level reference so the method closures see a stable callback
_CALLBACK: Callable[[str], None] | None = None


def install(callback: Callable[[str], None]) -> bool:
    """Install the openFile/openFiles methods on NSApp's current delegate.

    The callback receives one posix path string per file.
    """
    global _CALLBACK
    _CALLBACK = callback

    try:
        import objc
        from AppKit import NSApplication
    except ImportError as e:
        log.warning("pyobjc not available — macdrop handler skipped: %s", e)
        return False

    try:
        nsapp = NSApplication.sharedApplication()
        delegate = nsapp.delegate()
        if delegate is None:
            log.warning("no NSApp delegate yet — macdrop handler skipped")
            return False

        cls = type(delegate)

        # Only install once per class — idempotent across hot reloads
        if getattr(cls, "_filmseps_macdrop_installed", False):
            log.info("macdrop handlers already installed")
            return True

        # application:openFile: — BOOL (id, SEL, NSApplication*, NSString*)
        def openFile(self, sender, filename):
            try:
                if _CALLBACK:
                    _CALLBACK(str(filename))
                    log.info("openFile: %s", filename)
            except Exception:
                log.exception("openFile callback raised")
            return True

        open_file_imp = objc.selector(
            openFile,
            selector=b"application:openFile:",
            signature=b"c@:@@",  # BOOL self SEL NSApp* NSString*
        )

        # application:openFiles: — void (id, SEL, NSApplication*, NSArray*)
        def openFiles(self, sender, filenames):
            try:
                # Load the first; the GUI only has one window per instance
                for fn in filenames:
                    if _CALLBACK:
                        _CALLBACK(str(fn))
                        log.info("openFiles: %s (of %d)", fn, len(filenames))
                    break
            except Exception:
                log.exception("openFiles callback raised")

        open_files_imp = objc.selector(
            openFiles,
            selector=b"application:openFiles:",
            signature=b"v@:@@",
        )

        # Attach to the existing Tk delegate class
        setattr(cls, "application_openFile_", open_file_imp)
        setattr(cls, "application_openFiles_", open_files_imp)
        setattr(cls, "_filmseps_macdrop_installed", True)

        log.info("macdrop handlers installed on %s", cls.__name__)
        return True

    except Exception:
        log.exception("failed to install macdrop handlers")
        return False
