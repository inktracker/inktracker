import jsPDF from 'jspdf';
import {
  getQty,
  BIG_SIZES,
  SIZES,
  calcGroupPrice,
  calcQuoteTotals,
  fmtMoney,
  getDisplayName,
  BROKER_MARKUP,
  STANDARD_MARKUP
} from './pricing';

function isBrokerQuote(q) {
  return Boolean(q?.broker_id || q?.broker_email || q?.brokerId);
}

function getQuoteTotalsForPdf(q) {
  return calcQuoteTotals(q || {}, isBrokerQuote(q) ? BROKER_MARKUP : undefined);
}

function getGroupPriceForPdf(li, rushRate, extras, isBroker) {
  return calcGroupPrice(
    li.garmentCost,
    getQty(li),
    li.imprints,
    rushRate,
    extras,
    isBroker ? BROKER_MARKUP : undefined
  );
}

function getEffectiveTaxRate(record) {
  return isBrokerQuote(record) ? 0 : parseFloat(record?.tax_rate || 0);
}

function getOrderPdfClientName(order) {
  if (isBrokerQuote(order)) {
    return order?.customer_name || order?.broker_name || order?.broker_company || '—';
  }
  return order?.customer_name || '—';
}

function getOrderPdfJobTitle(order) {
  if (isBrokerQuote(order)) {
    return order?.job_title || order?.broker_client_name || '';
  }
  return '';
}

function fmtDate(d) {
  if (!d) return '—';
  const p = d.split('-');
  return `${p[1]}/${p[2]}/${p[0]}`;
}

const INKTRACKER_LOGO =
  'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69aa650fd3e825e66ff81817/b4e2dc53f_logo.png';

function cleanText(value) {
  return String(value || '').trim();
}

function moneyNoWeirdMinus(value) {
  const n = Number(value || 0);
  return n < 0 ? `-${fmtMoney(Math.abs(n))}` : fmtMoney(n);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function extractTrailingGarmentNumber(title) {
  const txt = cleanText(title);
  if (!txt) return '';
  const match = txt.match(/-\s*([A-Z0-9-]{3,12})$/i);
  return match ? cleanText(match[1]) : '';
}

function stripTrailingGarmentNumber(title) {
  const txt = cleanText(title);
  if (!txt) return '';
  return txt.replace(/\s*-\s*[A-Z0-9-]{3,12}\s*$/i, '').trim();
}

function looksLikeCode(value) {
  const txt = cleanText(value);
  if (!txt) return false;
  return /^[A-Z0-9-]{2,12}$/i.test(txt) && /\d/.test(txt) && !txt.includes(' ');
}

function isLikelySku(value) {
  const txt = cleanText(value);
  if (!txt) return false;

  if (/^0\d{3,}$/.test(txt)) return true;

  return false;
}

function getGarmentNumber(li) {
  const titleTail = extractTrailingGarmentNumber(li?.productTitle);
  if (titleTail && !isLikelySku(titleTail)) return titleTail;

  const resolvedTitleTail = extractTrailingGarmentNumber(li?.resolvedTitle);
  if (resolvedTitleTail && !isLikelySku(resolvedTitleTail)) return resolvedTitleTail;

  const candidates = [
    li?.resolvedStyleNumber,
    li?.supplierStyleNumber,
    li?.garmentNumber,
    li?.styleNumber,
    li?.productNumber,
    li?.itemNumber,
    li?.catalogNumber,
    li?.style
  ];

  for (const candidate of candidates) {
    const value = cleanText(candidate);
    if (!value) continue;
    if (isLikelySku(value)) continue;
    if (looksLikeCode(value)) return value;
  }

  return cleanText(li?.style) || 'Garment';
}

function getGarmentDescription(li) {
  const candidates = [
    stripTrailingGarmentNumber(li?.productTitle),
    stripTrailingGarmentNumber(li?.resolvedTitle),
    cleanText(li?.productDescription),
    cleanText(li?.product_description),
    cleanText(li?.resolvedDescription),
    cleanText(li?.description),
    cleanText(li?.title),
    cleanText(li?.garmentName),
    cleanText(li?.styleLabel),
    cleanText(li?.displayName),
    cleanText(li?.styleName)
  ];

  const garmentNumber = getGarmentNumber(li).toLowerCase();

  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = candidate.toLowerCase();

    if (normalized === garmentNumber) continue;
    if (looksLikeCode(candidate)) continue;

    return candidate;
  }

  if (cleanText(li?.brand)) return cleanText(li.brand);
  return '';
}

function getItemHeaderLine(li) {
  const garmentNumber = getGarmentNumber(li);
  const storedName = (li?.productName || '').trim();
  const description = (storedName && !looksLikeCode(storedName))
    ? storedName
    : getGarmentDescription(li);

  if (description) {
    return `${garmentNumber} - ${description}`;
  }

  return garmentNumber;
}

function getItemMetaLine(li) {
  const meta = [];

  if (li?.brand) meta.push(`Brand: ${li.brand}`);
  if (li?.garmentColor) meta.push(`Color: ${li.garmentColor}`);

  return meta.join('   •   ');
}

async function addHeader(
  doc,
  title,
  idLine,
  customerPrimary,
  customerSecondary,
  meta1,
  meta2,
  shopName,
  logoUrl,
  customerEmail,
  customerPhone
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  let yPos = margin;

  if (arguments.length < 11) {
    customerPhone = customerEmail;
    customerEmail = logoUrl;
    logoUrl = shopName;
    shopName = meta2;
    meta2 = meta1;
    meta1 = customerSecondary;
    customerSecondary = "";
  }

  const logoSrc = logoUrl || INKTRACKER_LOGO;
  try {
    const img = await loadImage(logoSrc);
    doc.addImage(img, 'PNG', margin, yPos - 2, 14, 14);
  } catch (e) {
    // ignore logo errors
  }

  doc.setFontSize(8);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(120, 120, 140);
  doc.text(shopName || 'InkTracker', margin + 17, yPos + 1);

  doc.setFontSize(7.5);
  doc.setTextColor(140, 140, 160);
  const idParts = String(idLine || '').split(' · ');
  doc.text(idParts[0] || idLine, margin + 17, yPos + 6);
  if (idParts[1]) doc.text(idParts[1], margin + 17, yPos + 11);

  doc.setFontSize(26);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(20, 20, 30);
  doc.text(title, pageWidth - margin, yPos + 8, { align: 'right' });
  yPos += 18;

  doc.setFontSize(13);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(30, 30, 40);
  doc.text(getDisplayName(customerPrimary) || '—', margin, yPos);
  yPos += 6;

  if (customerSecondary) {
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(70, 70, 90);
    doc.text(getDisplayName(customerSecondary), margin, yPos);
    yPos += 4.5;
  }

  doc.setFont(undefined, 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 120);

  if (customerEmail) {
    doc.text(customerEmail, margin, yPos);
    yPos += 4;
  }
  if (customerPhone) {
    doc.text(customerPhone, margin, yPos);
    yPos += 4;
  }
  if (!customerEmail && !customerPhone) yPos += 1;

  if (meta1) doc.text(meta1, margin, yPos);
  if (meta2) doc.text(meta2, pageWidth - margin, yPos, { align: 'right' });
  yPos += 7;

  doc.setDrawColor(180, 180, 200);
  doc.setLineWidth(0.5);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 8;

  return yPos;
}

function renderLineItems(
  doc,
  lineItems,
  rushRate,
  extras,
  discount,
  taxRate,
  pageHeight,
  margin,
  yPos,
  isBroker = false,
  isClientMode = false,
  priceScale = 1,
  discountType = 'percent'
) {
  const pageWidth = doc.internal.pageSize.getWidth();

  lineItems.forEach((li) => {
    if (yPos > pageHeight - 60) {
      doc.addPage();
      yPos = margin;
    }

    const qty = getQty(li);
    const twoXL = BIG_SIZES.reduce(
      (s, sz) => s + (parseInt((li.sizes || {})[sz]) || 0),
      0
    );
    const r = getGroupPriceForPdf(li, rushRate, extras, isBroker);
    const activeSizes = SIZES.filter(
      (sz) => (parseInt((li.sizes || {})[sz]) || 0) > 0
    );

    const headerLine = getItemHeaderLine(li);
    const metaLine = getItemMetaLine(li);
    const headerHeight = metaLine ? 13 : 8;

    doc.setFillColor(238, 240, 250);
    doc.rect(margin, yPos - 4, pageWidth - 2 * margin, headerHeight, 'F');

    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(30, 30, 50);
    doc.text(headerLine, margin + 2, yPos);

    if (r) {
      doc.setFontSize(9);
      doc.setTextColor(67, 56, 202);
      // Client PDF (priceScale is set when client_total_override, else 1;
      // AND per-line clientPpp override takes precedence when client mode).
      const override = Number(li?.clientPpp);
      const useLineOverride = isClientMode && Number.isFinite(override) && override > 0 && qty > 0;
      const lineAmount = useLineOverride ? override * qty : (r.sub + twoXL * 2) * priceScale;
      doc.text(fmtMoney(lineAmount), pageWidth - margin - 2, yPos, {
        align: 'right'
      });
    }

    if (metaLine) {
      doc.setFontSize(7.5);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(95, 105, 130);
      doc.text(metaLine, margin + 2, yPos + 4.5);
    }

    yPos += metaLine ? 11 : 7;
    doc.setFont(undefined, 'normal');

    if (activeSizes.length > 0) {
      const colW = Math.min(
        18,
        (pageWidth - 2 * margin - 30) / (activeSizes.length + 1)
      );
      let xPos = margin + 3;

      doc.setFontSize(7);
      doc.setTextColor(100, 100, 120);
      doc.text('Size', xPos, yPos);
      activeSizes.forEach((sz) => {
        xPos += colW;
        doc.text(sz, xPos, yPos, { align: 'center' });
      });
      xPos += colW;
      doc.text('Total', xPos, yPos, { align: 'center' });
      yPos += 3.5;

      doc.setTextColor(30, 30, 40);
      doc.setFont(undefined, 'bold');
      xPos = margin + 3;
      doc.text('Qty', xPos, yPos);
      activeSizes.forEach((sz) => {
        xPos += colW;
        doc.text(String((li.sizes || {})[sz] || 0), xPos, yPos, {
          align: 'center'
        });
      });
      xPos += colW;
      doc.text(String(qty), xPos, yPos, { align: 'center' });
      yPos += 3.5;

      if (r) {
        doc.setFont(undefined, 'normal');
        doc.setTextColor(100, 100, 120);
        xPos = margin + 3;
        doc.text('Price/ea', xPos, yPos);
        const basePpp = (isClientMode && Number.isFinite(Number(li?.clientPpp)) && Number(li.clientPpp) > 0)
          ? Number(li.clientPpp)
          : r.ppp * priceScale;
        activeSizes.forEach((sz) => {
          xPos += colW;
          const price = basePpp + (BIG_SIZES.includes(sz) ? 2 : 0);
          doc.text(fmtMoney(price), xPos, yPos, { align: 'center' });
        });
        yPos += 4;
      }
    }

    if (li.imprints && li.imprints.length > 0) {
      yPos += 1;

      li.imprints.forEach((imp) => {
        if (yPos > pageHeight - 30) {
          doc.addPage();
          yPos = margin;
        }

        doc.setFontSize(8);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(60, 80, 180);

        const locText = imp.location || '';
        doc.text(locText, margin + 3, yPos);

        doc.setFont(undefined, 'normal');
        doc.setTextColor(80, 80, 100);

        const dims =
          imp.width || imp.height
            ? ` · ${[
                imp.width ? imp.width + '"W' : '',
                imp.height ? imp.height + '"H' : ''
              ]
                .filter(Boolean)
                .join(' × ')}`
            : '';

        const impTitle = imp.title ? ` (${imp.title})` : '';

        doc.text(
          ` — ${imp.colors} color(s) · ${imp.technique}${dims}${impTitle}`,
          margin + 3 + doc.getTextWidth(locText) + 1,
          yPos
        );
        yPos += 4;

        if (imp.pantones) {
          doc.setFontSize(7);
          doc.setTextColor(100, 60, 160);
          doc.text(`  Pantones: ${imp.pantones}`, margin + 5, yPos);
          yPos += 3;
        }

        if (!isClientMode && imp.details) {
          doc.setFontSize(7);
          doc.setTextColor(120, 120, 120);
          doc.text(`  ${imp.details}`, margin + 5, yPos, {
            maxWidth: pageWidth - 2 * margin - 10
          });
          yPos += 3;
        }

        if (!isClientMode && (imp.artwork_name || imp.artwork_url)) {
          doc.setFontSize(7);
          doc.setTextColor(67, 56, 202);
          const artLabel = imp.artwork_name || 'Attached artwork';
          doc.text(`  Artwork: ${artLabel}`, margin + 5, yPos, {
            maxWidth: pageWidth - 2 * margin - 10
          });
          yPos += 3;

          if (imp.artwork_note) {
            doc.setFontSize(6.5);
            doc.setTextColor(120, 120, 120);
            doc.text(`  Note: ${imp.artwork_note}`, margin + 5, yPos, {
              maxWidth: pageWidth - 2 * margin - 10
            });
            yPos += 3;
          }

          if (imp.artwork_colors) {
            doc.setFontSize(6.5);
            doc.setTextColor(67, 56, 202);
            doc.text(`  Artwork colors: ${imp.artwork_colors}`, margin + 5, yPos);
            yPos += 3;
          }
        }
      });
    }

    if (r && !isClientMode) {
      yPos += 1;
      doc.setFillColor(235, 238, 255);
      doc.rect(
        margin + 2,
        yPos - 2,
        pageWidth - 2 * margin - 4,
        parseFloat(discount) > 0 ? 16 : 12,
        'F'
      );

      doc.setFontSize(7.5);

      const overrideForSubtotal = Number(li?.clientPpp);
      const useLineOverrideForSubtotal = isClientMode
        && Number.isFinite(overrideForSubtotal) && overrideForSubtotal > 0 && qty > 0;
      const lineSubtotal = useLineOverrideForSubtotal
        ? overrideForSubtotal * qty + twoXL * 2
        : (r.sub + twoXL * 2) * priceScale;
      const discNum = parseFloat(discount || 0);
      const isFlatDisc = discountType === 'flat' || (discNum > 100 && discountType !== 'percent');
      const afterDisc = isFlatDisc
        ? Math.max(0, lineSubtotal - discNum)
        : lineSubtotal * (1 - discNum / 100);
      const final =
        afterDisc * (1 + parseFloat(taxRate || 0) / 100);

      doc.setTextColor(80, 80, 100);
      doc.text('Line Subtotal:', margin + 4, yPos + 1);

      doc.setFont(undefined, 'bold');
      doc.setTextColor(30, 30, 40);
      doc.text(fmtMoney(lineSubtotal), pageWidth - margin - 4, yPos + 1, {
        align: 'right'
      });
      yPos += 5;

      if (parseFloat(discount) > 0) {
        doc.setFont(undefined, 'normal');
        doc.setTextColor(16, 160, 100);
        const discLabel = isFlatDisc ? `After Discount (${moneyNoWeirdMinus(discNum)}):` : `After Discount (${discount}%):`;
        doc.text(discLabel, margin + 4, yPos);

        doc.setFont(undefined, 'bold');
        doc.text(fmtMoney(afterDisc), pageWidth - margin - 4, yPos, {
          align: 'right'
        });
        yPos += 5;
      }

      doc.setFont(undefined, 'normal');
      doc.setTextColor(67, 56, 202);
      doc.text('Final (incl. tax):', margin + 4, yPos);

      doc.setFont(undefined, 'bold');
      doc.text(fmtMoney(final), pageWidth - margin - 4, yPos, {
        align: 'right'
      });
      yPos += 5;
    }

    yPos += 8;
  });

  return yPos;
}

function renderTotals(doc, totals, discount, taxRate, _depositPct, pageWidth, margin, yPos, isClientMode = false, discountType = 'percent') {
  doc.setDrawColor(180, 180, 200);
  doc.setLineWidth(0.4);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 6;

  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 120);
  doc.text('Subtotal:', margin, yPos);
  doc.setTextColor(30, 30, 40);
  doc.text(fmtMoney(totals.sub), pageWidth - margin - 2, yPos, { align: 'right' });
  yPos += 5;

  if (parseFloat(discount) > 0) {
    const discountAmount = totals.sub - totals.afterDisc;
    const discNum = parseFloat(discount);
    const isFlatDisc = discountType === 'flat' || (discNum > 100 && discountType !== 'percent');

    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(16, 160, 100);
    doc.text(isFlatDisc ? `Discount (${moneyNoWeirdMinus(discNum)}):` : `Discount (${discount}%):`, margin, yPos);

    doc.setFont(undefined, 'bold');
    doc.text(moneyNoWeirdMinus(-discountAmount), pageWidth - margin - 2, yPos, {
      align: 'right'
    });
    yPos += 5;
  }

  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(100, 100, 120);
  doc.text(`Tax (${taxRate}%):`, margin, yPos);
  doc.setTextColor(30, 30, 40);
  doc.text(fmtMoney(totals.tax), pageWidth - margin - 2, yPos, { align: 'right' });
  yPos += 6;

  doc.setDrawColor(180, 180, 200);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 6;

  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(30, 30, 40);
  doc.text('Total:', margin, yPos);

  doc.setFontSize(18);
  doc.setTextColor(67, 56, 202);
  doc.text(fmtMoney(totals.total), pageWidth - margin - 2, yPos, { align: 'right' });
  yPos += 8;

  return yPos;
}

export async function exportQuoteToPDF(
  quote,
  shopNameOrOptions,
  logoUrl,
  customerCompany,
  customerEmail,
  customerPhone
) {
  // Support new signature: exportQuoteToPDF(quote, { mode, shopName, logoUrl, output, ... })
  let mode = 'shop';
  let shopName = shopNameOrOptions;
  let output = 'save'; // 'save' | 'base64'

  if (shopNameOrOptions && typeof shopNameOrOptions === 'object' && !Array.isArray(shopNameOrOptions)) {
    mode = shopNameOrOptions.mode || 'shop';
    shopName = shopNameOrOptions.shopName || '';
    logoUrl = shopNameOrOptions.logoUrl || logoUrl;
    customerCompany = shopNameOrOptions.customerCompany || customerCompany;
    customerEmail = shopNameOrOptions.customerEmail || customerEmail;
    customerPhone = shopNameOrOptions.customerPhone || customerPhone;
    output = shopNameOrOptions.output || 'save';
  }

  // isClientMode = broker ↔ client (broker pricing, broker's client-facing doc)
  // shop mode    = broker ↔ shop   (standard shop pricing, internal production doc)
  const isClientMode = mode === 'client';

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;

  // Broker shop form  = broker pays shop at BROKER_MARKUP
  // Broker client form = broker charges client at STANDARD_MARKUP
  // Admin (non-broker) quote = always STANDARD_MARKUP
  const hasBroker = isBrokerQuote(quote);
  const pdfMarkup = hasBroker && !isClientMode ? BROKER_MARKUP : STANDARD_MARKUP;
  // calcQuoteTotals honors per-line clientPpp overrides on client-mode totals,
  // so baseTotals is already the right number — no quote-wide scaling needed.
  const totals = calcQuoteTotals(quote, pdfMarkup);
  const scale = 1;
  const effectiveTaxRate = getEffectiveTaxRate(quote);

  // Shop Order Form: broker is the "customer" for the shop (they pay the shop).
  // The end client shows as a reference line underneath.
  // Client Quote / Admin Quote: normal flow — company/name header, etc.
  let displayCompany;
  let displayContact;
  if (hasBroker && !isClientMode) {
    displayCompany =
      quote.broker_company ||
      quote.broker_name ||
      quote.broker_email ||
      quote.broker_id ||
      '—';
    const clientName = customerCompany || quote.customer_name;
    displayContact = clientName ? `Reference: ${clientName}` : '';
  } else {
    displayCompany = customerCompany || quote.customer_name || '—';
    displayContact = customerCompany && quote.customer_name ? quote.customer_name : '';
  }

  const titleLabel = hasBroker && !isClientMode ? 'ORDER FORM' : 'QUOTE';
  const statusLine = isClientMode
    ? (quote.due_date ? `In-hands: ${fmtDate(quote.due_date)}` : null)
    : `Status: ${quote.status}${quote.rush_rate > 0 ? ' · RUSH' : ''}`;
  const dueLine = isClientMode
    ? null
    : (quote.due_date ? `In-hands: ${fmtDate(quote.due_date)}` : null);

  // In shop mode, header email = broker's (they're the "customer" to the shop)
  const headerEmail = (hasBroker && !isClientMode)
    ? (quote.broker_email || quote.broker_id || '')
    : (customerEmail || quote.customer_email || '');

  let yPos = await addHeader(
    doc,
    titleLabel,
    `${quote.quote_id} · ${fmtDate(quote.date)}`,
    displayCompany,
    displayContact,
    statusLine,
    dueLine,
    shopName,
    logoUrl,
    headerEmail,
    customerPhone || ''
  );

  const quoteDiscType = quote.discount_type || 'percent';
  if (quote.line_items && quote.line_items.length > 0) {
    yPos = renderLineItems(
      doc,
      quote.line_items,
      quote.rush_rate,
      quote.extras,
      quote.discount,
      effectiveTaxRate,
      pageHeight,
      margin,
      yPos,
      hasBroker && !isClientMode, // broker shop form → BROKER_MARKUP; all others → STANDARD_MARKUP
      isClientMode,
      scale, // scale per-line totals when broker has set a client_total_override
      quoteDiscType
    );
  }

  // Notes: only show in shop mode
  if (!isClientMode && quote.notes) {
    if (yPos > pageHeight - 30) {
      doc.addPage();
      yPos = margin;
    }

    doc.setFillColor(255, 248, 220);
    const noteLines = doc.splitTextToSize(quote.notes, pageWidth - 2 * margin - 8);
    const noteH = noteLines.length * 4.5 + 8;

    doc.rect(margin, yPos - 2, pageWidth - 2 * margin, noteH, 'F');
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(120, 80, 20);
    doc.text('Notes:', margin + 3, yPos + 2);

    doc.setFont(undefined, 'normal');
    doc.text(noteLines, margin + 3, yPos + 7);
    yPos += noteH + 4;
  }

  // Broker info now lives in the header (name + contact email).

  if (yPos > pageHeight - 60) {
    doc.addPage();
    yPos = margin;
  }

  yPos = renderTotals(
    doc,
    totals,
    quote.discount,
    effectiveTaxRate,
    quote.deposit_pct,
    pageWidth,
    margin,
    yPos,
    isClientMode,
    quoteDiscType
  );

  const fileId = quote.quote_id || 'quote';
  const fileName = isClientMode ? `Quote-Client-${fileId}.pdf` : `Quote-Shop-${fileId}.pdf`;
  if (output === 'base64') {
    // jsPDF returns a data-URI; strip the "data:application/pdf;base64," prefix
    const raw = doc.output('datauristring');
    return raw.split(',')[1];
  }
  doc.save(fileName);
  return null;
}

export async function exportOrderToPDF(order, shopName, logoUrl) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const isBrokerOrder = isBrokerQuote(order);
  const displayJobTitle = getOrderPdfJobTitle(order);

  // Match the Shop Order Form header: broker's company becomes the primary
  // label, end client appears as "Reference: …" subtext, broker contact email
  // sits under the name.
  let headerPrimary;
  let headerSecondary;
  let headerEmail = "";
  if (isBrokerOrder) {
    headerPrimary =
      order.broker_company ||
      order.broker_name ||
      order.broker_email ||
      order.broker_id ||
      "—";
    const clientName = order.broker_client_name || order.customer_name;
    headerSecondary = clientName ? `Reference: ${clientName}` : "";
    headerEmail = order.broker_email || order.broker_id || "";
  } else {
    headerPrimary = getOrderPdfClientName(order);
    headerSecondary = displayJobTitle ? `Job: ${displayJobTitle}` : "";
    headerEmail = order.customer_email || "";
  }

  const orderDiscVal = parseFloat(order.discount || 0);
  const orderDiscType = order.discount_type || 'percent';
  const orderIsFlat = orderDiscType === 'flat' || (orderDiscVal > 100 && orderDiscType !== 'percent');
  const totals = {
    sub: order.subtotal || 0,
    afterDisc: orderIsFlat
      ? Math.max(0, (order.subtotal || 0) - orderDiscVal)
      : (order.subtotal || 0) * (1 - orderDiscVal / 100),
    tax: order.tax || 0,
    total: order.total || 0,
    deposit: null
  };

  let yPos = await addHeader(
    doc,
    'ORDER FORM',
    `${order.order_id}${order.quote_id ? ' · ' + order.quote_id : ''}`,
    headerPrimary,
    headerSecondary,
    `Status: ${order.status}`,
    order.due_date ? `In-hands: ${fmtDate(order.due_date)}` : null,
    shopName,
    logoUrl,
    headerEmail,
    ""
  );

  if (order.line_items && order.line_items.length > 0) {
    yPos = renderLineItems(
      doc,
      order.line_items,
      order.rush_rate,
      order.extras,
      order.discount,
      order.tax_rate,
      pageHeight,
      margin,
      yPos,
      isBrokerOrder,
      false,
      1,
      orderDiscType
    );
  }

  if (order.notes) {
    if (yPos > pageHeight - 30) {
      doc.addPage();
      yPos = margin;
    }

    doc.setFillColor(255, 248, 220);
    const noteLines = doc.splitTextToSize(order.notes, pageWidth - 2 * margin - 8);
    const noteH = noteLines.length * 4.5 + 8;

    doc.rect(margin, yPos - 2, pageWidth - 2 * margin, noteH, 'F');
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(120, 80, 20);
    doc.text('Notes:', margin + 3, yPos + 2);

    doc.setFont(undefined, 'normal');
    doc.text(noteLines, margin + 3, yPos + 7);
    yPos += noteH + 4;
  }

  if (yPos > pageHeight - 50) {
    doc.addPage();
    yPos = margin;
  }

  if (order.total !== undefined) {
    yPos = renderTotals(
      doc,
      totals,
      order.discount || 0,
      order.tax_rate || 0,
      null,
      pageWidth,
      margin,
      yPos,
      false,
      orderDiscType
    );

    yPos += 2;
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');

    if (order.paid) {
      doc.setTextColor(16, 160, 100);
      doc.text(`Paid${order.paid_date ? ' on ' + fmtDate(order.paid_date) : ''}`, margin, yPos);
    } else {
      doc.setTextColor(200, 60, 60);
      doc.text('Unpaid', margin, yPos);
    }
  }

  doc.save(`Order-${order.order_id}.pdf`);
}

export async function exportInvoiceToPDF(invoice, customer, shopName, logoUrl, output) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;

  const invDiscVal = parseFloat(invoice.discount || 0);
  const invDiscType = invoice.discount_type || 'percent';
  const invIsFlat = invDiscType === 'flat' || (invDiscVal > 100 && invDiscType !== 'percent');
  const totals = {
    sub: invoice.subtotal || 0,
    afterDisc: invIsFlat
      ? Math.max(0, (invoice.subtotal || 0) - invDiscVal)
      : (invoice.subtotal || 0) * (1 - invDiscVal / 100),
    tax: invoice.tax || 0,
    total: invoice.total || 0,
    deposit: null
  };

  let yPos = await addHeader(
    doc,
    'INVOICE',
    `${invoice.invoice_id} · ${fmtDate(invoice.date)}`,
    customer?.company || invoice.customer_name,
    `Due: ${fmtDate(invoice.due)}`,
    invoice.paid ? `Paid: ${fmtDate(invoice.paid_date)}` : 'Unpaid',
    shopName,
    logoUrl
  );

  if (invoice.line_items && invoice.line_items.length > 0) {
    yPos = renderLineItems(
      doc,
      invoice.line_items,
      invoice.rush_rate || 0,
      invoice.extras || {},
      invoice.discount,
      invoice.tax_rate,
      pageHeight,
      margin,
      yPos,
      false,
      false,
      1,
      invDiscType
    );
  }

  if (invoice.notes) {
    if (yPos > pageHeight - 30) {
      doc.addPage();
      yPos = margin;
    }

    doc.setFillColor(255, 248, 220);
    const noteLines = doc.splitTextToSize(invoice.notes, pageWidth - 2 * margin - 8);
    const noteH = noteLines.length * 4.5 + 8;

    doc.rect(margin, yPos - 2, pageWidth - 2 * margin, noteH, 'F');
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(120, 80, 20);
    doc.text('Notes:', margin + 3, yPos + 2);

    doc.setFont(undefined, 'normal');
    doc.text(noteLines, margin + 3, yPos + 7);
    yPos += noteH + 4;
  }

  if (yPos > pageHeight - 50) {
    doc.addPage();
    yPos = margin;
  }

  yPos = renderTotals(
    doc,
    totals,
    invoice.discount || 0,
    invoice.tax_rate || 0,
    null,
    pageWidth,
    margin,
    yPos,
    false,
    invDiscType
  );

  if (customer) {
    yPos += 6;
    doc.setDrawColor(200, 200, 210);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 6;

    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(80, 80, 100);
    doc.text('Bill To:', margin, yPos);
    yPos += 4;

    doc.setFont(undefined, 'normal');
    doc.setTextColor(30, 30, 40);

    if (customer.company) {
      doc.text(customer.company, margin, yPos);
      yPos += 4;
    }
    if (customer.name) {
      doc.text(customer.name, margin, yPos);
      yPos += 4;
    }
    if (customer.email) {
      doc.text(customer.email, margin, yPos);
      yPos += 4;
    }
    if (customer.phone) {
      doc.text(customer.phone, margin, yPos);
      yPos += 4;
    }
    if (customer.address) {
      doc.text(customer.address, margin, yPos);
      yPos += 4;
    }
  }

  if (output === 'base64') {
    const raw = doc.output('datauristring');
    return raw.split(',')[1];
  }
  doc.save(`Invoice-${invoice.invoice_id}.pdf`);
  return null;
}