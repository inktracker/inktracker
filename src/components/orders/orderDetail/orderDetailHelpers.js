import { O_STATUSES } from "../../shared/pricing";

// Pure helper functions for the Order Detail modal, extracted verbatim
// from OrderDetailModal.jsx. No behavior change.

// STATUS_ORDER previously had its own (different — missing "Order
// Goods") list; replaced with the canonical O_STATUSES so the
// "next status" arrow walks the same pipeline as everything else.
export function getNextStatus(currentStatus) {
  const idx = O_STATUSES.indexOf(currentStatus);
  return idx >= 0 && idx < O_STATUSES.length - 1 ? O_STATUSES[idx + 1] : null;
}

export function getPreviousStatus(currentStatus) {
  const idx = O_STATUSES.indexOf(currentStatus);
  return idx > 0 ? O_STATUSES[idx - 1] : null;
}

export function getImprintArtwork(imp) {
  if (!imp) return null;
  if (!imp.artwork_id && !imp.artwork_name && !imp.artwork_url) return null;

  return {
    id: imp.artwork_id || imp.artwork_url || imp.artwork_name || "",
    name: imp.artwork_name || "Attached Artwork",
    url: imp.artwork_url || "",
    note: imp.artwork_note || "",
    colors: imp.artwork_colors || "",
  };
}

export function getOrderArtwork(order) {
  const map = new Map();

  (order?.selected_artwork || []).forEach((art) => {
    const key = art.id || art.url || art.name;
    if (!key || map.has(key)) return;

    map.set(key, {
      id: art.id || key,
      name: art.name || "Connected Artwork",
      url: art.url || art.file_url || "",
      note: art.note || "",
      colors: art.colors || art.artwork_colors || "",
      source: art.source || "Connected to quote",
      placements: [],
    });
  });

  (order?.line_items || []).forEach((li) => {
    (li.imprints || []).forEach((imp) => {
      const art = getImprintArtwork(imp);
      if (!art) return;

      const key = art.id || art.url || art.name;
      const existing = map.get(key);
      const placement = [imp.location, imp.title].filter(Boolean).join(" · ");

      if (existing) {
        if (placement && !existing.placements.includes(placement)) {
          existing.placements.push(placement);
        }
        if (!existing.colors && art.colors) existing.colors = art.colors;
        if (!existing.note && art.note) existing.note = art.note;
        if (!existing.url && art.url) existing.url = art.url;
        existing.source = "Linked to production imprints";
        return;
      }

      map.set(key, {
        ...art,
        source: "Linked to production imprints",
        placements: placement ? [placement] : [],
      });
    });
  });

  return Array.from(map.values());
}
