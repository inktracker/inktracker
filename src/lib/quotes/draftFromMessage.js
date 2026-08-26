// Map a draftQuoteFromMessage response onto quote-editor state.
//
// Pure: takes the previous editor quote + the function response, returns
// { quote, panel }. The PANEL (assumptions / blanks / per-line garment
// candidates) is React state only — it must never ride on the quote
// object, or it would be persisted into the saved row.
//
// Pricing contract: this file sets NO prices. Lines land with style
// numbers; the editor's own autoLookup + the pricing engine fill costs
// and totals exactly as if the shop had typed the style by hand.

/**
 * @param {object} prev        current editor quote state
 * @param {object} resp        edge-function response ({ draft, customer, extraction })
 * @param {() => object} newLineItem  the editor's blank-line factory
 * @returns {{ quote: object, panel: { assumptions: string[], blanks: string[],
 *             candidatesByLine: Record<string, Array<object>>, jobTitle: string } }}
 */
export function applyDraftToQuote(prev, resp, newLineItem) {
  const draft = resp?.draft;
  if (!draft?.line_items?.length) {
    throw new Error("Draft response has no line items.");
  }

  const candidatesByLine = {};
  const lines = draft.line_items.map((li, idx) => {
    const blank = newLineItem();
    // Unknown garment with candidates: leave style EMPTY (the shop picks
    // from the panel; picking writes the style and triggers autoLookup).
    // Preselecting the top candidate would look like a decision the
    // customer made — and a wrong silent default is how trust dies.
    if (!li.style_number && li.candidates?.length) {
      candidatesByLine[blank.id ?? String(idx)] = li.candidates;
    }
    return {
      ...blank,
      style: li.style_number || "",
      brand: li.brand || "",
      styleName: li.style_name || "",
      garmentColor: li.garment_color || "",
      sizes: li.sizes || {},
      imprints: (li.imprints || []).map((im, j) => ({
        id: `${blank.id ?? idx}-im${j}`,
        title: im.title || "Artwork",
        location: im.location || "Front",
        colors: Math.max(1, Math.min(8, parseInt(im.colors, 10) || 1)),
        pantones: im.ink || "",
        width: im.width_in || "",
        height: "",
        details: "",
        technique: "Screen Print",
        linked: true,
        extras: {},
        artwork_id: "", artwork_url: "", artwork_name: "", artwork_note: "", artwork_colors: "",
      })),
      // supplier stays whatever the editor resolves at lookup time —
      // never asserted here (same rule as prefillLineItem).
    };
  });

  const onlyBlank =
    prev.line_items?.length === 1 &&
    !prev.line_items[0].style &&
    !prev.line_items[0].brand &&
    Object.keys(prev.line_items[0].sizes || {}).length === 0;

  const quote = {
    ...prev,
    line_items: onlyBlank ? lines : [...(prev.line_items || []), ...lines],
    // Customer: a matched customer (this shop's own record) wins; else
    // extraction seeds name/email for the new-client flow.
    ...(resp.customer?.id
      ? {
          customer_id: resp.customer.id,
          customer_name: resp.customer.name || prev.customer_name || "",
          customer_email: resp.customer.email || prev.customer_email || "",
          ...(resp.customer.company ? { company: resp.customer.company } : {}),
        }
      : {
          ...(!prev.customer_name && resp.extraction?.customer_name
            ? { customer_name: resp.extraction.customer_name } : {}),
          ...(!prev.customer_email && resp.extraction?.customer_email
            ? { customer_email: resp.extraction.customer_email } : {}),
          ...(resp.extraction?.company ? { company: resp.extraction.company } : {}),
        }),
    ...(!prev.job_title && draft.job_title ? { job_title: draft.job_title } : {}),
    ...(draft.due_date ? { due_date: draft.due_date } : {}),
    // notes are CUSTOMER-FACING (QB CustomerMemo!) — only the suggestion
    // written for the customer goes in; assumptions stay in the panel.
    ...(draft.customer_note_suggestion
      ? { notes: [prev.notes, draft.customer_note_suggestion].filter(Boolean).join("\n\n") }
      : {}),
  };

  return {
    quote,
    panel: {
      assumptions: draft.assumptions || [],
      blanks: draft.blanks || [],
      candidatesByLine,
      jobTitle: draft.job_title || "",
    },
  };
}

/**
 * Apply a picked catalog candidate to a line. Sets only identity fields —
 * the editor's autoLookup fetches real costs/colors when style lands.
 */
export function applyCandidateToLine(line, candidate) {
  return {
    ...line,
    style: candidate.style_number || "",
    brand: candidate.brand || "",
    styleName: candidate.style_name || "",
  };
}
