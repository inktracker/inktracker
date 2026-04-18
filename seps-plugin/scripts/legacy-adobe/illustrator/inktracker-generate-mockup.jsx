/*
 * inktracker-generate-mockup.jsx
 *
 * Generates a mockup PDF by placing the job's artwork on a garment template
 * that matches the garment color from job.json.
 *
 * Argument: path to job.json for the job. Reads the job context, finds the
 * mockup template in seps-plugin/templates/garments/{color}.ai, places the
 * artwork on it, saves as mockup-front.pdf in mockups/.
 */

#target illustrator

function main(jobJsonPath) {
  var jobFile = new File(jobJsonPath);
  if (!jobFile.exists) {
    alert("inktracker-generate-mockup: job.json not found — " + jobJsonPath);
    return;
  }

  var job = readJSON(jobJsonPath);
  if (!job) {
    alert("inktracker-generate-mockup: could not parse job.json");
    return;
  }

  var jobFolder = jobFile.parent;
  var artworkFolder = new Folder(jobFolder + "/artwork");
  var mockupsFolder = new Folder(jobFolder + "/mockups");
  if (!mockupsFolder.exists) mockupsFolder.create();

  // Find the template
  var color = (job.garmentColor || "black").toLowerCase();
  var pluginFolder = findPluginFolder();
  var templatePath = pluginFolder + "/templates/garments/" + color + ".ai";
  var templateFile = new File(templatePath);

  if (!templateFile.exists) {
    // Fall back to a blank black/white template
    templatePath = pluginFolder + "/templates/garments/black.ai";
    templateFile = new File(templatePath);
    if (!templateFile.exists) {
      alert("inktracker-generate-mockup: no garment template found at " + templatePath);
      return;
    }
  }

  // Find the art file to place
  var artFile = findArtwork(artworkFolder);
  if (!artFile) {
    alert("inktracker-generate-mockup: no artwork found in " + artworkFolder.fsName);
    return;
  }

  // Open the template
  app.open(templateFile);
  var doc = app.activeDocument;

  // Place the art
  var placed = doc.placedItems.add();
  placed.file = artFile;

  // Center the placed art horizontally, position it roughly chest-height
  var docWidth = doc.width;
  var docHeight = doc.height;
  placed.position = [docWidth / 2 - placed.width / 2, docHeight / 2 + 100];

  // Scale to 10" max width (typical front print)
  var maxWidth = 720; // 10" at 72pt
  if (placed.width > maxWidth) {
    var scale = (maxWidth / placed.width) * 100;
    placed.resize(scale, scale);
    // Recenter after resize
    placed.position = [docWidth / 2 - placed.width / 2, docHeight / 2 + 100];
  }

  // Save as PDF
  var pdfOptions = new PDFSaveOptions();
  pdfOptions.compatibility = PDFCompatibility.ACROBAT7;
  pdfOptions.preserveEditability = false;
  pdfOptions.generateThumbnails = true;

  var pdfPath = mockupsFolder + "/mockup-front.pdf";
  doc.saveAs(new File(pdfPath), pdfOptions);

  doc.close(SaveOptions.DONOTSAVECHANGES);
}

function findPluginFolder() {
  // The script lives in Illustrator's Scripts folder after install.
  // We hardcode the plugin's template location via a sibling config.
  // User can override by placing a .inktracker-plugin-path file in ~/.
  var hintFile = new File("~/.inktracker-plugin-path");
  if (hintFile.exists) {
    hintFile.open("r");
    var hint = hintFile.read();
    hintFile.close();
    return hint.replace(/\s+$/, "");
  }
  // Default: follow the install location
  return "/Users/joeygrennan/Downloads/inktracker/seps-plugin";
}

function findArtwork(folder) {
  var candidates = folder.getFiles(function(f) {
    var n = f.name.toLowerCase();
    return (n.match(/\.(ai|eps|pdf|psd|png|tif|tiff|jpg|jpeg)$/) && n.indexOf("original") !== -1);
  });
  if (candidates.length > 0) return candidates[0];

  candidates = folder.getFiles(function(f) {
    var n = f.name.toLowerCase();
    return n.match(/\.(ai|eps|pdf|png|tif|tiff)$/);
  });
  return candidates.length > 0 ? candidates[0] : null;
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

if (typeof arguments !== "undefined" && arguments.length > 0) {
  main(arguments[0]);
} else {
  alert("inktracker-generate-mockup: no job.json path provided");
}
