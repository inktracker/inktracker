// Attaching a Mockup Designer proof PDF to an order/quote's artwork.
//
// Mockup proofs are the selected_artwork entries the designer creates
// (type "proof"). Re-sending a mockup normally REPLACES the previous one:
// the artwork list is what the customer reviews and approves, so stacking
// old mockups would show them every past version side by side.

/** True for a proof PDF made by the Mockup Designer. */
export function isMockupProof(entry) {
  return entry?.type === "proof";
}

/** How many mockup proofs the record already carries. */
export function countMockupProofs(selectedArtwork) {
  return (Array.isArray(selectedArtwork) ? selectedArtwork : []).filter(isMockupProof).length;
}

/**
 * The record's next selected_artwork: the new proof appended, and (when
 * `replace`) earlier mockup proofs dropped. Uploaded art files are never
 * touched. Only the link is removed — the stored file stays.
 */
export function withMockupProof(selectedArtwork, entry, { replace = true } = {}) {
  const current = Array.isArray(selectedArtwork) ? selectedArtwork : [];
  const kept = replace ? current.filter((a) => !isMockupProof(a)) : current;
  return [...kept, entry];
}

/** Who a proof for this order goes to (broker orders → the broker). */
export function proofRecipientEmail(order) {
  const broker = String(order?.broker_id || "").trim();
  if (broker.includes("@")) return broker;
  return String(order?.customer_email || "").trim();
}

/**
 * The most recent mockup on the record that saved its design (so the
 * designer can reopen it for a revision), or null.
 */
export function latestMockupDesign(selectedArtwork) {
  const list = (Array.isArray(selectedArtwork) ? selectedArtwork : []).filter((a) => isMockupProof(a) && a?.design?.v === 1);
  return list.length ? list[list.length - 1] : null;
}

/**
 * A designer image (data: URL from a file pick, or a signed http URL from a
 * restored mockup) as an uploadable PNG/JPG File. Other formats (SVG,
 * WebP…) are drawn to a canvas and saved as PNG.
 */
export async function imageSrcToFile(src, baseName) {
  const blob = await (await fetch(src)).blob();
  if (blob.type === "image/png" || blob.type === "image/jpeg") {
    return new File([blob], `${baseName}.${blob.type === "image/png" ? "png" : "jpg"}`, { type: blob.type });
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || 1200;
    canvas.height = img.naturalHeight || 1200;
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("Couldn't save the artwork image.");
    return new File([png], `${baseName}.png`, { type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
}
