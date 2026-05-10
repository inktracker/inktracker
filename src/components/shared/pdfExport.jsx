// jspdf (~150 KB gzipped) is loaded on demand via dynamic import inside each
// export function below. Keeps it out of the main bundle until a user actually
// generates a PDF. The first PDF in a session triggers the chunk fetch; later
// PDFs reuse the cached promise.
import {
  getQty,
  BIG_SIZES,
  SIZES,
  calcLinkedLinePrice,
  buildLinkedQtyMap,
  calcQuoteTotals,
  fmtMoney,
  getDisplayName,
  BROKER_MARKUP,
  STANDARD_MARKUP
} from './pricing';

let _jsPdfPromise;
function loadJsPDF() {
  if (!_jsPdfPromise) _jsPdfPromise = import('jspdf').then((m) => m.default || m.jsPDF);
  return _jsPdfPromise;
}

function isBrokerQuote(q) {
  return Boolean(q?.broker_id || q?.broker_email || q?.brokerId);
}

function getQuoteTotalsForPdf(q) {
  return calcQuoteTotals(q || {}, isBrokerQuote(q) ? BROKER_MARKUP : undefined);
}

function getGroupPriceForPdf(li, rushRate, extras, isBroker, allLineItems) {
  const markup = isBroker ? BROKER_MARKUP : STANDARD_MARKUP;
  const linkedQtyMap = buildLinkedQtyMap(allLineItems || []);
  return calcLinkedLinePrice(li, rushRate, extras, markup, linkedQtyMap);
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
  if (titleTail && !isLikelySku(titleTail) && looksLikeCode(titleTail)) return titleTail;

  const resolvedTitleTail = extractTrailingGarmentNumber(li?.resolvedTitle);
  if (resolvedTitleTail && !isLikelySku(resolvedTitleTail) && looksLikeCode(resolvedTitleTail)) return resolvedTitleTail;

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
  const pdfLineTotals = [];

  lineItems.forEach((li) => {
    if (yPos > pageHeight - 60) {
      doc.addPage();
      yPos = margin;
    }

    const qty = getQty(li);
    const r = getGroupPriceForPdf(li, rushRate, extras, isBroker, lineItems);
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

    // Use saved per-line pricing when available; fall back to calc for legacy
    const override = Number(li?.clientPpp);
    const useLineOverride = Number.isFinite(override) && override > 0 && qty > 0;
    const avgPpp = useLineOverride ? override : (li._ppp != null ? li._ppp : (r ? r.ppp : 0));
    const lineTotal = useLineOverride ? override * qty : (li._lineTotal != null ? li._lineTotal : avgPpp * qty);

    if (r || lineTotal > 0) {
      doc.setFontSize(9);
      doc.setTextColor(67, 56, 202);
      doc.text(fmtMoney(lineTotal), pageWidth - margin - 2, yPos, {
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
        // Per-piece: same avgPpp used for line total above
        activeSizes.forEach((sz) => {
          xPos += colW;
          const price = avgPpp;
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


    pdfLineTotals.push(lineTotal);
    yPos += 8;
  });

  return { yPos, pdfLineTotals };
}

function renderTotals(doc, totals, discount, taxRate, _depositPct, pageWidth, margin, yPos, isClientMode = false, discountType = 'percent', rushRate = 0, pdfSubtotal = null) {
  doc.setDrawColor(180, 180, 200);
  doc.setLineWidth(0.4);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 6;

  const rr = parseFloat(rushRate) || 0;
  // Always use calcQuoteTotals values — one source of truth for all views
  const subWithoutRush = totals.subtotal ?? totals.sub;
  const rushAmount = totals.rushTotal ?? 0;

  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 120);
  doc.text('Subtotal:', margin, yPos);
  doc.setTextColor(30, 30, 40);
  doc.text(fmtMoney(subWithoutRush), pageWidth - margin - 2, yPos, { align: 'right' });
  yPos += 5;

  if (rr > 0) {
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(200, 100, 20);
    doc.text(`Rush Fee (${Math.round(rr * 100)}%):`, margin, yPos);
    doc.setFont(undefined, 'bold');
    doc.text(fmtMoney(rushAmount), pageWidth - margin - 2, yPos, { align: 'right' });
    yPos += 5;
  }

  const discVal = parseFloat(discount) || 0;
  const isFlatDisc = discountType === 'flat' || (discVal > 100 && discountType !== 'percent');

  if (discVal > 0) {
    const discountAmount = totals.sub - totals.afterDisc;

    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(16, 160, 100);
    doc.text(isFlatDisc ? `Discount (${moneyNoWeirdMinus(discVal)}):` : `Discount (${discount}%):`, margin, yPos);

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

  const jsPDF = await loadJsPDF();
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;

  // Broker shop form  = broker pays shop at BROKER_MARKUP
  // Broker client form = broker charges client at STANDARD_MARKUP
  // Admin (non-broker) quote = always STANDARD_MARKUP
  const hasBroker = isBrokerQuote(quote);
  const pdfMarkup = hasBroker && !isClientMode ? BROKER_MARKUP : STANDARD_MARKUP;
  const totals = calcQuoteTotals(quote, pdfMarkup);
  // If saved totals exist and we're using standard markup, prefer them
  // so the PDF always matches the quote detail view exactly.
  if (!hasBroker && quote.total != null) {
    totals.sub = Number(quote.subtotal || totals.sub);
    totals.subtotal = totals.sub - (totals.rushTotal || 0);
    totals.tax = Number(quote.tax ?? totals.tax);
    totals.total = Number(quote.total);
    totals.afterDisc = totals.total - totals.tax;
  }
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
  let quotePdfLineTotals = [];
  if (quote.line_items && quote.line_items.length > 0) {
    const liResult = renderLineItems(
      doc,
      quote.line_items,
      quote.rush_rate,
      quote.extras,
      quote.discount,
      effectiveTaxRate,
      pageHeight,
      margin,
      yPos,
      hasBroker && !isClientMode,
      isClientMode,
      scale,
      quoteDiscType
    );
    yPos = liResult.yPos;
    quotePdfLineTotals = liResult.pdfLineTotals;
  }

  // Notes: only show in shop mode
  if (!isClientMode && quote.notes) {
    doc.setFontSize(8);
    const noteLines = doc.splitTextToSize(quote.notes, pageWidth - 2 * margin - 8);
    const noteH = noteLines.length * 4.5 + 8;

    // If notes don't fit on this page, start a new page
    if (yPos + noteH > pageHeight - 20) {
      doc.addPage();
      yPos = margin;
    }

    // If notes are taller than a full page, split across pages
    const maxLinesPerPage = Math.floor((pageHeight - yPos - 20) / 4.5);

    if (noteLines.length <= maxLinesPerPage) {
      doc.setFillColor(255, 248, 220);
      doc.rect(margin, yPos - 2, pageWidth - 2 * margin, noteH, 'F');
      doc.setFont(undefined, 'bold');
      doc.setTextColor(120, 80, 20);
      doc.text('Notes:', margin + 3, yPos + 2);
      doc.setFont(undefined, 'normal');
      doc.text(noteLines, margin + 3, yPos + 7);
      yPos += noteH + 4;
    } else {
      // Multi-page notes
      let remaining = [...noteLines];
      let isFirst = true;
      while (remaining.length > 0) {
        const available = Math.floor((pageHeight - yPos - 20) / 4.5);
        const batch = remaining.splice(0, Math.max(1, available));
        const batchH = batch.length * 4.5 + (isFirst ? 8 : 4);

        doc.setFillColor(255, 248, 220);
        doc.rect(margin, yPos - 2, pageWidth - 2 * margin, batchH, 'F');
        doc.setFontSize(8);
        doc.setTextColor(120, 80, 20);

        if (isFirst) {
          doc.setFont(undefined, 'bold');
          doc.text('Notes:', margin + 3, yPos + 2);
          doc.setFont(undefined, 'normal');
          doc.text(batch, margin + 3, yPos + 7);
        } else {
          doc.setFont(undefined, 'normal');
          doc.text(batch, margin + 3, yPos + 2);
        }

        yPos += batchH + 2;
        isFirst = false;

        if (remaining.length > 0) {
          doc.addPage();
          yPos = margin;
        }
      }
      yPos += 2;
    }
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
    quoteDiscType,
    parseFloat(quote.rush_rate) || 0,
    quotePdfLineTotals.length > 0 ? quotePdfLineTotals.reduce((s, v) => s + v, 0) : null
  );

  const fileId = quote.quote_id || 'quote';
  const fileName = isClientMode ? `Quote-Client-${fileId}.pdf` : `Quote-Shop-${fileId}.pdf`;
  if (output === 'base64') {
    const raw = doc.output('datauristring');
    return raw.split(',')[1];
  }
  if (output === 'blob') {
    const blob = doc.output('blob');
    return URL.createObjectURL(blob);
  }
  doc.save(fileName);
  return null;
}

export async function exportOrderToPDF(order, shopName, logoUrl, output) {
  const jsPDF = await loadJsPDF();
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

  let orderPdfLineTotals = [];
  if (order.line_items && order.line_items.length > 0) {
    const liResult = renderLineItems(
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
    yPos = liResult.yPos;
    orderPdfLineTotals = liResult.pdfLineTotals;
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
      orderDiscType,
      parseFloat(order.rush_rate) || 0,
      orderPdfLineTotals.length > 0 ? orderPdfLineTotals.reduce((s, v) => s + v, 0) : null
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

  if (output === 'blob') {
    const blob = doc.output('blob');
    return URL.createObjectURL(blob);
  }
  doc.save(`Order-${order.order_id}.pdf`);
}

// QB-style invoice layout — clean tabular DESCRIPTION/QTY/RATE/AMOUNT rows
// instead of the colored-bar-per-size layout. Accepts an options object so
// the caller can pass full shop profile info (address, phone, email, website).
//
//   exportInvoiceToPDF(invoice, customer, { shop, output })
//
// Backward-compat: if `shopOrOptions` is a string, treat it as legacy
// `shopName` (callers haven't all been updated yet).
export async function exportInvoiceToPDF(invoice, customer, shopOrOptions, logoUrl, output) {
  const jsPDF = await loadJsPDF();
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;

  // Normalize args: support both { shop, output } object and legacy positional.
  let shop = {};
  if (shopOrOptions && typeof shopOrOptions === 'object') {
    shop   = shopOrOptions.shop   || {};
    output = shopOrOptions.output || output;
    logoUrl = shopOrOptions.logoUrl || logoUrl;
  } else if (typeof shopOrOptions === 'string') {
    shop = { shop_name: shopOrOptions };
  }

  // ── Header: shop info top-left ────────────────────────────────────────────
  let yPos = margin;
  doc.setFont(undefined, 'bold');
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 30);
  doc.text(shop.shop_name || 'InkTracker', margin, yPos);
  yPos += 5;

  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 80);
  const shopLines = [];
  if (shop.address) shopLines.push(shop.address);
  const cityLine = [shop.city, shop.state, shop.zip].filter(Boolean).join(shop.state ? ', ' : ' ').replace(', ', ', ');
  const cityStateZip = [shop.city && `${shop.city},`, shop.state, shop.zip].filter(Boolean).join(' ');
  if (cityStateZip) shopLines.push(cityStateZip);
  if (shop.phone)   shopLines.push(shop.phone);
  if (shop.email)   shopLines.push(shop.email);
  if (shop.website) shopLines.push(shop.website);
  shopLines.forEach((l) => { doc.text(l, margin, yPos); yPos += 4.5; });
  // unused var for linter (cityLine kept above for explicitness)
  void cityLine;

  // ── "INVOICE" title ──────────────────────────────────────────────────────
  yPos += 6;
  doc.setFontSize(20);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(20, 20, 30);
  doc.text('INVOICE', margin, yPos);
  yPos += 8;

  // ── Bill To (left) | Invoice meta (right) ────────────────────────────────
  const metaX = pageWidth - margin - 60;
  const labelColor = [110, 110, 130];
  const valueColor = [30, 30, 40];

  const billLabelY = yPos;
  doc.setFontSize(8);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(...labelColor);
  doc.text('BILL TO', margin, billLabelY);
  doc.text('INVOICE #', metaX, billLabelY);
  doc.setTextColor(...valueColor);
  doc.setFontSize(9);
  doc.text(String(invoice.invoice_id || ''), metaX + 25, billLabelY);

  yPos += 5;
  doc.setFontSize(9.5);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(...valueColor);
  const billLines = [];
  if (customer?.company) billLines.push(customer.company);
  if (customer?.name && customer?.name !== customer?.company) billLines.push(customer.name);
  if (customer?.address) billLines.push(customer.address);
  const custCity = [customer?.city && `${customer.city},`, customer?.state, customer?.zip].filter(Boolean).join(' ');
  if (custCity) billLines.push(custCity);
  if (customer?.email) billLines.push(customer.email);
  if (!billLines.length) billLines.push(invoice.customer_name || '—');

  let billY = yPos;
  billLines.forEach((l) => {
    const wrapped = doc.splitTextToSize(l, 80);
    wrapped.forEach((w) => { doc.text(w, margin, billY); billY += 4.5; });
  });

  // Right-side meta: DATE, TERMS, DUE
  let mY = yPos;
  doc.setFontSize(8);
  doc.setTextColor(...labelColor);
  doc.text('DATE', metaX, mY);
  doc.setFontSize(9);
  doc.setTextColor(...valueColor);
  doc.text(fmtDate(invoice.date), metaX + 25, mY);
  mY += 5;

  if (invoice.due) {
    doc.setFontSize(8);
    doc.setTextColor(...labelColor);
    doc.text('DUE', metaX, mY);
    doc.setFontSize(9);
    doc.setTextColor(...valueColor);
    doc.text(fmtDate(invoice.due), metaX + 25, mY);
    mY += 5;
  }

  doc.setFontSize(8);
  doc.setTextColor(...labelColor);
  doc.text('TERMS', metaX, mY);
  doc.setFontSize(9);
  doc.setTextColor(...valueColor);
  doc.text(invoice.terms || 'Due on receipt', metaX + 25, mY);
  mY += 5;

  yPos = Math.max(billY, mY) + 4;

  // Divider
  doc.setDrawColor(180, 180, 200);
  doc.setLineWidth(0.4);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 8;

  // ── Line items table ─────────────────────────────────────────────────────
  // Columns:  DESCRIPTION (flex)  QTY (right)  RATE (right)  AMOUNT (right)
  const colQtyX    = pageWidth - margin - 80;
  const colRateX   = pageWidth - margin - 45;
  const colAmtX    = pageWidth - margin;

  // Header row with subtle background
  doc.setFillColor(238, 238, 244);
  doc.rect(margin, yPos - 4, pageWidth - 2 * margin, 7, 'F');
  doc.setFontSize(8);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(80, 80, 100);
  doc.text('DESCRIPTION', margin + 2, yPos);
  doc.text('QTY',  colQtyX,  yPos, { align: 'right' });
  doc.text('RATE', colRateX, yPos, { align: 'right' });
  doc.text('AMOUNT', colAmtX, yPos, { align: 'right' });
  yPos += 7;

  doc.setFont(undefined, 'normal');
  const items = Array.isArray(invoice.line_items) ? invoice.line_items : [];
  let lineSubtotal = 0;

  items.forEach((li) => {
    if (yPos > pageHeight - 60) { doc.addPage(); yPos = margin; }

    const qty = getQty(li) || Number(li?.qty) || 0;
    const override = Number(li?.clientPpp);
    const useOverride = Number.isFinite(override) && override > 0 && qty > 0;
    const rate = useOverride ? override : (li._ppp != null ? li._ppp : 0);
    const amount = useOverride ? override * qty : (li._lineTotal != null ? li._lineTotal : rate * qty);
    lineSubtotal += amount;

    const headerLine = getItemHeaderLine(li);
    const metaLine   = getItemMetaLine(li);

    // Description: bold first line + (optional) muted second line, wrapped to col width
    const descMaxWidth = colQtyX - margin - 6;
    doc.setFont(undefined, 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(30, 30, 40);
    const headerWrapped = doc.splitTextToSize(headerLine || 'Line item', descMaxWidth);
    headerWrapped.forEach((w) => { doc.text(w, margin + 2, yPos); yPos += 4.5; });

    if (metaLine) {
      doc.setFont(undefined, 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(95, 95, 115);
      const metaWrapped = doc.splitTextToSize(metaLine, descMaxWidth);
      metaWrapped.forEach((w) => { doc.text(w, margin + 2, yPos); yPos += 4 });
    }

    // QTY / RATE / AMOUNT (top-aligned with description's first row)
    const numbersY = yPos - (metaLine ? 4 + 4.5 * headerWrapped.length : 4.5 * headerWrapped.length) + 4.5;
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(30, 30, 40);
    doc.text(qty ? String(qty) : '—', colQtyX, numbersY, { align: 'right' });
    doc.text(qty ? fmtMoney(rate) : '—', colRateX, numbersY, { align: 'right' });
    doc.text(fmtMoney(amount), colAmtX, numbersY, { align: 'right' });

    yPos += 4; // breathing room between rows
  });

  // Bottom dotted line above totals
  yPos += 2;
  doc.setLineDashPattern([0.6, 0.6], 0);
  doc.setDrawColor(180, 180, 200);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  doc.setLineDashPattern([], 0);
  yPos += 6;

  // ── Totals (right-aligned column) ────────────────────────────────────────
  const taxRate = Number(invoice.tax_rate) || 0;
  const subtotal = Number(invoice.subtotal) || lineSubtotal;
  const tax = Number(invoice.tax) || 0;
  const total = Number(invoice.total) || (subtotal + tax);
  const balanceDue = invoice.paid ? 0 : total;

  const tLabelX = pageWidth - margin - 50;
  const tValueX = pageWidth - margin;

  const totalsRow = (label, value, opts = {}) => {
    if (yPos > pageHeight - 30) { doc.addPage(); yPos = margin; }
    doc.setFontSize(opts.fontSize || 9);
    doc.setFont(undefined, opts.bold ? 'bold' : 'normal');
    doc.setTextColor(...(opts.color || valueColor));
    doc.text(label, tLabelX, yPos, { align: 'right' });
    doc.text(value, tValueX, yPos, { align: 'right' });
    yPos += opts.gap || 5.5;
  };

  totalsRow('SUBTOTAL', fmtMoney(subtotal));
  totalsRow(`TAX (${taxRate}%)`, fmtMoney(tax));
  totalsRow('TOTAL', fmtMoney(total));

  // Balance due — bigger, bold
  yPos += 1;
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(20, 20, 30);
  doc.text('BALANCE DUE', tLabelX, yPos, { align: 'right' });
  doc.text(fmtMoney(balanceDue), tValueX, yPos, { align: 'right' });
  yPos += 8;

  // ── Pay invoice button (left, if we have a payment link) ─────────────────
  if (invoice.qb_payment_link || invoice.payment_link) {
    const link = invoice.qb_payment_link || invoice.payment_link;
    const btnY = yPos - 22;
    const btnX = margin;
    const btnW = 36;
    const btnH = 9;
    doc.setDrawColor(140, 140, 160);
    doc.setLineWidth(0.4);
    doc.roundedRect(btnX, btnY, btnW, btnH, 1.5, 1.5);
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(40, 40, 60);
    doc.textWithLink('Pay invoice', btnX + btnW / 2, btnY + 6, { align: 'center', url: link });
  }

  // ── Notes ────────────────────────────────────────────────────────────────
  if (invoice.notes) {
    yPos += 4;
    if (yPos > pageHeight - 30) { doc.addPage(); yPos = margin; }
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(120, 80, 20);
    doc.text('Notes', margin, yPos);
    yPos += 4;
    doc.setFont(undefined, 'normal');
    doc.setTextColor(60, 60, 80);
    const noteLines = doc.splitTextToSize(invoice.notes, pageWidth - 2 * margin);
    noteLines.forEach((l) => { doc.text(l, margin, yPos); yPos += 4 });
  }

  // ── Footer disclaimer ────────────────────────────────────────────────────
  doc.setFontSize(8);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(120, 120, 140);
  const disclaimer = 'Special printing aids are not being sold to the customer as part of the sale of the printed matter, and the selling price of the printed matter does not include the transfer of title to the special printing aids.';
  const discWrapped = doc.splitTextToSize(disclaimer, pageWidth - 2 * margin);
  let discY = pageHeight - margin - discWrapped.length * 3.5;
  if (yPos > discY - 4) discY = yPos + 6;
  discWrapped.forEach((l) => { doc.text(l, margin, discY); discY += 3.5 });

  if (output === 'base64') {
    const raw = doc.output('datauristring');
    return raw.split(',')[1];
  }
  if (output === 'blob') {
    const blob = doc.output('blob');
    return URL.createObjectURL(blob);
  }
  doc.save(`Invoice-${invoice.invoice_id}.pdf`);
  return null;
}