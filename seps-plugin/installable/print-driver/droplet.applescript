-- Film Seps droplet
--
-- Double-click the icon or drop a file on it — either way, the GUI
-- (gui.py, Tkinter) opens. Dropped files get passed as argv[0] so the
-- GUI pre-loads them on launch.
--
-- Compiled to `Film Seps.app` by install.sh. Install dir is read at
-- runtime from ~/.config/biota-film-driver/env.sh so the app bundle
-- can live anywhere.

on run
	my launchGUI("")
end run

on open theFiles
	-- If several files are dropped, open one window per file.
	repeat with aFile in theFiles
		my launchGUI(POSIX path of aFile)
	end repeat
end open

on launchGUI(filePath)
	set envFile to (POSIX path of (path to home folder)) & ".config/biota-film-driver/env.sh"
	set driverDir to ""
	set pyBin to "/usr/bin/python3"
	try
		set driverDir to do shell script ("source " & quoted form of envFile & " && printf '%s' \"$DRIVER_DIR\"")
	end try
	try
		set pyVal to do shell script ("source " & quoted form of envFile & " && printf '%s' \"$PY\"")
		if pyVal is not "" then set pyBin to pyVal
	end try
	if driverDir is "" then
		set driverDir to (POSIX path of (path to home folder)) & "Downloads/inktracker/seps-plugin/scripts/driver"
	end if
	set guiScript to driverDir & "/gui.py"

	-- Build the shell command. When a file was dropped, pass it as the first arg.
	set shellCmd to quoted form of pyBin & " " & quoted form of guiScript
	if filePath is not "" then
		set shellCmd to shellCmd & " " & quoted form of filePath
	end if
	-- Detach from the .app launcher so Tk can own the event loop without
	-- blocking AppleScript / Finder.
	set shellCmd to shellCmd & " >/dev/null 2>&1 &"

	try
		do shell script shellCmd
	on error errMsg
		display alert "Film Seps" message ("Couldn't launch the GUI." & return & return & errMsg) as critical
	end try
end launchGUI
