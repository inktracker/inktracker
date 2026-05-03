import jsPDF from "jspdf";
import {
  calcQuoteTotals,
  calcLinkedLinePrice,
  buildLinkedQtyMap,
  getQty,
  fmtMoney,
  BIG_SIZES,
  BROKER_MARKUP,
  sortSizeEntries,
} from "@/components/shared/pricing";

/**
 * Generates a quote PDF and returns base64 string (no data URI prefix).
 */
export function generateQuotePDF({ quote, shopName, paymentLink, markup }) {
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const totals = calcQuoteTotals(quote, markup);
  const linkedQtyMap = buildLinkedQtyMap(quote.line_items || []);

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentW = W - margin * 2;
  let y = margin;

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function checkPage(needed = 10) {
    if (y + needed > H - margin) {
      doc.addPage();
      y = margin;
    }
  }

  function hLine(rgb = [226, 232, 240]) {
    doc.setDrawColor(...rgb);
    doc.setLineWidth(0.25);
    doc.line(margin, y, W - margin, y);
    y += 4;
  }

  function cell(txt, x, size = 10, style = "normal", rgb = [51, 65, 85]) {
    doc.setFontSize(size);
    doc.setFont("helvetica", style);
    doc.setTextColor(...rgb);
    doc.text(String(txt ?? ""), x, y);
  }

  function rCell(txt, size = 10, style = "normal", rgb = [51, 65, 85]) {
    doc.setFontSize(size);
    doc.setFont("helvetica", style);
    doc.setTextColor(...rgb);
    doc.text(String(txt ?? ""), W - margin, y, { align: "right" });
  }

  function tableRow(label, value, boldValue = false) {
    checkPage(7);
    cell(label, margin, 10, "normal", [100, 116, 139]);
    rCell(value, 10, boldValue ? "bold" : "normal", boldValue ? [79, 70, 229] : [51, 65, 85]);
    y += 6;
  }

  // ── Header bar ───────────────────────────────────────────────────────────────
  doc.setFillColor(30, 41, 59);
  doc.rect(0, 0, W, 30, "F");

  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text(shopName || "Shop", margin, 13);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(148, 163, 184);
  doc.text(`Quote #${quote.quote_id || ""}`, margin, 21);

  if (quote.date) {
    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184);
    doc.text(
      new Date(quote.date + "T12:00:00").toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
      }),
      W - margin, 13, { align: "right" }
    );
  }
  if (quote.due_date) {
    doc.setTextColor(129, 140, 248);
    doc.text(
      `In-Hands: ${new Date(quote.due_date + "T12:00:00").toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
      })}`,
      W - margin, 21, { align: "right" }
    );
  }

  y = 40;

  // ── Customer ─────────────────────────────────────────────────────────────────
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.text(quote.customer_name || "", margin, y);
  y += 7;

  if (quote.job_title) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text(quote.job_title, margin, y);
    y += 5;
  }

  const email = quote.customer_email || quote.sent_to || "";
  if (email) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text(email, margin, y);
    y += 5;
  }

  y += 3;
  hLine();

  // ── Line Items ───────────────────────────────────────────────────────────────
  for (const li of quote.line_items || []) {
    const qty = getQty(li);
    if (!qty) continue;

    const twoXL = BIG_SIZES.reduce(
      (s, sz) => s + (parseInt((li.sizes || {})[sz], 10) || 0), 0
    );
    const pricing = calcLinkedLinePrice(li, quote.rush_rate, quote.extras, markup, linkedQtyMap);
    const lineTotal = pricing ? pricing.sub + twoXL * 2 : 0;
    const perPiece = qty > 0 ? lineTotal / qty : 0;

    // Garment label
    let label = li.productName || li.style || "Garment";
    if (li.brand) label = `${li.brand} — ${label}`;
    if (li.garmentColor) label += ` · ${li.garmentColor}`;

    checkPage(22);

    // Row background
    doc.setFillColor(248, 250, 252);
    doc.rect(margin, y - 4, contentW, 11, "F");

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text(label, margin + 2, y + 2);

    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(79, 70, 229);
    doc.text(fmtMoney(lineTotal), W - margin, y + 2, { align: "right" });

    y += 12;

    // Sizes summary
    const activeSizes = sortSizeEntries(Object.entries(li.sizes || {})).filter(([, v]) => parseInt(v, 10) > 0);
    if (activeSizes.length > 0) {
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139);
      const sizeStr = activeSizes.map(([sz, v]) => `${sz}: ${v}`).join("  ·  ");
      const wrapped = doc.splitTextToSize(sizeStr, contentW - 4);
      doc.text(wrapped, margin + 2, y);
      y += wrapped.length * 4.5 + 2;

      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text(`${qty} pcs  ·  ${fmtMoney(perPiece)}/ea`, W - margin, y - wrapped.length * 4.5, { align: "right" });
    }

    // Imprints
    for (const imp of li.imprints || []) {
      if (!imp.colors && !imp.location) continue;
      // Drop the location from the tail if it's already in the title, so we
      // don't render e.g. "Front Logo · Front".
      const titleHasLocation = imp.title && imp.location
        && imp.title.toLowerCase().includes(imp.location.toLowerCase());
      const headPart = imp.title
        ? (titleHasLocation ? imp.title : `${imp.title} · ${imp.location || ""}`)
        : (imp.location || "");
      const parts = [
        headPart,
        imp.colors > 0 ? `${imp.colors} color${imp.colors !== 1 ? "s" : ""}` : "",
        imp.technique || "",
        imp.pantones ? `Pantones: ${imp.pantones}` : "",
      ].filter(Boolean);
      const text = `  - ${parts.join(" · ")}`;
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(99, 102, 241);
      // Wrap long imprint lines so they don't run off the right margin
      const lines = doc.splitTextToSize(text, contentW - 4);
      for (const line of lines) {
        checkPage(6);
        doc.text(line, margin + 2, y);
        y += 4.5;
      }
    }

    y += 3;
    hLine([241, 245, 249]);
  }

  y += 4;

  // ── Totals ───────────────────────────────────────────────────────────────────
  checkPage(35);

  tableRow("Subtotal", fmtMoney(totals.sub));

  if ((parseFloat(quote.discount) || 0) > 0) {
    checkPage(7);
    cell(`Discount (${quote.discount}%)`, margin, 10, "normal", [100, 116, 139]);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(5, 150, 105);
    doc.text(`−${fmtMoney(totals.sub - totals.afterDisc)}`, W - margin, y, { align: "right" });
    y += 6;
  }

  const hasQb = quote.qb_total != null;
  const displayTax   = hasQb ? Number(quote.qb_tax_amount || 0) : totals.tax;
  const displayTotal = hasQb ? Number(quote.qb_total || 0)       : totals.total;

  if (displayTax > 0) {
    const taxLabel = hasQb ? "Tax" : `Est. Tax (${quote.tax_rate}%)`;
    tableRow(taxLabel, fmtMoney(displayTax));
  }

  checkPage(10);
  hLine([203, 213, 225]);
  tableRow(hasQb ? "Total Due" : "Est. Total", fmtMoney(displayTotal), true);

  if (!hasQb) {
    checkPage(8);
    y += 2;
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text("Final tax is calculated based on ship-to address at checkout.", margin, y);
    y += 5;
    doc.setTextColor(0, 0, 0);
  }

  // ── Notes ────────────────────────────────────────────────────────────────────
  if (quote.notes) {
    checkPage(20);
    y += 4;
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(100, 116, 139);
    doc.text("Notes", margin, y);
    y += 4.5;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    const noteLines = doc.splitTextToSize(quote.notes, contentW);
    doc.text(noteLines, margin, y);
    y += noteLines.length * 4.5 + 4;
  }

  // ── Sales tax + production terms disclaimer ────────────────────────────────
  {
    checkPage(30);
    y += 3;
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(120, 120, 120);
    const disclaimer =
      "Sales tax shown reflects jurisdictions where we are registered to collect. " +
      "Buyer is responsible for any use tax owed to their home jurisdiction.\n\n" +
      "Production tolerance: industry-standard spoilage applies. Orders short up to 3% " +
      "will receive a credit to your account. Defect rates above 3% will be reprinted " +
      "at no charge within 7–10 business days. Claims must be submitted with photos " +
      "within 72 hours of delivery. Misprinted garments do not need to be returned. " +
      "Approved proofs are final.";
    const discLines = doc.splitTextToSize(disclaimer, contentW);
    doc.text(discLines, margin, y);
    y += discLines.length * 4 + 3;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 0, 0);
  }

  // ── Payment CTA ──────────────────────────────────────────────────────────────
  if (paymentLink) {
    checkPage(20);
    y += 6;
    doc.setFillColor(238, 242, 255);
    doc.roundedRect(margin, y, contentW, 16, 3, 3, "F");
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(79, 70, 229);
    doc.text("View & Pay Online:", margin + 3, y + 6.5);
    doc.setFont("helvetica", "normal");
    const linkW = contentW - 46;
    const linkLines = doc.splitTextToSize(paymentLink, linkW);
    doc.text(linkLines[0], margin + 40, y + 6.5);
    y += 22;
  }

  // ── Page footers ─────────────────────────────────────────────────────────────
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Generated by InkTracker  ·  Page ${i} of ${pages}`,
      W / 2, H - 8, { align: "center" }
    );
  }

  return doc.output("datauristring").split(",")[1];
}
