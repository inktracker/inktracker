-- Film Seps droplet
--
-- Drag any art file (JPG / PNG / PSD / PDF / TIF) onto this app icon and
-- it hands the file to the process-art.sh worker, which shows the
-- width/garment/ink dialogs, renders films, pops a preview, and submits
-- to the Epson.
--
-- Compiled to `Film Seps.app` by install.sh. The install dir is resolved
-- at runtime from ~/.config/biota-film-driver/env.sh so the app bundle
-- can live anywhere (Applications, Dock, Desktop).

on open theFiles
	repeat with aFile in theFiles
		set filePath to POSIX path of aFile
		set fileName to name of (info for aFile)
		my processOne(filePath, fileName)
	end repeat
end open

on run
	-- Launching the app without dropping anything — pick a file instead.
	set chosen to choose file with prompt "Pick an art file to separate and print" without invisibles
	set filePath to POSIX path of chosen
	set fileName to name of (info for chosen)
	my processOne(filePath, fileName)
end run

on processOne(filePath, fileName)
	set envFile to (POSIX path of (path to home folder)) & ".config/biota-film-driver/env.sh"
	set installDir to "" -- resolved from env file
	try
		set installDir to do shell script ("source " & quoted form of envFile & " && printf '%s' \"$INSTALL_DIR\"")
	end try
	if installDir is "" then
		set installDir to (POSIX path of (path to home folder)) & "Downloads/inktracker/seps-plugin/installable/print-driver"
	end if
	set worker to installDir & "/process-art.sh"

	try
		-- Run synchronously. The worker shows its own osascript dialogs for
		-- width/garment/ink/print-confirm, so blocking here is correct —
		-- dropping several files queues them up, one dialog flow at a time.
		do shell script quoted form of worker & " " & quoted form of filePath & " " & quoted form of fileName
	on error errMsg number errNum
		if errNum is -128 then
			-- user cancelled a dialog; not an error
			return
		end if
		display alert "Film Seps" message ("Couldn't finish processing " & fileName & "." & return & return & errMsg) as critical
	end try
end processOne
