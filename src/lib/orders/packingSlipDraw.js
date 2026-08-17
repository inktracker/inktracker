// Compact packing-slip renderer (4×6 label stock).
//
// Takes an already-constructed jsPDF doc and the pure model from
// packingSlipLayout.js — no imports of its own beyond that model, so this
// can be driven from Node in a verification script as well as the browser.
//
// Design rules for 4×6, learned by printing it: at label size the header is
// the enemy. No logo, no ship-to prose block unless it exists, no notes. The
// packer needs four things at arm's length — who it's for, which order, what's
// in the box, how many pieces — so those get the ink and everything else goes.

import { slipSize, buildSlipLines, slipGrandTotal, paginateSlipLines } from "./packingSlipLayout";

export function drawCompactSlip(doc, { order, shopName, customerCompany, finalQuantities, sizeId = "4x6" }) {
  const cfg = slipSize(sizeId);
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const m = cfg.margin;
  const right = W - m;

  const lines = buildSlipLines(order, finalQuantities);
  const grand = slipGrandTotal(lines);

  const shipLines = [];
  if (order?.shipping_address_street) {
    shipLines.push(order.shipping_address_street);
    const cityLine = [order.shipping_address_city, order.shipping_address_state, order.shipping_address_zip]
      .filter(Boolean).join(", ");
    if (cityLine) shipLines.push(cityLine);
  }

  // Header height is fixed, so the body budget is knowable before drawing —
  // that's what lets pagination happen up front instead of mid-draw.
  const headerH = 15 + (shipLines.length ? 3.5 + shipLines.length * 3.2 : 0);
  const totalBlockH = 9;
  const usable = H - m - headerH - totalBlockH - m;
  const pages = paginateSlipLines(lines, cfg, usable);

  pages.forEach((pageLines, pageIdx) => {
    if (pageIdx > 0) doc.addPage(cfg.format, cfg.orientation);
    let y = m + 3;

    // ── Header ──────────────────────────────────────────────────────────
    doc.setFontSize(6.5);
    doc.setFont(undefined, "bold");
    doc.setTextColor(120, 120, 140);
    doc.text(String(shopName || "").toUpperCase(), m, y);
    doc.text("PACKING SLIP", right, y, { align: "right" });
    y += 4.5;

    doc.setFontSize(11);
    doc.setFont(undefined, "bold");
    doc.setTextColor(20, 20, 30);
    doc.text(String(order?.order_id || ""), m, y);
    if (pages.length > 1) {
      doc.setFontSize(6.5);
      doc.setFont(undefined, "normal");
      doc.setTextColor(120, 120, 140);
      doc.text(`${pageIdx + 1} / ${pages.length}`, right, y, { align: "right" });
    }
    y += 4;

    doc.setFontSize(cfg.font.sub);
    doc.setFont(undefined, "normal");
    doc.setTextColor(60, 60, 80);
    const who = customerCompany || order?.customer_name || "";
    if (who) {
      doc.text(doc.splitTextToSize(who, W - 2 * m)[0], m, y);
      y += 3.4;
    }

    if (shipLines.length) {
      doc.setFontSize(5.8);
      doc.setFont(undefined, "bold");
      doc.setTextColor(130, 130, 150);
      doc.text("SHIP TO", m, y);
      y += 3;
      doc.setFont(undefined, "normal");
      doc.setTextColor(70, 70, 90);
      doc.setFontSize(6.5);
      shipLines.forEach((l) => {
        doc.text(doc.splitTextToSize(l, W - 2 * m)[0], m, y);
        y += 3.2;
      });
    }

    y += 1.5;
    doc.setDrawColor(190, 190, 205);
    doc.setLineWidth(0.3);
    doc.line(m, y, right, y);
    y += 4;

    // ── Lines ───────────────────────────────────────────────────────────
    pageLines.forEach((line) => {
      // Check-off box: the packer ticks each line as it goes in the carton.
      doc.setDrawColor(150, 150, 170);
      doc.setLineWidth(0.25);
      doc.rect(m, y - 2.4, 2.6, 2.6);

      doc.setFontSize(cfg.font.title);
      doc.setFont(undefined, "bold");
      doc.setTextColor(25, 25, 35);
      const titleMax = W - 2 * m - 6 - 9;
      doc.text(doc.splitTextToSize(line.title, titleMax)[0], m + 4.5, y);
      doc.text(String(line.total), right, y, { align: "right" });
      y += cfg.lead.title;

      if (line.sub) {
        doc.setFontSize(cfg.font.sub);
        doc.setFont(undefined, "normal");
        doc.setTextColor(105, 105, 125);
        doc.text(doc.splitTextToSize(line.sub, titleMax)[0], m + 4.5, y);
        y += cfg.lead.sub;
      }

      doc.setFontSize(cfg.font.sizes);
      doc.setFont(undefined, "normal");
      doc.setTextColor(70, 70, 90);
      const sizeText = line.sizes.map((r) => `${r.size}:${r.qty}`).join("   ");
      doc.text(doc.splitTextToSize(sizeText, W - 2 * m - 4.5)[0], m + 4.5, y);
      y += cfg.lead.sizes;
    });

    // ── Total (bottom-anchored so every label ends the same way) ─────────
    const ty = H - m - 3;
    doc.setDrawColor(170, 170, 190);
    doc.setLineWidth(0.4);
    doc.line(m, ty - 5, right, ty - 5);
    doc.setFontSize(cfg.font.total);
    doc.setFont(undefined, "bold");
    doc.setTextColor(20, 20, 30);
    doc.text("TOTAL UNITS", m, ty);
    doc.text(String(grand), right, ty, { align: "right" });
  });

  return doc;
}
