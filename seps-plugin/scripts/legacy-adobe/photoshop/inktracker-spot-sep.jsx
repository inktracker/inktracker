/*
 * inktracker-spot-sep.jsx
 *
 * Spot-color separation: for each color layer defined in the input JSON,
 * extract that layer, convert to grayscale, and export as a film-ready TIF.
 *
 * Invoked by the /prep-spot Cowork skill.
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

  var sourceFile = new File(input.sourceFile);
  if (!sourceFile.exists) {
    writeOutput(inputJsonPath, { success: false, error: "Source file not found: " + input.sourceFile });
    return;
  }

  app.open(sourceFile);
  var doc = app.activeDocument;

  var outputDir = new Folder(input.outputDir);
  if (!outputDir.exists) outputDir.create();

  var films = [];

  for (var i = 0; i < input.colors.length; i++) {
    var colorSpec = input.colors[i];
    var filmName = padNum(colorSpec.index) + "_" + safeName(colorSpec.name) + "_" + colorSpec.meshCount;
    var filmPath = input.outputDir + "/" + filmName + ".tif";

    try {
      exportLayerAsFilm(doc, colorSpec, filmPath, input.filmDpi, input.registrationMarks);
      films.push({
        index: colorSpec.index,
        name: filmName,
        path: filmPath,
        meshCount: colorSpec.meshCount,
        ink: colorSpec.ink,
        purpose: colorSpec.purpose || "color"
      });
    } catch (e) {
      warnings.push("Failed to export " + colorSpec.name + ": " + e.message);
    }
  }

  doc.close(SaveOptions.DONOTSAVECHANGES);

  var elapsed = Math.round((new Date().getTime() - startTime) / 1000);

  writeOutput(inputJsonPath, {
    success: films.length > 0,
    films: films,
    elapsedSeconds: elapsed,
    warnings: warnings
  });
}

function exportLayerAsFilm(doc, colorSpec, filmPath, dpi, addRegMarks) {
  // Duplicate the doc, hide everything except this color's layer, flatten, convert.
  var dup = doc.duplicate(doc.name + "_" + colorSpec.name, false);

  // Find the layer matching the color name and hide all others
  hideAllLayersExcept(dup, colorSpec.name);
  dup.flatten();

  // Convert to grayscale — for spot film output
  dup.changeMode(ChangeMode.GRAYSCALE);

  // Invert so ink areas are dark (film positive)
  // Note: film output depends on press setup — some operators prefer positive,
  // some negative. ActionSeps conventions are positive. We match that.

  dup.resizeImage(undefined, undefined, dpi, ResampleMethod.NONE);

  if (addRegMarks) {
    addRegistrationMarks(dup);
  }

  var tiffOptions = new TiffSaveOptions();
  tiffOptions.imageCompression = TIFFEncoding.NONE;
  tiffOptions.byteOrder = ByteOrder.MACOS;
  tiffOptions.transparency = false;
  tiffOptions.layers = false;

  dup.saveAs(new File(filmPath), tiffOptions, true);
  dup.close(SaveOptions.DONOTSAVECHANGES);
}

function hideAllLayersExcept(doc, layerName) {
  var target = layerName.toLowerCase();
  for (var i = 0; i < doc.layers.length; i++) {
    var layer = doc.layers[i];
    var n = layer.name.toLowerCase();
    // Match on substring so "Pantone 289 C - Navy" matches "navy"
    layer.visible = (n.indexOf(target) !== -1 || target.indexOf(n) !== -1);
  }
}

function addRegistrationMarks(doc) {
  var w = doc.width.as("px");
  var h = doc.height.as("px");
  var margin = 30;
  var crossSize = 20;
  var corners = [
    [margin, margin],
    [w - margin, margin],
    [margin, h - margin],
    [w - margin, h - margin]
  ];

  var markLayer = doc.artLayers.add();
  markLayer.name = "RegMarks";

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
  doc.flatten();
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
    return eval("(" + s + ")");
  } catch (e) {
    return null;
  }
}

function writeOutput(inputPath, data) {
  var outPath = inputPath.replace("spot-sep-input.json", "spot-sep-output.json");
  var f = new File(outPath);
  f.open("w");
  f.write(stringify(data));
  f.close();
}

function stringify(obj) {
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

if (typeof arguments !== "undefined" && arguments.length > 0) {
  main(arguments[0]);
} else {
  alert("inktracker-spot-sep: no input JSON path provided");
}
