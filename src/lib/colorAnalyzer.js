// Analyzes an uploaded image for distinct spot colors (screen printing use case).
// Uses Canvas API — works for PNG, JPG, GIF, SVG rendered to raster.
// Returns { colorCount, colors: [{hex, rgb, percentage, pantone}], isPhoto }

import { PANTONE_TABLE } from "./pantoneColors";

const MAX_DIMENSION = 200; // higher resolution for better color separation
const DISTANCE_THRESHOLD = 45; // tighter clustering — keep distinct colors separate
const MERGE_THRESHOLD = 45; // second-pass merge — match first-pass
const PHOTO_THRESHOLD = 8; // above this many clusters → probably a photo
const MIN_PERCENTAGE = 2; // lower threshold to catch accent colors
const BG_BRIGHTNESS = 230; // RGB avg above this = background (white/near-white)

function rgbDistance(a, b) {
  return Math.sqrt(
    (a[0] - b[0]) ** 2 +
    (a[1] - b[1]) ** 2 +
    (a[2] - b[2]) ** 2
  );
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map(c => c.toString(16).padStart(2, "0")).join("");
}

function findNearestPantone(rgb) {
  let best = null;
  let bestDist = Infinity;
  for (const [name, pms] of PANTONE_TABLE) {
    const d = rgbDistance(rgb, [pms.r, pms.g, pms.b]);
    if (d < bestDist) {
      bestDist = d;
      best = { name, hex: rgbToHex(pms.r, pms.g, pms.b), distance: Math.round(d) };
    }
  }
  return best;
}

function loadImageToCanvas(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      const scale = Math.min(MAX_DIMENSION / w, MAX_DIMENSION / h, 1);
      w = Math.round(w * scale);
      h = Math.round(h * scale);

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      // White background so transparent PNGs don't read as black
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve({ ctx, w, h });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load image"));
    };
    img.src = url;
  });
}

export async function analyzeColors(file) {
  if (!file) return null;
  const type = file.type || "";
  // Only process raster image types
  if (!type.startsWith("image/") && !file.name?.match?.(/\.(png|jpe?g|gif|svg|webp|bmp)$/i)) {
    return { unsupported: true, message: "Color detection works on image files (PNG, JPG, SVG). Vector files (AI, EPS, PDF) require manual color count." };
  }

  const { ctx, w, h } = await loadImageToCanvas(file);
  const imageData = ctx.getImageData(0, 0, w, h).data;
  const totalPixels = w * h;

  // Sample every pixel, skip fully-transparent
  const pixelColors = [];
  for (let i = 0; i < imageData.length; i += 4) {
    const a = imageData[i + 3];
    if (a < 128) continue; // skip transparent
    pixelColors.push([imageData[i], imageData[i + 1], imageData[i + 2]]);
  }

  if (pixelColors.length === 0) {
    return { colorCount: 0, colors: [], isPhoto: false };
  }

  // Detect background by sampling edges (top/bottom/left/right, 2px deep)
  const edgePixels = [];
  const depth = 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y < depth || y >= h - depth || x < depth || x >= w - depth) {
        const i = (y * w + x) * 4;
        if (imageData[i + 3] >= 128) {
          edgePixels.push([imageData[i], imageData[i + 1], imageData[i + 2]]);
        }
      }
    }
  }
  // Find the dominant edge color (most common cluster among edge pixels)
  let bgColor = null;
  if (edgePixels.length > 0) {
    const edgeClusters = [];
    for (const px of edgePixels) {
      let found = false;
      for (const ec of edgeClusters) {
        if (rgbDistance(px, ec.rgb) < DISTANCE_THRESHOLD) {
          ec.count++;
          found = true;
          break;
        }
      }
      if (!found) edgeClusters.push({ rgb: [...px], count: 1 });
    }
    edgeClusters.sort((a, b) => b.count - a.count);
    if (edgeClusters[0] && edgeClusters[0].count > edgePixels.length * 0.3) {
      bgColor = edgeClusters[0].rgb;
    }
  }

  // Simple greedy clustering: walk through pixels, assign to nearest cluster
  // or start a new one if no cluster is close enough.
  const clusters = []; // [{rgb, count}]

  for (const px of pixelColors) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let c = 0; c < clusters.length; c++) {
      const d = rgbDistance(px, clusters[c].rgb);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = c;
      }
    }
    if (bestIdx >= 0 && bestDist < DISTANCE_THRESHOLD) {
      clusters[bestIdx].count += 1;
      // Running average to shift cluster center toward its members
      const cl = clusters[bestIdx];
      const n = cl.count;
      cl.rgb = [
        Math.round(cl.rgb[0] + (px[0] - cl.rgb[0]) / n),
        Math.round(cl.rgb[1] + (px[1] - cl.rgb[1]) / n),
        Math.round(cl.rgb[2] + (px[2] - cl.rgb[2]) / n),
      ];
    } else {
      clusters.push({ rgb: [...px], count: 1 });
    }
  }

  // Second pass: merge clusters that are still close to each other
  // (the greedy first pass can miss merges depending on pixel order)
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (rgbDistance(clusters[i].rgb, clusters[j].rgb) < MERGE_THRESHOLD) {
          const total = clusters[i].count + clusters[j].count;
          clusters[i].rgb = [
            Math.round((clusters[i].rgb[0] * clusters[i].count + clusters[j].rgb[0] * clusters[j].count) / total),
            Math.round((clusters[i].rgb[1] * clusters[i].count + clusters[j].rgb[1] * clusters[j].count) / total),
            Math.round((clusters[i].rgb[2] * clusters[i].count + clusters[j].rgb[2] * clusters[j].count) / total),
          ];
          clusters[i].count = total;
          clusters.splice(j, 1);
          merged = true;
          break;
        }
      }
      if (merged) break;
    }
  }

  // Filter out noise, identify background, and match Pantone
  const all = clusters
    .map(c => {
      const brightness = (c.rgb[0] + c.rgb[1] + c.rgb[2]) / 3;
      const matchesBgColor = bgColor ? rgbDistance(c.rgb, bgColor) < DISTANCE_THRESHOLD : false;
      // Only use brightness fallback when edge detection didn't find a background.
      // White is a real ink color on dark garments — don't auto-exclude it when
      // the actual background is dark.
      const isBg = bgColor ? matchesBgColor : brightness >= BG_BRIGHTNESS;
      const pantone = isBg ? null : findNearestPantone(c.rgb);
      return {
        rgb: c.rgb,
        hex: rgbToHex(...c.rgb),
        percentage: Number(((c.count / pixelColors.length) * 100).toFixed(1)),
        count: c.count,
        isBackground: isBg,
        pantone,
      };
    })
    .filter(c => c.percentage >= MIN_PERCENTAGE)
    .sort((a, b) => b.percentage - a.percentage);

  // Spot colors = non-background significant clusters
  const spotColors = all.filter(c => !c.isBackground);
  const isPhoto = spotColors.length > PHOTO_THRESHOLD;

  return {
    colorCount: spotColors.length,
    colors: all.slice(0, 20),
    spotColors,
    isPhoto,
    suggestion: isPhoto
      ? "This looks like a photo — recommend 4-color process (CMYK) or simulated process print."
      : spotColors.length === 0
        ? "No spot colors detected (image may be all white/background)."
        : `Detected ${spotColors.length} spot color${spotColors.length === 1 ? "" : "s"}${all.some(c => c.isBackground) ? " (excluding background)" : ""}.`,
  };
}
