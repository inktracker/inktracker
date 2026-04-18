import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

function fmtMoney(n) {
  return '$' + (parseFloat(String(n)) || 0).toFixed(2);
}

function normalizeStyleNumber(value) {
  return String(value || '').trim().toUpperCase();
}

function sumWarehouseQty(warehouses) {
  return (warehouses || []).reduce(function (sum, warehouse) {
    return sum + (warehouse.qty || 0);
  }, 0);
}

function buildSsLookupResponse(products) {
  var colorMap = {};
  var inventoryMap = {};
  var priceMap = {};

  (products || []).forEach(function (sku) {
    var colorName = sku.colorName || '';
    var sizeName = sku.sizeName || '';
    var piecePrice = Number(sku.piecePrice || 0);
    var casePrice = Number(sku.casePrice || 0);

    if (!colorName) return;

    if (!colorMap[colorName]) {
      colorMap[colorName] = {
        colorName: colorName,
        imageUrl: sku.colorFrontImage || sku.colorImage || '',
      };
    }

    if (!inventoryMap[colorName]) {
      inventoryMap[colorName] = {};
    }

    if (!priceMap[colorName]) {
      priceMap[colorName] = {
        piecePrice: piecePrice,
        casePrice: casePrice,
      };
    }

    inventoryMap[colorName][sizeName] = sumWarehouseQty(sku.warehouses || []);
  });

  var first = products && products.length ? products[0] : {};

  return {
    colors: Object.values(colorMap),
    inventoryMap: inventoryMap,
    priceMap: priceMap,
    piecePrice: Number(first.piecePrice || 0),
    casePrice: Number(first.casePrice || 0),
    brandName: first.brandName || '',
    styleName: first.styleName || '',
    styleNumber: first.partNumber || first.style || first.styleNumber || '',
    title: first.title || '',
  };
}

async function fetchSsJson(url, authHeader) {
  var res = await fetch(url, {
    headers: {
      Authorization: authHeader,
    },
  });

  var text = await res.text();
  var data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = null;
  }

  return {
    ok: res.ok,
    status: res.status,
    text: text,
    data: data,
  };
}

async function resolveStyleIdentifier(rawStyle, authHeader) {
  var normalized = normalizeStyleNumber(rawStyle);
  var encoded = encodeURIComponent(normalized);

  var directAttempts = [
    'https://api.ssactivewear.com/v2/styles/?partnumber=' + encoded + '&mediatype=json',
    'https://api.ssactivewear.com/v2/styles/' + encoded + '?mediatype=json',
    'https://api.ssactivewear.com/v2/styles?search=' + encoded + '&mediatype=json',
  ];

  for (var i = 0; i < directAttempts.length; i++) {
    var result = await fetchSsJson(directAttempts[i], authHeader);

    if (result.ok && Array.isArray(result.data) && result.data.length > 0) {
      // Return ALL matches, not just the first
      return {
        requested: normalized,
        matches: result.data.map(function(item) {
          return {
            partNumber: item.partNumber || String(item.styleID),
            brandName: item.brandName || '',
            styleName: item.styleName || '',
            title: item.title || '',
          };
        }),
      };
    }
  }

  var fallbackMap = {
    G500: 'Gildan 5000',
    G185: 'Gildan 18500',
    G640: 'Gildan 64000',
  };

  var fallbackSearch = fallbackMap[normalized];
  if (fallbackSearch) {
    var fallbackUrl =
      'https://api.ssactivewear.com/v2/styles?search=' +
      encodeURIComponent(fallbackSearch) +
      '&mediatype=json';

    var fallbackResult = await fetchSsJson(fallbackUrl, authHeader);

    if (
      fallbackResult.ok &&
      Array.isArray(fallbackResult.data) &&
      fallbackResult.data.length > 0
    ) {
      // Return ALL fallback matches
      return {
        requested: normalized,
        matches: fallbackResult.data.map(function(item) {
          return {
            partNumber: item.partNumber || String(item.styleID),
            brandName: item.brandName || '',
            styleName: item.styleName || '',
            title: item.title || '',
          };
        }),
      };
    }
  }

  return null;
}

async function lookupSsProducts(styleIdentifier, authHeader) {
  var encoded = encodeURIComponent(styleIdentifier);

  var attempts = [
    'https://api.ssactivewear.com/v2/products/?partnumber=' + encoded + '&mediatype=json',
    'https://api.ssactivewear.com/v2/products/?style=' + encoded + '&mediatype=json',
  ];

  for (var i = 0; i < attempts.length; i++) {
    var result = await fetchSsJson(attempts[i], authHeader);

    if (result.ok && Array.isArray(result.data) && result.data.length > 0) {
      return {
        sourceUrl: attempts[i],
        rows: result.data,
      };
    }
  }

  return null;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nl2br(value) {
  return String(value || '').replace(/\n/g, '<br />');
}

function buildButton(label, href, bgColor) {
  if (!href) return '';

  return `
    <a href="${href}" style="display:inline-block;background-color:${bgColor};color:#fff;padding:15px 28px;text-decoration:none;border-radius:8px;font-weight:700;font-size:16px;">
      ${escapeHtml(label)}
    </a>
  `;
}

function getQty(lineItem) {
  var sizes = lineItem && lineItem.sizes ? lineItem.sizes : {};
  return Object.values(sizes).reduce(function (sum, value) {
    return sum + (parseInt(String(value), 10) || 0);
  }, 0);
}

function buildSizeBreakdownHtml(lineItem) {
  var sizes = lineItem && lineItem.sizes ? lineItem.sizes : {};
  var entries = Object.entries(sizes).filter(function (entry) {
    return (parseInt(String(entry[1]), 10) || 0) > 0;
  });

  if (!entries.length) return '';

  return `
    <div style="margin-top:8px;font-size:12px;color:#64748b;">
      ${entries
        .map(function (entry) {
          return `<span style="display:inline-block;margin-right:10px;">${escapeHtml(entry[0])}: ${escapeHtml(entry[1])}</span>`;
        })
        .join('')}
    </div>
  `;
}

function buildImprintLine(imp) {
  return [
    imp && imp.title ? String(imp.title) : '',
    imp && (imp.location || imp.placement) ? String(imp.location || imp.placement) : '',
    imp && imp.colors
      ? String(imp.colors) + ' color' + (Number(imp.colors) !== 1 ? 's' : '')
      : '',
    imp && imp.technique ? String(imp.technique) : '',
    imp && imp.pantones ? String(imp.pantones) : '',
    imp && imp.details ? String(imp.details) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function buildImprintsHtml(lineItem) {
  var imprints = Array.isArray(lineItem && lineItem.imprints) ? lineItem.imprints : [];
  if (!imprints.length) return '';

  return `
    <div style="margin-top:12px;">
      ${imprints
        .map(function (imp) {
          var imprintLine = buildImprintLine(imp);
          var dimensions = [imp && imp.width ? 'W: ' + imp.width : '', imp && imp.height ? 'H: ' + imp.height : '']
            .filter(Boolean)
            .join(' · ');

          return `
            <div style="margin-top:8px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
              <div style="font-size:13px;font-weight:700;color:#1e293b;">
                ${escapeHtml(imprintLine || 'Imprint')}
              </div>
              ${dimensions ? `<div style="margin-top:4px;font-size:12px;color:#64748b;">${escapeHtml(dimensions)}</div>` : ''}
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

function buildLineItemsHtml(quote) {
  var lineItems = Array.isArray(quote && quote.line_items) ? quote.line_items : [];
  if (!lineItems.length) return '';

  return `
    <div style="margin-top:28px;">
      <div style="font-size:14px;font-weight:800;color:#1e293b;margin-bottom:12px;">Quote Details</div>
      ${lineItems
        .map(function (lineItem) {
          var qty = getQty(lineItem);
          var garmentHeader =
            lineItem.productTitle ||
            lineItem.resolvedTitle ||
            lineItem.styleName ||
            lineItem.description ||
            lineItem.title ||
            lineItem.style ||
            'Garment';

          var garmentMeta = [lineItem.brand ? 'Brand: ' + lineItem.brand : '', lineItem.garmentColor ? 'Color: ' + lineItem.garmentColor : '']
            .filter(Boolean)
            .join(' · ');

          return `
            <div style="margin-bottom:16px;padding:16px;border:1px solid #e2e8f0;border-radius:10px;background:#ffffff;">
              <div style="font-size:14px;font-weight:700;color:#0f172a;">
                ${escapeHtml(garmentHeader)}
              </div>
              ${
                garmentMeta
                  ? `<div style="margin-top:4px;font-size:12px;color:#64748b;">${escapeHtml(garmentMeta)}</div>`
                  : ''
              }
              <div style="margin-top:6px;font-size:12px;color:#475569;">Qty: ${qty}</div>
              ${buildSizeBreakdownHtml(lineItem)}
              ${buildImprintsHtml(lineItem)}
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

Deno.serve(async (req) => {
  try {
    var base44 = createClientFromRequest(req);
    var body = await req.json();

    if (body.action === 'ss_lookup') {
      var rawStyleNumber = normalizeStyleNumber(body.styleNumber);

      if (!rawStyleNumber) {
        return Response.json(
          { error: 'Missing styleNumber' },
          { status: 400 }
        );
      }

      var ssAccount = Deno.env.get('SS_ACCOUNT');
      var ssApiKey = Deno.env.get('SS_API_KEY');

      if (!ssAccount || !ssApiKey) {
        return Response.json(
          { error: 'Missing S&S credentials. Set SS_ACCOUNT and SS_API_KEY.' },
          { status: 500 }
        );
      }

      var authHeader = 'Basic ' + btoa(ssAccount + ':' + ssApiKey);

      var resolvedStyle = await resolveStyleIdentifier(rawStyleNumber, authHeader);

      if (!resolvedStyle || !resolvedStyle.matches || resolvedStyle.matches.length === 0) {
        return Response.json(
          {
            error: 'Style not found on S&S.',
            searched: rawStyleNumber,
          },
          { status: 404 }
        );
      }

      // Fetch products for each match and return them as separate options
      var allMatches = [];
      for (var j = 0; j < resolvedStyle.matches.length; j++) {
        var match = resolvedStyle.matches[j];
        var found = await lookupSsProducts(match.partNumber, authHeader);
        
        if (found && found.rows && found.rows.length > 0) {
          allMatches.push({
            styleIdentifier: match.partNumber,
            brandName: match.brandName,
            styleName: match.styleName,
            title: match.title,
            response: buildSsLookupResponse(found.rows),
          });
        }
      }

      if (allMatches.length === 0) {
        return Response.json(
          {
            error: 'Resolved style(s), but no product rows were returned.',
            searched: rawStyleNumber,
          },
          { status: 404 }
        );
      }

      // Return multiple matches for frontend to display
      return Response.json({
        matches: allMatches.map(function(m) {
          return Object.assign({}, m.response, {
            styleIdentifier: m.styleIdentifier,
            brandName: m.brandName,
            styleName: m.styleName,
            resolvedTitle: m.title,
          });
        }),
        requestedStyleNumber: rawStyleNumber,
      });
    }

    var customerEmails = body.customerEmails;
    var customerName = body.customerName;
    var quoteId = body.quoteId;
    var quoteTotal = body.quoteTotal;
    var paymentLink = body.paymentLink;
    var approveLink = body.approveLink || body.reviewLink || body.quoteLink || '';
    var shopNameParam = body.shopName;
    var subject = body.subject;
    var customMessage = body.body || body.message || '';
    var brokerName = body.brokerName || '';
    var brokerEmail = body.brokerEmail || '';

    // Support both single email (legacy) and multiple emails
    if (!Array.isArray(customerEmails)) {
      customerEmails = body.customerEmail ? [body.customerEmail] : [];
    }

    if (!customerEmails || customerEmails.length === 0 || !quoteId || (!paymentLink && !approveLink)) {
      return Response.json(
        {
          error:
            'Missing required fields: customerEmails, quoteId, and at least one of paymentLink or approveLink',
        },
        { status: 400 }
      );
    }

    var connection = await base44.asServiceRole.connectors.getConnection('gmail');
    var accessToken = connection.accessToken;
    var senderEmail = connection.email || '';

    var resolvedShopName = shopNameParam || '';
    var matchedQuote = null;

    try {
      var allQuotes = await base44.asServiceRole.entities.Quote.list();
      matchedQuote = (allQuotes || []).find(q => q && (q.quote_id === quoteId || q.id === quoteId)) || null;

      // Resolve shop name from the Shop entity via quote's shop_owner
      if (!resolvedShopName && matchedQuote && matchedQuote.shop_owner) {
        var shops = await base44.asServiceRole.entities.Shop.filter({ owner_email: matchedQuote.shop_owner });
        if (shops && shops[0] && shops[0].shop_name) {
          resolvedShopName = shops[0].shop_name;
        }
      }
    } catch (e) {
      console.error('Failed to load quote/shop details for email:', e);
    }

    // Fallback: try logged-in user's shop_name
    if (!resolvedShopName) {
      try {
        var user = await base44.auth.me();
        if (user && user.shop_name) resolvedShopName = user.shop_name;
      } catch (e) {}
    }

    if (!resolvedShopName) {
      resolvedShopName = 'Biota MFG';
    }

    var totalFormatted = fmtMoney(quoteTotal);
    var safeCustomerName = escapeHtml(customerName || 'there');
    var safeShopName = escapeHtml(resolvedShopName);
    var safeQuoteId = escapeHtml(quoteId);

    var primaryLink = paymentLink || approveLink;
    var primaryButtonHtml = buildButton(
      'Approve & Pay Quote',
      primaryLink,
      '#4338ca'
    );

    var introHtml = customMessage
      ? `<p style="margin:0 0 28px;font-size:15px;color:#475569;">${nl2br(escapeHtml(customMessage))}</p>`
      : `<p style="margin:0 0 28px;font-size:15px;color:#475569;">Your quote from <strong>${safeShopName}</strong> is ready.</p>`;

    var quoteDetailsHtml = matchedQuote ? buildLineItemsHtml(matchedQuote) : '';

    var htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;color:#333;line-height:1.6;margin:0;padding:0;background:#f8fafc;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#1e293b;padding:28px 32px;">
      <div style="color:#94a3b8;font-size:13px;">${safeShopName}</div>
    </div>

    <div style="padding:36px 32px;">
      ${introHtml}

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px 24px;margin-bottom:32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:13px;color:#64748b;">Quote Number</td>
            <td style="font-size:13px;font-weight:700;color:#1e293b;text-align:right;">#${safeQuoteId}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#64748b;padding-top:8px;">Total Amount</td>
            <td style="font-size:22px;font-weight:900;color:#4338ca;text-align:right;padding-top:6px;">${totalFormatted}</td>
          </tr>
        </table>
      </div>

      ${quoteDetailsHtml}

      <div style="text-align:center;margin-top:28px;">
        ${primaryButtonHtml}
      </div>
    </div>

    <div style="background:#f1f5f9;padding:16px 32px;text-align:center;">
      <p style="font-size:11px;color:#94a3b8;margin:0;">This is an automated message from ${safeShopName}. Please do not reply directly to this email.</p>
    </div>
  </div>
</body>
</html>`;

    var emailSubject =
      subject || `Your Quote from ${resolvedShopName} - Quote #${quoteId}`;

    // Send to each recipient
    for (var i = 0; i < customerEmails.length; i++) {
      var recipientEmail = customerEmails[i];
      
      var rawHeaders = [
        `To: ${recipientEmail}`,
        `Subject: ${emailSubject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset="UTF-8"',
      ];

      if (senderEmail) {
        var fromName = brokerName ? brokerName : resolvedShopName;
        rawHeaders.unshift(`From: ${fromName} <${senderEmail}>`);
      }

      if (brokerEmail) {
        var replyToDisplay = brokerName ? `${brokerName} <${brokerEmail}>` : brokerEmail;
        rawHeaders.push(`Reply-To: ${replyToDisplay}`);
      }

      var rawMessage = rawHeaders.concat(['', htmlBody]).join('\r\n');

      var encoded = btoa(unescape(encodeURIComponent(rawMessage)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

      var gmailRes = await fetch(
        'https://www.googleapis.com/gmail/v1/users/me/messages/send',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + accessToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ raw: encoded }),
        }
      );

      if (!gmailRes.ok) {
        var errText = await gmailRes.text();
        console.error('Gmail API error for ' + recipientEmail + ':', gmailRes.status, errText);
        throw new Error('Gmail API error ' + gmailRes.status + ': ' + errText);
      }
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error(
      'sendQuoteEmail error:',
      error && error.message ? error.message : error
    );

    return Response.json(
      { error: error && error.message ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
});