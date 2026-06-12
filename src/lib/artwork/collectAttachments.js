// Aggregate every attachment on a quote or order into one deduped list
// for viewing. Quotes and orders share the same shape — a record-level
// `selected_artwork` array (uploaded files + Mockups-page proofs) plus
// imprint-level artwork on each line item — so one collector serves
// both. Extracted from OrderDetailModal's getOrderArtwork (2026-05) so
// the shop quote modal and both broker drawers can reuse it.
//
// Returns: [{ id, name, url, path, note, colors, source, placements[] }]
// `placements` lists the "Location · Title" of each imprint an artwork
// is linked to, so the gallery can show where a file is used.

function fromImprint(imp) {
  if (!imp) return null;
  if (!imp.artwork_id && !imp.artwork_name && !imp.artwork_url) return null;
  return {
    id: imp.artwork_id || imp.artwork_url || imp.artwork_name || "",
    name: imp.artwork_name || "Attached Artwork",
    url: imp.artwork_url || "",
    path: imp.artwork_path || "",
    note: imp.artwork_note || "",
    colors: imp.artwork_colors || "",
  };
}

export function collectAttachments(record) {
  const map = new Map();

  (record?.selected_artwork || []).forEach((art) => {
    const key = art.id || art.url || art.file_url || art.name;
    if (!key || map.has(key)) return;
    map.set(key, {
      id: art.id || key,
      name: art.name || "Attached file",
      url: art.url || art.file_url || "",
      path: art.path || "",
      note: art.note || "",
      colors: art.colors || art.artwork_colors || "",
      source: art.source || "Attached to this job",
      placements: [],
    });
  });

  (record?.line_items || []).forEach((li) => {
    (li.imprints || []).forEach((imp) => {
      const art = fromImprint(imp);
      if (!art) return;
      const key = art.id || art.url || art.name;
      const placement = [imp.location, imp.title].filter(Boolean).join(" · ");
      const existing = map.get(key);
      if (existing) {
        if (placement && !existing.placements.includes(placement)) existing.placements.push(placement);
        if (!existing.colors && art.colors) existing.colors = art.colors;
        if (!existing.note && art.note) existing.note = art.note;
        if (!existing.url && art.url) existing.url = art.url;
        if (!existing.path && art.path) existing.path = art.path;
        return;
      }
      map.set(key, { ...art, source: "Linked to an imprint", placements: placement ? [placement] : [] });
    });
  });

  // Only return entries that actually have something to open.
  return Array.from(map.values()).filter((a) => a.url || a.path);
}
