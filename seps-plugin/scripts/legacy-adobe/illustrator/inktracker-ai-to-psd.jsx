/*
 * inktracker-ai-to-psd.jsx
 *
 * Converts an Illustrator .ai file into a layered PSD where each named
 * color in the artwork is its own visible layer. This is the input format
 * the Photoshop spot-sep script expects.
 *
 * Argument: the path to the .ai file to convert. Output is saved in
 * the same job's seps/ folder as prepared.psd.
 */

#target illustrator

function main(aiPath) {
  var aiFile = new File(aiPath);
  if (!aiFile.exists) {
    alert("inktracker-ai-to-psd: file not found — " + aiPath);
    return;
  }

  app.open(aiFile);
  var doc = app.activeDocument;

  // Expand appearances so gradients/effects become real shapes
  app.executeMenuCommand("expandStyle");

  // Separate by spot color / swatch
  var usedColors = collectUsedSpotColors(doc);

  if (usedColors.length === 0) {
    // Fall back to layer names if no spot colors found
    usedColors = collectLayerNames(doc);
  }

  // Build output path — sibling seps/ folder of artwork/
  var parentFolder = aiFile.parent.parent; // up from artwork/
  var sepsFolder = new Folder(parentFolder + "/seps");
  if (!sepsFolder.exists) sepsFolder.create();

  var psdPath = sepsFolder + "/prepared.psd";

  // Group visible objects by their spot color and put each group on its own layer.
  reLayerByColor(doc, usedColors);

  // Export to PSD preserving layers
  var exportOpts = new ExportOptionsPhotoshop();
  exportOpts.writeLayers = true;
  exportOpts.resolution = 360;
  exportOpts.antiAliasing = true;
  exportOpts.embedICCProfile = false;

  var psdFile = new File(psdPath);
  doc.exportFile(psdFile, ExportType.PHOTOSHOP, exportOpts);

  doc.close(SaveOptions.DONOTSAVECHANGES);

  // Write a sidecar JSON listing the colors for the Photoshop side to verify
  var sidecar = new File(sepsFolder + "/prepared.colors.json");
  sidecar.open("w");
  sidecar.write('{"colors":' + stringifyArray(usedColors) + '}');
  sidecar.close();
}

function collectUsedSpotColors(doc) {
  var colors = [];
  var seen = {};
  for (var i = 0; i < doc.pathItems.length; i++) {
    var p = doc.pathItems[i];
    try {
      if (p.filled && p.fillColor.typename === "SpotColor") {
        var name = p.fillColor.spot.name;
        if (!seen[name]) {
          seen[name] = true;
          colors.push(name);
        }
      }
      if (p.stroked && p.strokeColor.typename === "SpotColor") {
        var sname = p.strokeColor.spot.name;
        if (!seen[sname]) {
          seen[sname] = true;
          colors.push(sname);
        }
      }
    } catch (e) {}
  }
  return colors;
}

function collectLayerNames(doc) {
  var names = [];
  for (var i = 0; i < doc.layers.length; i++) {
    if (doc.layers[i].visible) names.push(doc.layers[i].name);
  }
  return names;
}

function reLayerByColor(doc, colors) {
  // For each detected color, create a new top-level layer and move
  // any path items with that fill onto it. This produces a PSD where
  // the Photoshop script can isolate by layer name.

  // Build lookup of existing color → new layer
  var layerByColor = {};
  for (var c = 0; c < colors.length; c++) {
    var layer = doc.layers.add();
    layer.name = colors[c];
    layerByColor[colors[c]] = layer;
  }

  // Collect all path items first, since moving mutates the collection.
  var allPaths = [];
  for (var i = 0; i < doc.pathItems.length; i++) {
    allPaths.push(doc.pathItems[i]);
  }

  for (var j = 0; j < allPaths.length; j++) {
    var p = allPaths[j];
    try {
      if (p.filled && p.fillColor.typename === "SpotColor") {
        var name = p.fillColor.spot.name;
        if (layerByColor[name]) p.move(layerByColor[name], ElementPlacement.PLACEATEND);
      }
    } catch (e) {}
  }
}

function stringifyArray(arr) {
  var parts = [];
  for (var i = 0; i < arr.length; i++) {
    parts.push('"' + arr[i].replace(/"/g, '\\"') + '"');
  }
  return "[" + parts.join(",") + "]";
}

if (typeof arguments !== "undefined" && arguments.length > 0) {
  main(arguments[0]);
} else {
  alert("inktracker-ai-to-psd: no .ai file path provided");
}
