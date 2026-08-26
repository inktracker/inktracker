// Pure logic for draftQuoteFromMessage — the AI quote-draft pipeline.
//
// Everything that makes a DECISION lives here, where vitest can reach it
// (edge-function bodies are ~0% covered; that's where the approveArtwork
// leak hid). The handler in draftQuoteFromMessage/index.ts only does I/O:
// auth, DB reads, the two model calls, catalog fetches.
//
// Design contract (the reason this exists at all):
//   THE MODEL NEVER PRICES ANYTHING. It translates a messy customer
//   message into structured intent; the shop's real pricing engine — on
//   the client, in the real editor — does every dollar. A wrong
//   extraction produces a visibly wrong DRAFT the shop edits; it can
//   never produce a quietly wrong price.
//
// Predecessor: emailScanner's parseOnly (Gemini 2.5 Flash, no context).
// Hidden 2026-06-02 for misclassifying. What it lacked wasn't model
// quality so much as CONTEXT — no customer history ("the same as last
// time" was unanswerable), no catalog ("some hoodies" had no path to a
// style number). Both are first-class here.

// ── Model routing ─────────────────────────────────────────────────────
// Extraction is cheap classification — Haiku. Drafting reasons over
// history + catalog — Sonnet. Overridable via env for cost/quality tuning
// without a redeploy.
export const EXTRACT_MODEL_DEFAULT = "claude-haiku-4-5-20251001";
export const DRAFT_MODEL_DEFAULT = "claude-sonnet-5";

// ── Pass 1: extraction ────────────────────────────────────────────────

export const EXTRACTION_TOOL = {
  name: "record_extraction",
  description: "Record the structured reading of a customer's message to a print shop.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      is_quote_request: { type: "boolean", description: "Is this asking for printed/embroidered goods (vs a status question, invoice question, etc.)?" },
      customer_name: { type: "string", description: "Person's name, from signature or self-introduction. Empty if absent." },
      company: { type: "string", description: "Company name if stated. Empty if absent." },
      customer_email: { type: "string", description: "Email address if visible in the text. Empty if absent." },
      phone: { type: "string" },
      references_past_order: { type: "boolean", description: "True if they mention a previous order, reorder, 'same as last time', a change to prior art, etc." },
      deadline_text: { type: "string", description: "Verbatim deadline language ('by the 15th', 'need them for the tournament June 3'). Empty if none." },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            description: { type: "string", description: "The item as the customer described it, verbatim-ish." },
            style_number: { type: "string", description: "Explicit style/SKU if given (e.g. 'TT41', 'Gildan 5000'). Empty otherwise." },
            color: { type: "string", description: "Garment color if stated. Empty otherwise." },
            quantity_text: { type: "string", description: "Verbatim quantity/size language ('15 M, 15 L, 10 XL', 'about 50')." },
          },
          required: ["description", "style_number", "color", "quantity_text"],
        },
      },
      print_text: { type: "string", description: "Everything said about decoration: logos, locations, colors, art changes. Verbatim-ish. Empty if nothing." },
      other_notes: { type: "string", description: "Anything else the shop should see (delivery, budget, event context)." },
    },
    required: ["is_quote_request", "customer_name", "company", "customer_email", "references_past_order", "deadline_text", "items", "print_text"],
  },
};

export function buildExtractionPrompt(message) {
  return [
    "You are reading correspondence involving a screen-printing / embroidery shop.",
    "Record what is being quoted using the record_extraction tool. Rules:",
    "- The message may be FROM the customer (a request) OR FROM the shop (an offer",
    "  describing garments and prices to a customer). BOTH count as quote requests —",
    "  the shop wants a quote drafted from either direction of the conversation.",
    "- Copy the message's own words into the *_text fields; do not paraphrase away detail.",
    "- Do NOT invent quantities, colors, or products that are not in the text.",
    "- MINE PRODUCT URLS: supplier links encode the garment. e.g.",
    "  ssactivewear.com/p/lane_seven/ls16005?color=pigment_white → brand 'Lane Seven',",
    "  style 'LS16005', color 'Pigment White'. Record them as an item.",
    "- An item with no quantity is STILL an item — leave quantity_text empty.",
    "- A BARE LIST of garments/quantities/sizes with no prose around it IS a quote",
    "  request — shops paste raw size runs all the time. is_quote_request=true.",
    "- A size/quantity block with NO garment name attached is still an item:",
    "  description 'Unspecified garment'. The shop will resolve which garment.",
    "- If a price is stated ('$15/pc', 'you'd be looking at $15 each'), record it",
    "  VERBATIM in other_notes prefixed 'STATED PRICE:'. Never drop it.",
    "- 'Dry-fit', 'performance', 'moisture-wicking' describe a garment type, not a color.",
    "",
    "MESSAGE:",
    message,
  ].join("\n");
}

// ── Context: customer history summary ────────────────────────────────
// Compressed, token-frugal view of past orders the drafter can match
// against ("both colors" → the two tee colors from June).

export function summarizeHistory(orders) {
  if (!orders?.length) return "";
  const parts = [];
  for (const o of orders.slice(0, 3)) {
    const lines = (o.line_items || []).map((li) => {
      const qty = Object.values(li.sizes || {}).reduce((s, v) => s + (parseInt(v) || 0), 0);
      const imps = (li.imprints || [])
        .map((im) => `${im.location}: "${im.title}" ${im.colors}c ${im.pantones || ""}`.trim())
        .join("; ");
      return `  - ${li.brand || ""} ${li.style || ""} "${li.styleName || ""}" color=${li.garmentColor || "?"} qty=${qty} sizes=${JSON.stringify(li.sizes || {})}${imps ? ` prints=[${imps}]` : ""}`;
    });
    parts.push(`ORDER ${o.order_id} (${o.completed_date || o.created_at || ""}):\n${lines.join("\n")}`);
  }
  return parts.join("\n");
}

// ── Pass 2: drafting ─────────────────────────────────────────────────

export const DRAFT_TOOL = {
  name: "record_draft",
  description: "Record a draft quote for the shop to review. Never invent facts the message or history doesn't support.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      job_title: { type: "string", description: "Short internal job name, e.g. 'Crew Gear Reorder'." },
      line_items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            style_number: { type: "string", description: "Concrete style (from message or history). Empty string if unknown → catalog pick needed." },
            brand: { type: "string" },
            style_name: { type: "string" },
            garment_color: { type: "string", description: "Empty if the customer didn't specify and history doesn't imply one." },
            sizes: {
              type: "array",
              description: "EVERY explicitly stated size/quantity MUST appear here, copied exactly ('6 small' → {size:'S', qty:6}). Empty ONLY when the message truly gives no split — then put the total in total_qty.",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  size: { type: "string", description: "S, M, L, XL, 2XL, YS, YM…" },
                  qty: { type: "integer" },
                },
                required: ["size", "qty"],
              },
            },
            total_qty: { type: "integer", description: "Total pieces when a size split wasn't given. 0 when sizes{} is filled in." },
            catalog_search: { type: "string", description: "When style_number is empty: 2-3 CONCRETE product words for a supplier catalog search (e.g. 'pullover hoodie', 'performance tee'). No quality adjectives — 'mid-range', 'nice', 'cheap' break the search. Empty otherwise." },
            imprints: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  location: { type: "string", enum: ["Front", "Back", "Left Chest", "Right Chest", "Left Sleeve", "Right Sleeve", "Pocket", "Hood", "Other"] },
                  title: { type: "string", description: "Art name, e.g. 'Company logo'. Note art CHANGES here, e.g. 'Logo (no license number)'." },
                  colors: { type: "integer", description: "Ink color count ONLY if the customer stated it or history establishes it for this same art. Otherwise 1 and list a blank." },
                  ink: { type: "string", description: "Ink color if known, e.g. 'Black Ink'. Empty otherwise." },
                  width_in: { type: "string", description: "Width in inches if known. Empty otherwise." },
                },
                required: ["location", "title", "colors"],
              },
            },
          },
          required: ["style_number", "brand", "style_name", "garment_color", "sizes", "total_qty", "catalog_search", "imprints"],
        },
      },
      due_date: { type: "string", description: "ISO date resolved from deadline language, relative to TODAY given in the prompt. Empty if none stated." },
      assumptions: {
        type: "array", items: { type: "string" },
        description: "Every leap you made, one sentence each, shop-readable. 'Both colors = Light Steel + Black, matching order ORD-…'.",
      },
      blanks: {
        type: "array", items: { type: "string" },
        description: "What the shop MUST resolve before sending: unknown garment, unstated ink color count, missing size split. Phrase as questions.",
      },
      customer_note_suggestion: { type: "string", description: "One short customer-facing sentence for the quote notes, or empty. No internal reasoning." },
    },
    required: ["job_title", "line_items", "assumptions", "blanks"],
  },
};

export function buildDraftPrompt({ extraction, historyText, todayISO, shopPriorsText }) {
  const parts = [
    "You draft quotes for a screen-printing shop. Turn the extracted request below into a draft the shop will review in their editor.",
    "",
    "HARD RULES:",
    "- NEVER invent quantities, garments, colors, or print specs. Unknowns become blanks[], not guesses.",
    "- When the message states a size breakdown, copy it into sizes[] EXACTLY and set",
    "  total_qty to 0. Losing a stated size split is a hard failure.",
    "- A stated total ('50 Mai Tai Shirt') DIRECTLY followed by its own size breakdown",
    "  is ONE line item — use the breakdown. But a SEPARATE size block elsewhere in",
    "  the message is its own line even when the numbers look similar: keep it as",
    "  'Unspecified garment' and add a blank asking which garment it belongs to.",
    "  DROPPING QUANTITIES IS THE ONE UNFORGIVABLE FAILURE — when unsure whether two",
    "  blocks are the same item, keep both and ask in blanks[].",
    "- If the message references a past order, resolve nicknames against ORDER HISTORY ('the dry-fits' → the actual style). Cite the order id in assumptions.",
    "- Print color count drives price. Only set colors > 1 when the message or history establishes it for that same art.",
    "- If the extraction carries a STATED PRICE, you must NOT bake it into any field —",
    "  put it in assumptions ('Shop stated $15/pc in the message') AND add a blank",
    "  telling the shop to reconcile it with engine pricing (adjust margin/discount).",
    "- A youth/kids version of a garment is a DIFFERENT style — use history or leave style_number empty with a catalog_search.",
    `- TODAY is ${todayISO}. Resolve relative deadlines against it.`,
    "",
    `EXTRACTED REQUEST:\n${JSON.stringify(extraction, null, 1)}`,
  ];
  if (historyText) parts.push("", `ORDER HISTORY for this customer:\n${historyText}`);
  else parts.push("", "ORDER HISTORY: none — this looks like a new customer. Anything not stated is a blank.");
  if (shopPriorsText) parts.push("", `SHOP DEFAULTS (this shop's recent habits — weak hints, never override the message):\n${shopPriorsText}`);
  parts.push("", "Record the draft with the record_draft tool.");
  return parts.join("\n");
}

// ── Validation / coercion of model output ────────────────────────────
// Tool-use gives schema-shaped output, but never trust across the wire:
// clamp, default, and drop anything malformed rather than crashing.

export function coerceExtraction(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    is_quote_request: raw.is_quote_request !== false,
    customer_name: str(raw.customer_name),
    company: str(raw.company),
    customer_email: str(raw.customer_email).toLowerCase(),
    phone: str(raw.phone),
    references_past_order: raw.references_past_order === true,
    deadline_text: str(raw.deadline_text),
    items: (Array.isArray(raw.items) ? raw.items : []).slice(0, 20).map((it) => ({
      description: str(it?.description),
      style_number: str(it?.style_number),
      color: str(it?.color),
      quantity_text: str(it?.quantity_text),
    })).filter((it) => it.description || it.style_number),
    print_text: str(raw.print_text),
    other_notes: str(raw.other_notes),
  };
}

export function coerceDraft(raw) {
  if (!raw || typeof raw !== "object") return null;
  const lines = (Array.isArray(raw.line_items) ? raw.line_items : []).slice(0, 20).map((li) => ({
    style_number: str(li?.style_number),
    brand: str(li?.brand),
    style_name: str(li?.style_name),
    garment_color: str(li?.garment_color),
    sizes: sizesOf(li?.sizes),
    total_qty: intOf(li?.total_qty),
    catalog_search: str(li?.catalog_search),
    imprints: (Array.isArray(li?.imprints) ? li.imprints : []).slice(0, 8).map((im) => ({
      location: str(im?.location) || "Front",
      title: str(im?.title) || "Artwork",
      colors: Math.max(1, Math.min(8, intOf(im?.colors) || 1)),
      ink: str(im?.ink),
      width_in: str(im?.width_in),
    })),
  })).filter((li) => li.style_number || li.catalog_search || li.style_name);
  if (!lines.length) return null;
  return {
    job_title: str(raw.job_title).slice(0, 80),
    line_items: lines,
    due_date: isoDateOrEmpty(str(raw.due_date)),
    assumptions: strList(raw.assumptions, 12),
    blanks: strList(raw.blanks, 12),
    customer_note_suggestion: str(raw.customer_note_suggestion).slice(0, 300),
  };
}

// ── Size curve ───────────────────────────────────────────────────────
// When the customer gave only a total ("about 50 hoodies"), seed a
// standard adult curve the shop can edit. Curve sums EXACTLY to qty —
// remainder lands on M/L (the sizes shops actually over-order).

export const SIZE_CURVE = [["S", 0.1], ["M", 0.25], ["L", 0.3], ["XL", 0.2], ["2XL", 0.15]];

export function sizeCurve(totalQty) {
  const qty = Math.max(0, Math.floor(Number(totalQty) || 0));
  if (!qty) return {};
  if (qty <= 4) return { M: Math.ceil(qty / 2), L: Math.floor(qty / 2) };
  const out = {};
  let used = 0;
  for (const [size, frac] of SIZE_CURVE) {
    const n = Math.floor(qty * frac);
    if (n > 0) { out[size] = n; used += n; }
  }
  let rest = qty - used;
  for (const size of ["L", "M", "XL", "S", "2XL"]) {
    if (!rest) break;
    out[size] = (out[size] || 0) + 1;
    rest--;
  }
  return out;
}

// ── Catalog candidates → line shaping ────────────────────────────────
// Reduce a supplier search result to the 3 choices the shop picks from.
// Cheapest in-stock color leads; the client fills real costs via the
// editor's own autoLookup once a style is picked.

export function shapeCandidates(searchResults, limit = 3) {
  const rows = Array.isArray(searchResults) ? searchResults : [];
  const shaped = [];
  for (const r of rows) {
    const style = str(r?.styleNumber || r?.resolvedStyleNumber);
    if (!style) continue;
    const colors = Array.isArray(r?.colors) ? r.colors : [];
    let cheapest = null;
    for (const c of colors) {
      const p = Number(c?.piecePrice ?? c?.casePrice);
      if (!Number.isFinite(p) || p <= 0) continue;
      const stock = Object.values(c?.sizeQuantities || {}).reduce((s, v) => s + (parseInt(v) || 0), 0);
      if (stock <= 0) continue;
      if (!cheapest || p < cheapest.price) cheapest = { price: p, color: str(c?.colorName), stock };
    }
    shaped.push({
      style_number: style,
      brand: str(r?.brandName || r?.brand),
      style_name: str(r?.styleName || r?.title || r?.resolvedTitle),
      from_price: cheapest?.price ?? null,
      example_color: cheapest?.color ?? "",
      colors_available: colors.length,
    });
    if (shaped.length >= limit) break;
  }
  return shaped;
}

// ── helpers ──────────────────────────────────────────────────────────
function str(v) { return typeof v === "string" ? v.trim() : ""; }
function intOf(v) { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; }
function strList(v, cap) {
  return (Array.isArray(v) ? v : []).map(str).filter(Boolean).slice(0, cap);
}
function sizesOf(v) {
  // Preferred shape: [{size, qty}] rows (tool-use emits arrays far more
  // reliably than free-form maps — the map form silently came back empty
  // while the model CLAIMED it had copied the breakdown). Legacy object
  // form still accepted.
  const out = {};
  if (Array.isArray(v)) {
    for (const row of v) {
      const k = typeof row?.size === "string" ? row.size.trim().toUpperCase() : "";
      const n = intOf(row?.qty);
      if (k && k.length <= 4 && n > 0) out[k] = (out[k] || 0) + n;
    }
    return out;
  }
  if (!v || typeof v !== "object") return {};
  for (const [k, q] of Object.entries(v)) {
    const n = intOf(q);
    if (n > 0 && typeof k === "string" && k.length <= 4) out[k.toUpperCase()] = n;
  }
  return out;
}
function isoDateOrEmpty(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}
