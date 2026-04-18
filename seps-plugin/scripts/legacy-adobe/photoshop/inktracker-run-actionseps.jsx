/*
 * inktracker-run-actionseps.jsx
 *
 * Runs the ActionSeps simulated-process separation on a source file
 * and exports each channel as a film-ready TIF.
 *
 * Input: JSON file path passed as first argument. The JSON describes
 * the job, source file, output directory, color count, mesh counts, etc.
 *
 * Output: Writes a sim-process-output.json back next to the input,
 * containing the list of exported films and any warnings.
 *
 * Invoked by the /prep-sim-process Cowork skill via AppleScript.
 */

#target photoshop

function main(inputJsonPath) {
  var input = readJSON(inputJsonPath);
  if (!input) {
    writeOutput(inputJsonPath, { success: false, error: "Could not read input JSON" });
    return;
  }

  var startTime = new Date().getTime();
  var warnings = [];

  // Open source file
  var sourceFile = new File(input.sourceFile);
  if (!sourceFile.exists) {
    writeOutput(inputJsonPath, { success: false, error: "Source file not found: " + input.sourceFile });
    return;
  }

  app.open(sourceFile);
  var doc = app.activeDocument;

  // Ensure RGB mode for ActionSeps
  if (doc.mode !== DocumentMode.RGB) {
    doc.changeMode(ChangeMode.RGB);
    warnings.push("Converted document from " + doc.mode + " to RGB for ActionSeps");
  }

  // Resize to print size if needed (assume document DPI is correct)
  if (doc.resolution < input.filmDpi) {
    warnings.push("Source DPI is " + doc.resolution + " — below target " + input.filmDpi + ". Consider starting with higher-resolution art.");
  }

  // Run the ActionSeps simulated process action
  // Action set and name may vary — this assumes standard ActionSeps v3 naming.
  try {
    app.doAction("Simulated Process", "ActionSeps v3");
  } catch (e) {
    try {
      app.doAction("Simulated Process", "ActionSeps");
    } catch (e2) {
      writeOutput(inputJsonPath, {
        success: false,
        error: "ActionSeps 'Simulated Process' action not found. Ensure ActionSeps is loaded in the Actions panel."
      });
      app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);
      return;
    }
  }

  // After action runs, the document should have named channels for each sep.
  // Export each non-alpha channel as a TIF.
  var outputDir = new Folder(input.outputDir);
  if (!outputDir.exists) outputDir.create();

  var films = [];
  var channels = doc.channels;
  var filmIndex = 1;

  for (var i = 0; i < channels.length; i++) {
    var ch = channels[i];
    // Skip composite channels (RGB / CMYK)
    if (ch.kind == ChannelType.COMPONENT) continue;

    var meshCount = guessMesh(ch.name, input);
    var filmName = padNum(filmIndex) + "_" + safeName(ch.name) + "_" + meshCount;
    var filmPath = input.outputDir + "/" + filmName + ".tif";

    exportChannelAsFilm(doc, ch, filmPath, input.filmDpi, input.registrationMarks);

    films.push({
      index: filmIndex,
      name: filmName,
      path: filmPath,
      meshCount: meshCount,
      ink: inferInk(ch.name),
      purpose: inferPurpose(ch.name)
    });

    filmIndex++;
  }

  // Save the working PSD in seps/
  var sepsDir = new Folder(input.sourceFile).parent.parent + "/seps";
  var sepsFolder = new Folder(sepsDir);
  if (!sepsFolder.exists) sepsFolder.create();

  var saveOptions = new PhotoshopSaveOptions();
  saveOptions.embedColorProfile = true;
  doc.saveAs(new File(sepsDir + "/" + input.jobCode + "-sim-process.psd"), saveOptions, true);

  doc.close(SaveOptions.DONOTSAVECHANGES);

  var elapsed = Math.round((new Date().getTime() - startTime) / 1000);

  writeOutput(inputJsonPath, {
    success: true,
    films: films,
    elapsedSeconds: elapsed,
    warnings: warnings
  });
}

function exportChannelAsFilm(doc, channel, filmPath, dpi, addRegMarks) {
  // Duplicate the document, isolate the channel, flatten to grayscale, export as TIF.
  var dup = doc.duplicate(doc.name + "_sep_" + channel.name, false);

  // Select only this channel
  var targetName = channel.name;
  for (var i = dup.channels.length - 1; i >= 0; i--) {
    if (dup.channels[i].kind == ChannelType.COMPONENT) continue;
    if (dup.channels[i].name !== targetName) {
      dup.channels[i].remove();
    }
  }

  dup.changeMode(ChangeMode.GRAYSCALE);
  dup.resizeImage(undefined, undefined, dpi, ResampleMethod.NONE);

  if (addRegMarks) {
    addRegistrationMarks(dup);
  }

  var tiffOptions = new TiffSaveOptions();
  tiffOptions.imageCompression = TIFFEncoding.NONE;
  tiffOptions.byteOrder = ByteOrder.MACOS;
  tiffOptions.transparency = false;
  tiffOptions.layers = false;
  tiffOptions.embedColorProfile = false;

  dup.saveAs(new File(filmPath), tiffOptions, true);
  dup.close(SaveOptions.DONOTSAVECHANGES);
}

function addRegistrationMarks(doc) {
  // Add four corner registration crosses on a new layer.
  var w = doc.width.as("px");
  var h = doc.height.as("px");
  var margin = 30;

  var markLayer = doc.artLayers.add();
  markLayer.name = "RegMarks";

  // Draw four crosses via pixel painting
  var crossSize = 20;
  var corners = [
    [margin, margin],
    [w - margin, margin],
    [margin, h - margin],
    [w - margin, h - margin]
  ];

  for (var i = 0; i < corners.length; i++) {
    var cx = corners[i][0];
    var cy = corners[i][1];
    doc.selection.select([
      [cx - crossSize / 2, cy - 1],
      [cx + crossSize / 2, cy - 1],
      [cx + crossSize / 2, cy + 1],
      [cx - crossSize / 2, cy + 1]
    ]);
    doc.selection.fill(app.foregroundColor);
    doc.selection.select([
      [cx - 1, cy - crossSize / 2],
      [cx + 1, cy - crossSize / 2],
      [cx + 1, cy + crossSize / 2],
      [cx - 1, cy + crossSize / 2]
    ]);
    doc.selection.fill(app.foregroundColor);
    doc.selection.deselect();
  }
}

function guessMesh(channelName, input) {
  var n = channelName.toLowerCase();
  if (n.indexOf("underbase") !== -1 || (n.indexOf("white") !== -1 && n.indexOf("highlight") === -1 && n.indexOf("base") !== -1)) {
    return input.meshCounts.underbase || 156;
  }
  if (n.indexOf("highlight") !== -1) {
    return input.meshCounts.highlight || 305;
  }
  return input.meshCounts.top || 230;
}

function inferInk(channelName) {
  return channelName.replace(/_/g, " ").toLowerCase();
}

function inferPurpose(channelName) {
  var n = channelName.toLowerCase();
  if (n.indexOf("underbase") !== -1) return "underbase";
  if (n.indexOf("highlight") !== -1) return "highlight";
  return "color";
}

function safeName(s) {
  return s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function padNum(n) {
  return (n < 10 ? "0" : "") + n;
}

function readJSON(path) {
  var f = new File(path);
  if (!f.exists) return null;
  f.open("r");
  var s = f.read();
  f.close();
  try {
    // ExtendScript has eval but not JSON.parse in older versions — both work for our shape.
    return eval("(" + s + ")");
  } catch (e) {
    return null;
  }
}

function writeOutput(inputPath, data) {
  var outPath = inputPath.replace("sim-process-input.json", "sim-process-output.json");
  var f = new File(outPath);
  f.open("w");
  f.write(stringify(data));
  f.close();
}

function stringify(obj) {
  // Minimal JSON serializer — ExtendScript has no JSON.stringify natively.
  if (obj === null) return "null";
  var t = typeof obj;
  if (t === "number" || t === "boolean") return String(obj);
  if (t === "string") return '"' + obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
  if (obj instanceof Array) {
    var parts = [];
    for (var i = 0; i < obj.length; i++) parts.push(stringify(obj[i]));
    return "[" + parts.join(",") + "]";
  }
  if (t === "object") {
    var parts2 = [];
    for (var k in obj) {
      if (obj.hasOwnProperty(k)) parts2.push('"' + k + '":' + stringify(obj[k]));
    }
    return "{" + parts2.join(",") + "}";
  }
  return "null";
}

// Entry point — arguments[0] is the input JSON path.
if (typeof arguments !== "undefined" && arguments.length > 0) {
  main(arguments[0]);
} else {
  alert("inktracker-run-actionseps: no input JSON path provided");
}
