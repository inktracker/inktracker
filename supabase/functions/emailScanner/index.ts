import { createClient } from "npm:@supabase/supabase-js@2";

const GMAIL_CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID")!;
const GMAIL_CLIENT_SECRET = Deno.env.get("GMAIL_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/gmailOAuthCallback`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// Refresh Gmail token if expired
async function refreshGmailToken(profile: any) {
  if (!profile.gmail_refresh_token) return null;
  const expires = profile.gmail_token_expires_at ? new Date(profile.gmail_token_expires_at) : new Date(0);
  if (new Date() < expires) return profile.gmail_access_token;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: profile.gmail_refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) return null;
  const tokens = await res.json();

  await adminClient().from("profiles").update({
    gmail_access_token: tokens.access_token,
    gmail_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  }).eq("id", profile.id);

  return tokens.access_token;
}

// ── Signal detection (used both for "is this a quote request" and routing) ──
const GARMENT_WORDS = /shirt|tee|hoodie|sweatshirt|sweater|tank|polo|cap|hat|beanie|crop\s*top|crewneck|crew|jersey|jacket|long\s*sleeve|longsleeve|pullover/i;
const PRINT_WORDS = /print|screen|dtg|dtf|embroid|logo|artwork|design|color.*(front|back|sleeve|chest)/i;
const ORDER_WORDS = /quote|pricing|order|sizes|quantity|quantities|how much|need.*printed|want.*printed/i;
// Style numbers — Apparel SKUs are 3-5 digits, sometimes with a letter prefix/suffix
const STYLE_NUMBER_RE = /\b([A-Z]{0,3}\d{3,5}[A-Z0-9]{0,3})\b/i;
const SIZE_LINE_RE = /^\s*(XS|S|M|L|XL|XXL|2XL|3XL|4XL|5XL)\s*[:\-=]\s*(\d+)\s*$/i;
const BRAND_WORDS = /bella.*canvas|comfort\s*colors|next\s*level|gildan|hanes|champion|independent|tultex|american\s*apparel|alstyle|royal\s*apparel|fruit\s*of\s*the\s*loom|jerzees|district|threadfast|adidas|nike|columbia/i;

function countSignals(text: string): number {
  return [
    GARMENT_WORDS.test(text),
    PRINT_WORDS.test(text),
    ORDER_WORDS.test(text),
    STYLE_NUMBER_RE.test(text),
    /\b(XS|S|M|L|XL|2XL|3XL|XXL)\s*[:\-]\s*\d+/i.test(text),
    BRAND_WORDS.test(text),
  ].filter(Boolean).length;
}

// Strip quoted/threaded portions of an email so the structured parser only
// sees the latest message. Cuts off at common reply/forward markers and
// drops any line beginning with ">" (the gmail / standard quote prefix).
// Gemini gets the full body for its revision-aware reasoning; this helper
// is only used for the regex parser.
function latestMessageOnly(body: string): string {
  const lines = body.split(/\n/);
  const out: string[] = [];
  // Reply markers that delimit older quoted replies. We deliberately do
  // NOT include "Forwarded message" or "From:" lines — forwards have
  // those at the top, and the order content lives below them. We also
  // widen the "On X wrote:" length cap to handle long sender lines.
  const cutoffPatterns = [
    /^\s*On .{3,140} wrote:\s*$/i,                  // "On Mon, Jan 1, 2026 at 3:00 PM Joe <joe@x.co> wrote:"
    /^\s*-{3,}\s*Original Message\s*-{3,}\s*$/i,    // "----- Original Message -----"
  ];
  for (const line of lines) {
    if (cutoffPatterns.some((p) => p.test(line))) break;
    if (line.trim().startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n");
}

// Deterministic structured-text parser. Handles "size list" style input —
// the format shop owners actually paste. Walks lines, treats anything that
// looks like a garment description as a header that opens a new line item,
// and assigns subsequent size lines to the current item.
function structuredParse(body: string): any[] {
  const cleaned = latestMessageOnly(body);
  const lines = cleaned.split(/\n/);
  const items: any[] = [];
  let current: any = null;

  const blank = () => ({
    garment: "",
    style: "",
    brand: "",
    color: "",
    sizes: {} as Record<string, number>,
    description: "",
    colors: 1,
    printLocations: "Front",
    // imprints array: structured parser fills this in when a header line
    // contains print details (e.g. "5 color graphic on front, back logo").
    // Falls back to a single Front 1c imprint if nothing was extracted.
    imprints: [] as any[],
  });

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const sizeMatch = line.match(SIZE_LINE_RE);
    if (sizeMatch) {
      if (!current) current = blank();
      const sz = sizeMatch[1].toUpperCase().replace("XXL", "2XL");
      current.sizes[sz] = parseInt(sizeMatch[2]);
      continue;
    }

    // It's a header if it looks like garment description: any of
    //   - contains a garment word ("tee", "hoodie", etc.)
    //   - contains a brand name
    //   - contains something that looks like a style number (3-5 digits, optional letter prefix)
    // AND it isn't a size line (already handled above) and isn't pure metadata.
    const looksLikeHeader =
      GARMENT_WORDS.test(line) ||
      BRAND_WORDS.test(line) ||
      STYLE_NUMBER_RE.test(line);

    // Skip lines that are pure metadata like "SIZES FOR ORDER" or "Order details:"
    // These contain order keywords but no garment-y signal.
    const isMetadata =
      !GARMENT_WORDS.test(line) &&
      !BRAND_WORDS.test(line) &&
      !STYLE_NUMBER_RE.test(line);

    if (isMetadata) continue;

    if (looksLikeHeader) {
      if (current && Object.keys(current.sizes).length > 0) items.push(current);
      current = blank();
      const styleMatch = line.match(STYLE_NUMBER_RE);
      current.style = styleMatch ? styleMatch[1].replace(/^[:\s]+|[:\s]+$/g, "") : "";
      // Garment name = the line without the trailing style number and trailing punctuation
      let garment = line;
      if (styleMatch) garment = garment.replace(styleMatch[0], "");
      current.garment = garment.replace(/[:\-–\s]+$/g, "").trim();

      // Try to extract a brand from the header. If the customer wrote
      // "Bella Crop Tee 1580" we want to lock the brand to Bella+Canvas
      // so the catalog lookup picks the right product. Map regex hits to
      // the canonical brand names InkTracker uses.
      const brandMap: [RegExp, string][] = [
        [/bella.*canvas|bella\b/i, "Bella+Canvas"],
        [/comfort\s*colors/i, "Comfort Colors"],
        [/next\s*level/i, "Next Level"],
        [/gildan/i, "Gildan"],
        [/hanes/i, "Hanes"],
        [/champion/i, "Champion"],
        [/independent(\s*trading)?/i, "Independent Trading Co"],
        [/tultex/i, "Tultex"],
        [/american\s*apparel/i, "American Apparel"],
        [/alstyle/i, "Alstyle"],
        [/royal\s*apparel/i, "Royal Apparel"],
        [/fruit\s*of\s*the\s*loom/i, "Fruit of the Loom"],
        [/jerzees/i, "Jerzees"],
        [/district/i, "District"],
        [/threadfast/i, "Threadfast"],
        [/adidas/i, "Adidas"],
        [/nike/i, "Nike"],
        [/columbia/i, "Columbia"],
      ];
      for (const [re, name] of brandMap) {
        if (re.test(line)) { current.brand = name; break; }
      }

      // Try to extract a color from the header itself (e.g. "Womens Crop Tee 1580 Black")
      const colorMatch = line.match(/\b(black|white|navy|red|royal|forest|kelly|olive|charcoal|heather|grey|gray|silver|berry|jade|coral|indigo|rust|sage|pink|orange|yellow|green|blue|tan|cream|natural|maroon|burgundy|stone|bone|sand|khaki|peach|mint|lavender|purple|teal|aqua|brown|chocolate|espresso|sage|moss|brick|wine)\b/i);
      if (colorMatch) current.color = colorMatch[1];

      // Try to extract per-print/imprint info from the header line. Common
      // shop phrasings: "5 color graphic on front", "back logo", "pocket
      // logo", "sleeve graphic". Any matches replace the default single
      // Front imprint.
      const headerImprints = parseImprintsFromText(line);
      if (headerImprints.length > 0) current.imprints = headerImprints;
      continue;
    }
  }

  if (current && Object.keys(current.sizes).length > 0) items.push(current);
  return items;
}

// Pull imprint phrases out of a free-text line. Recognises:
//   "5 color graphic on front"  → Front, 5 colors
//   "back logo"                 → Back, 1 color
//   "upper mid back logo"       → Back, 1 color
//   "pocket logo"               → Pocket, 1 color
//   "big foot sleeve graphic"   → Right Sleeve, 1 color
//   "front 3 color"             → Front, 3 colors
//   "1 color front, 2 color back" → 2 imprints
function parseImprintsFromText(text: string): any[] {
  const t = text.toLowerCase();
  const found: any[] = [];

  const locationFor = (m: string) => {
    if (/left\s*chest/.test(m)) return "Left Chest";
    if (/right\s*chest/.test(m)) return "Right Chest";
    if (/chest/.test(m)) return "Left Chest";
    if (/left\s*sleeve/.test(m)) return "Left Sleeve";
    if (/right\s*sleeve/.test(m)) return "Right Sleeve";
    if (/sleeve/.test(m)) return "Right Sleeve";
    if (/pocket/.test(m)) return "Pocket";
    if (/hood/.test(m)) return "Hood";
    if (/back/.test(m)) return "Back";
    if (/front/.test(m)) return "Front";
    return null;
  };

  // Pattern A: "{N} color {something} {on}? {LOCATION}"
  // e.g. "5 color graphic on front", "1 color back print"
  const reA = /(\d+)\s*color[^,;.]{0,40}?(front|back|left\s*chest|right\s*chest|chest|left\s*sleeve|right\s*sleeve|sleeve|pocket|hood)/gi;
  let m;
  while ((m = reA.exec(t)) !== null) {
    const loc = locationFor(m[2]);
    if (!loc) continue;
    found.push({ location: loc, colors: parseInt(m[1]), description: "" });
  }

  // Pattern B: "{LOCATION} {N} color"  e.g. "back 5 color graphic"
  const reB = /(front|back|left\s*chest|right\s*chest|chest|left\s*sleeve|right\s*sleeve|sleeve|pocket|hood)\s+(\d+)\s*color/gi;
  while ((m = reB.exec(t)) !== null) {
    const loc = locationFor(m[1]);
    if (!loc) continue;
    // De-dupe if Pattern A already picked it up
    if (found.some((f) => f.location === loc && f.colors === parseInt(m[2]))) continue;
    found.push({ location: loc, colors: parseInt(m[2]), description: "" });
  }

  // Pattern C: "{LOCATION} (logo|graphic|design|print)" with no color count
  // — defaults to 1 color. Matches "back logo", "pocket logo", "sleeve graphic"
  const reC = /(?:upper\s+mid\s+|upper\s+|lower\s+|center\s+|big\s+foot\s+)?(front|back|left\s*chest|right\s*chest|chest|left\s*sleeve|right\s*sleeve|sleeve|pocket|hood)\s+(logo|graphic|design|print|wordmark|crest|emblem)/gi;
  while ((m = reC.exec(t)) !== null) {
    const loc = locationFor(m[1]);
    if (!loc) continue;
    if (found.some((f) => f.location === loc)) continue;
    found.push({ location: loc, colors: 1, description: m[2] });
  }

  // Pattern D: "(logo|graphic) on {LOCATION}" — "logo on back"
  const reD = /(logo|graphic|design|print|wordmark|crest|emblem)\s+on\s+(?:the\s+)?(front|back|left\s*chest|right\s*chest|chest|left\s*sleeve|right\s*sleeve|sleeve|pocket|hood)/gi;
  while ((m = reD.exec(t)) !== null) {
    const loc = locationFor(m[2]);
    if (!loc) continue;
    if (found.some((f) => f.location === loc)) continue;
    found.push({ location: loc, colors: 1, description: m[1] });
  }

  return found;
}

// Call Gemini to extract the contextual fields (customer info, dates, ship-tos,
// ink colors, special instructions). Even when the deterministic parser nails
// the line items, Gemini fills in the rest of the quote. Returns null on any
// failure so the caller can fall back gracefully.
async function geminiExtract(from: string, subject: string, body: string): Promise<any | null> {
  if (!GEMINI_API_KEY) return null;

  const prompt = `You are extracting structured data from a screen-print shop's customer email so a quote can be drafted automatically.

Be LIBERAL about marking it as a quote request — any mention of garments, sizes, style numbers, printing, brand names, or "how much for X" qualifies.

EMAIL THREAD HANDLING (CRITICAL): The pasted text may include a full email thread with replies, forwards, and quoted history — older messages typically appear lower in the text, sometimes prefixed with ">" or "On [date] X wrote:". When the customer revises quantities, sizes, colors, designs, or print specs across the thread, use ONLY THE MOST RECENT (newest) values. Drop superseded numbers entirely; do not include them anywhere in the output.

Examples of revisions you should resolve to the latest:
  - Earlier: "I need 50 shirts: S 20, M 20, L 10". Later: "Actually let's do S 10, M 30, L 20." → Use S:10, M:30, L:20.
  - Earlier: "Bella 3001 in heather grey." Later: "Switch to Comfort Colors 1717 in espresso instead." → Use Comfort Colors 1717 espresso.
  - Earlier: "1 color front print." Later: "Add a back print too, 1 color." → 2 imprints (Front + Back).
  - Earlier: "Need by Friday." Later: "Push to next Wednesday." → Use the Wednesday date.

When in doubt, prefer the most recent unambiguous statement. If a revision changes only one field (e.g. just sizes), keep the unchanged fields from the earlier message.

LINE ITEMS: each distinct garment SKU (style + color) gets its own row. Sizes listed under a garment header belong to that garment.

IMPRINTS (CRITICAL): each line item has an "imprints" array — ONE ENTRY PER PRINT LOCATION. Examples of how to interpret common phrasings:
  - "1 color front print" → imprints: [{location: "Front", colors: 1}]
  - "2 prints, front and back" → imprints: [{location: "Front", colors: 1}, {location: "Back", colors: 1}]
  - "Front: 3 colors, Back: 1 color" → imprints: [{location: "Front", colors: 3}, {location: "Back", colors: 1}]
  - "Logo on left chest, wordmark on back" → imprints: [{location: "Left Chest", colors: 1, description: "logo"}, {location: "Back", colors: 1, description: "wordmark"}]
  - "Full back print, 4 color" → imprints: [{location: "Back", colors: 4}]
  - "Same print on front and sleeve" → imprints: [{location: "Front", colors: 1}, {location: "Right Sleeve", colors: 1}]

Print locations should be exactly one of: Front, Back, Left Chest, Right Chest, Left Sleeve, Right Sleeve, Pocket, Hood. If a print is described differently, pick the closest of these.

If a print's color count or location applies to all line items uniformly, repeat the same imprints array on each item.

If the email says nothing about prints, default to a single {location: "Front", colors: 1} imprint.

Style numbers are 3–5 digit codes like 1580, 3001, G500, 6210, 75000. Brand examples: Bella+Canvas, Comfort Colors, Next Level, Gildan, Hanes, Champion, Independent Trading Co, Tultex, American Apparel.

For dates, return ISO format (YYYY-MM-DD). If they say "by Friday" without a year, infer the next upcoming Friday from today's date.

From: ${from}
Subject: ${subject}
Body:
${body}

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "isQuoteRequest": true/false,
  "customerName": "person's name from signature/from line",
  "customerEmail": "their email address",
  "company": "company or organization name if mentioned",
  "phone": "phone number if mentioned",
  "summary": "1-sentence summary of what they want",
  "inHandsDate": "YYYY-MM-DD when they need it by, or null",
  "rushNeeded": true/false,
  "lineItems": [
    {
      "garment": "type/description (t-shirt, hoodie, womens crop tee, etc)",
      "style": "style number (e.g. 1580, 3001, G500)",
      "brand": "brand name if mentioned (Bella+Canvas, Gildan, etc)",
      "color": "garment color if mentioned",
      "sizes": {"XS": 0, "S": 0, "M": 0, "L": 0, "XL": 0, "2XL": 0, "3XL": 0},
      "imprints": [
        {
          "location": "Front | Back | Left Chest | Right Chest | Left Sleeve | Right Sleeve | Pocket | Hood",
          "colors": <number of print colors, 1 if not stated>,
          "inkColors": "ink colors if mentioned (e.g. 'white', 'black + red')",
          "description": "design description if mentioned (e.g. 'logo', 'wordmark', 'crest')",
          "width": "width if mentioned (e.g. '4\"')",
          "height": "height if mentioned"
        }
      ],
      "description": "any other notes for this line item"
    }
  ],
  "shipToAddresses": [
    {"name": "recipient name", "address": "street, city, state zip", "items": "summary of what they get"}
  ],
  "specialInstructions": "any other notes from the email — folding, hangtags, packaging, etc",
  "notes": "raw paste of anything else relevant from the email"
}

If a field is unknown, return null or omit it. Do not invent data.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          // Match the working debugFullGemini config: thinking off so all
          // the output budget goes to the response, JSON mime mode so we
          // don't have to strip ```json fences, generous max tokens for
          // multi-item threads.
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
            thinkingConfig: { thinkingBudget: 0 },
            responseMimeType: "application/json",
          },
        }),
      }
    );
    if (!res.ok) {
      const errBody = await res.text();
      console.error("Gemini API failed:", res.status, errBody.slice(0, 300));
      return null;
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const finishReason = data.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== "STOP") {
      console.error("Gemini finished early:", finishReason);
    }
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    try { return JSON.parse(cleaned); } catch (e) {
      console.error("Gemini JSON parse failed:", (e as Error).message, "raw:", cleaned.slice(0, 300));
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) { try { return JSON.parse(match[0]); } catch { /* fall through */ } }
      return null;
    }
  } catch (err) {
    console.error("Gemini parse error:", err);
    return null;
  }
}

// Parse email content — run BOTH the deterministic structured parser and the
// Gemini-based contextual extractor in parallel. Use structured line items
// when available (more reliable for sizes); use Gemini for everything else
// (customer info, ship-tos, dates, ink colors, special instructions).
async function parseEmailForQuote(from: string, subject: string, body: string): Promise<any> {
  const customerNameFallback = from.split("<")[0].trim().replace(/"/g, "") || from;
  const customerEmailFallback = from.match(/<([^>]+)>/)?.[1] || from;
  const fullText = (subject + " " + body).toLowerCase();
  const signals = countSignals(fullText);
  const keywordMatch = signals >= 2;

  // Always call Gemini if available — it's the smarter extractor for
  // prose-heavy emails where customers don't follow any consistent format.
  // Structured parser is a fallback for when Gemini fails (no API key,
  // network error, malformed response).
  const gemini: any = await geminiExtract(from, subject, body);
  const structured = structuredParse(body);
  const hasStructuredItems = structured.length > 0 &&
    structured.some((it) => Object.keys(it.sizes).length > 0);
  const hasGeminiItems = Array.isArray(gemini?.lineItems) && gemini.lineItems.length > 0;

  const isQuoteRequest = hasStructuredItems || hasGeminiItems || gemini?.isQuoteRequest === true || keywordMatch;

  // Pick line items: prefer Gemini (handles prose), fall back to structured
  // parser if Gemini didn't return anything usable.
  let lineItems: any[] = hasGeminiItems ? gemini.lineItems : structured;

  // Even when the parser thinks this isn't a quote request, return whatever
  // contextual data Gemini did pick up plus a blank line item so the modal
  // can prefill notes/customer/dates and let Joe build out the items by hand.
  // This avoids the dead-end "couldn't extract" error on prose-style emails.
  if (!isQuoteRequest) {
    return {
      isQuoteRequest: false,
      customerName: gemini?.customerName || customerNameFallback,
      customerEmail: gemini?.customerEmail || customerEmailFallback,
      company: gemini?.company || "",
      phone: gemini?.phone || "",
      summary: gemini?.summary || subject,
      inHandsDate: gemini?.inHandsDate || null,
      rushNeeded: !!gemini?.rushNeeded,
      lineItems: [{ garment: "", style: "", brand: "", color: "", sizes: {}, description: "", colors: 1, printLocations: "Front" }],
      shipToAddresses: Array.isArray(gemini?.shipToAddresses) ? gemini.shipToAddresses : [],
      specialInstructions: gemini?.specialInstructions || "",
      notes: gemini?.notes || body.slice(0, 1500),
    };
  }

  // When Gemini is primary, supplement with sizes from the structured parser
  // (the regex parser is more reliable for clean size lists). Match by style.
  if (hasGeminiItems && hasStructuredItems) {
    lineItems = lineItems.map((it: any) => {
      const struct = structured.find((s: any) =>
        s.style && it.style && String(s.style).toUpperCase() === String(it.style).toUpperCase()
      );
      if (!struct) return it;
      // Only fill in sizes that Gemini missed; don't override Gemini's values.
      const mergedSizes = { ...(struct.sizes || {}), ...(it.sizes || {}) };
      return { ...it, sizes: mergedSizes };
    });
  }

  // If we still have nothing, lump any sizes we can find into one blank item.
  if (lineItems.length === 0) {
    const sizeMap: Record<string, number> = {};
    const sizeRegex = /\b(XS|S|M|L|XL|2XL|3XL|XXL)\s*[:\-]\s*(\d+)/gi;
    let m;
    while ((m = sizeRegex.exec(body)) !== null) sizeMap[m[1].toUpperCase()] = parseInt(m[2]);
    lineItems = [{ garment: "", style: "", brand: "", color: "", sizes: sizeMap, description: "", colors: 1, printLocations: "Front" }];
  }

  return {
    isQuoteRequest: true,
    customerName: gemini?.customerName || customerNameFallback,
    customerEmail: gemini?.customerEmail || customerEmailFallback,
    company: gemini?.company || "",
    phone: gemini?.phone || "",
    summary: gemini?.summary || subject,
    inHandsDate: gemini?.inHandsDate || null,
    rushNeeded: !!gemini?.rushNeeded,
    lineItems,
    shipToAddresses: Array.isArray(gemini?.shipToAddresses) ? gemini.shipToAddresses : [],
    specialInstructions: gemini?.specialInstructions || "",
    notes: gemini?.notes || body.slice(0, 1500),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { action, accessToken } = body;

    const supaUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: { user }, error: authErr } = await supaUser.auth.getUser(accessToken);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await adminClient()
      .from("profiles")
      .select("*")
      .eq("auth_id", user.id)
      .single();
    if (!profile) return json({ error: "Profile not found" });

    // ── getAuthUrl ──────────────────────────────────────────────────
    if (action === "getGmailAuthUrl") {
      const state = crypto.randomUUID();
      await adminClient().from("profiles").update({ gmail_oauth_state: state }).eq("id", profile.id);

      const params = new URLSearchParams({
        client_id: GMAIL_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        scope: "https://www.googleapis.com/auth/gmail.readonly",
        access_type: "offline",
        prompt: "consent",
        state,
      });

      return json({ authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
    }

    // ── scanEmails ──────────────────────────────────────────────────
    if (action === "scanEmails") {
      const gmailToken = await refreshGmailToken(profile);
      if (!gmailToken) return json({ error: "Gmail not connected or token expired" });

      // Always scan the last 7 days — deduplication prevents reprocessing
      const daysBack = Number(body.daysBack) || 7;
      const afterEpoch = Math.floor((Date.now() - daysBack * 86400000) / 1000);

      // Search for recent emails — exclude own sends, auto-notifications, quote replies
      const myEmail = profile.email || "";
      const searchQuery = encodeURIComponent(`in:inbox after:${afterEpoch} -category:promotions -category:social -category:updates -from:noreply -from:no-reply -from:${myEmail} -subject:"Your Quote from" -subject:"Invoice from" -from:quickbooks -from:intuit -from:stripe -from:supabase -from:vercel`);
      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${searchQuery}&maxResults=20`,
        { headers: { Authorization: `Bearer ${gmailToken}` } }
      );

      if (!listRes.ok) {
        console.error("Gmail list failed:", listRes.status, await listRes.text());
        return json({ error: "Failed to fetch emails" });
      }

      const listData = await listRes.json();
      const messages = listData.messages || [];

      let quotesCreated = 0;
      const results: any[] = [];
      const skipped: any[] = [];

      for (const msg of messages) {
        // Get full message
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: `Bearer ${gmailToken}` } }
        );
        if (!msgRes.ok) continue;
        const msgData = await msgRes.json();

        // Extract headers
        const headers = msgData.payload?.headers || [];
        const from = headers.find((h: any) => h.name === "From")?.value || "";
        const subject = headers.find((h: any) => h.name === "Subject")?.value || "";
        const messageId = headers.find((h: any) => h.name === "Message-ID")?.value || msg.id;

        // Skip if already processed (by message ID or same sender+subject combo)
        const { data: existing } = await adminClient()
          .from("quotes")
          .select("id")
          .eq("source_email_id", messageId)
          .maybeSingle();
        if (existing) { skipped.push({ from, subject, reason: "already processed" }); continue; }

        // Skip if a quote already exists for this sender with similar subject
        const senderEmail = from.match(/<([^>]+)>/)?.[1] || from;
        const { data: existingBySender } = await adminClient()
          .from("quotes")
          .select("id")
          .eq("customer_email", senderEmail.toLowerCase())
          .eq("source", "email")
          .gte("created_date", new Date(Date.now() - 7 * 86400000).toISOString())
          .limit(1);
        if (existingBySender?.length) { skipped.push({ from, subject, reason: "recent quote exists for this sender" }); continue; }

        // Extract body text
        let bodyText = "";
        function extractText(part: any) {
          if (part.mimeType === "text/plain" && part.body?.data) {
            bodyText += atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
          }
          if (part.parts) part.parts.forEach(extractText);
        }
        extractText(msgData.payload);
        if (!bodyText && msgData.snippet) bodyText = msgData.snippet;

        // Parse with AI
        const parsed = await parseEmailForQuote(from, subject, bodyText);

        if (!parsed.isQuoteRequest) {
          skipped.push({ from, subject, reason: "not a quote request" });
          continue;
        }

        {
          // Create draft quote
          const quoteId = `Q-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
          const lineItems = (parsed.lineItems || []).map((li: any, idx: number) => {
            // Build sizes object from parsed data
            let sizes: Record<string, number> = {};
            if (li.sizes && typeof li.sizes === "object") {
              for (const [k, v] of Object.entries(li.sizes)) {
                const num = Number(v);
                if (num > 0) sizes[k] = num;
              }
            }

            return {
              id: `email-${idx}-${Date.now()}`,
              style: li.style || "",
              brand: "",
              category: li.garment || "",
              garmentColor: li.color || "",
              garmentCost: 0,
              sizes,
              imprints: [{
                id: `imp-${idx}-${Date.now()}`,
                location: li.printLocations || "Front",
                colors: li.colors || 1,
                technique: "Screen Print",
                title: li.description || "",
                linked: false,
              }],
            };
          });

          const quotePayload: any = {
            quote_id: quoteId,
            shop_owner: profile.email,
            customer_name: parsed.customerName || "Email Inquiry",
            customer_email: parsed.customerEmail || "",
            status: "Draft",
            date: new Date().toISOString().split("T")[0],
            tax_rate: profile.default_tax_rate || 0,
            line_items: lineItems.length > 0 ? lineItems : [{ id: `blank-${Date.now()}`, style: "", brand: "", garmentColor: "", garmentCost: 0, sizes: {}, imprints: [{ id: `imp-${Date.now()}`, location: "Front", colors: 1, technique: "Screen Print", title: "", linked: false }] }],
            discount: 0,
            rush_rate: parsed.rushNeeded ? 0.2 : 0,
            notes: `From email: ${subject}\n\n${parsed.summary || ""}\n\n${parsed.notes || ""}`.trim(),
            source: "email",
            source_email_id: messageId,
          };

          const { error: insertErr } = await adminClient().from("quotes").insert(quotePayload);
          if (!insertErr) {
            quotesCreated++;
            results.push({ subject, from: parsed.customerName, quoteId });
          } else {
            console.error("Quote insert failed:", insertErr.message);
          }
        }
      }

      // Update last scan timestamp
      await adminClient().from("profiles").update({
        gmail_last_scan: new Date().toISOString(),
      }).eq("id", profile.id);

      return json({ scanned: messages.length, quotesCreated, results, skipped });
    }

    // ── parseAndCreate ───────────────────────────────────────────────
    if (action === "parseAndCreate") {
      const emailBody = body.emailBody;
      if (!emailBody) return json({ error: "No email content provided" });

      const parsed = await parseEmailForQuote("", "", emailBody);

      const quoteId = `Q-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
      const lineItems = (parsed.lineItems || []).map((li: any, idx: number) => {
        let sizes: Record<string, number> = {};
        if (li.sizes && typeof li.sizes === "object") {
          for (const [k, v] of Object.entries(li.sizes)) {
            const num = Number(v);
            if (num > 0) sizes[k] = num;
          }
        }
        return {
          id: `email-${idx}-${Date.now()}`,
          style: li.style || "",
          brand: "",
          category: li.garment || "",
          garmentColor: li.color || "",
          garmentCost: 0,
          sizes,
          imprints: [{
            id: `imp-${idx}-${Date.now()}`,
            location: li.printLocations || "Front",
            colors: li.colors || 1,
            technique: "Screen Print",
            title: li.description || "",
            linked: false,
          }],
        };
      });

      // If no line items parsed, create one blank
      if (lineItems.length === 0) {
        lineItems.push({ id: `blank-${Date.now()}`, style: "", brand: "", garmentColor: "", garmentCost: 0, sizes: {}, imprints: [{ id: `imp-${Date.now()}`, location: "Front", colors: 1, technique: "Screen Print", title: "", linked: false }] });
      }

      // Try to match customer by email
      let customerId = null;
      let customerName = parsed.customerName || "Email Inquiry";
      const customerEmail = parsed.customerEmail || "";
      if (customerEmail) {
        const { data: custMatch } = await adminClient()
          .from("customers")
          .select("id, name")
          .eq("email", customerEmail.toLowerCase())
          .eq("shop_owner", profile.email)
          .maybeSingle();
        if (custMatch) { customerId = custMatch.id; customerName = custMatch.name; }
      }

      const quotePayload = {
        quote_id: quoteId,
        shop_owner: profile.email,
        customer_id: customerId,
        customer_name: customerName,
        customer_email: customerEmail,
        status: "Draft",
        date: new Date().toISOString().split("T")[0],
        tax_rate: profile.default_tax_rate || 0,
        line_items: lineItems,
        discount: 0,
        rush_rate: parsed.rushNeeded ? 0.2 : 0,
        notes: parsed.notes || parsed.summary || "",
        source: "email",
      };

      const { error: insertErr } = await adminClient().from("quotes").insert(quotePayload);
      if (insertErr) return json({ error: insertErr.message });

      return json({ quoteId, customerName, lineItems: lineItems.length });
    }

    // ── parseOnly ───────────────────────────────────────────────────
    // Run the parser on supplied text and return structured line items
    // WITHOUT inserting a quote. The frontend's "Paste Order" button uses
    // this to prefill the modal — the user reviews, then saves through
    // the normal flow.
    // ── listGeminiModels ────────────────────────────────────────────
    // List models available to this Gemini API key so we can pick one
    // that's actually accessible (free-tier vs paid-tier vs deprecated).
    if (action === "listGeminiModels") {
      if (!GEMINI_API_KEY) return json({ error: "GEMINI_API_KEY not set" });
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`);
        const data = await r.json();
        const models = (data.models || [])
          .filter((m: any) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
          .map((m: any) => ({ name: m.name, displayName: m.displayName }));
        return json({ status: r.status, count: models.length, models });
      } catch (err) {
        return json({ error: (err as Error).message });
      }
    }

    // ── debugFullGemini ─────────────────────────────────────────────
    // Run the EXACT same Gemini call geminiExtract makes (same config,
    // same prompt), then return the raw HTTP response + parsed parseEmailForQuote
    // output. Lets us see whether the issue is the call config, the prompt,
    // or the post-processing.
    if (action === "debugFullGemini") {
      const text = body.text || body.emailBody || "";
      if (!GEMINI_API_KEY) return json({ error: "GEMINI_API_KEY not set" });
      // Re-build the SAME prompt geminiExtract uses
      const prompt = `Extract this email's order. Reply with ONLY JSON: {"customerName": "...", "lineItems": [{"style": "...", "brand": "...", "color": "...", "sizes": {"S": 0}}]}\n\n${text}`;
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 8192,
                thinkingConfig: { thinkingBudget: 0 },
                responseMimeType: "application/json",
              },
            }),
          }
        );
        const rawText = await r.text();
        // Also call geminiExtract via the actual function path so we can
        // compare what extraction produces.
        const fromExtract = await geminiExtract(body.from || "", body.subject || "", text);
        return json({
          fetchStatus: r.status,
          fetchOk: r.ok,
          rawResponseFirst2000: rawText.slice(0, 2000),
          extractResultNull: fromExtract === null,
          extractResultSummary: fromExtract && {
            customerName: fromExtract.customerName,
            itemCount: fromExtract.lineItems?.length,
            firstItemStyle: fromExtract.lineItems?.[0]?.style,
          },
        });
      } catch (err) {
        return json({ fetchError: (err as Error).message });
      }
    }

    // ── debugGemini ─────────────────────────────────────────────────
    // Direct Gemini call so we can see what the LLM actually returns for
    // a given paste. Useful for diagnosing why fields come back empty.
    if (action === "debugGemini") {
      const text = body.text || body.emailBody || "";
      const hasKey = !!GEMINI_API_KEY;
      if (!hasKey) return json({ error: "GEMINI_API_KEY not set on the function", hasKey });
      // Hit Gemini directly with a minimal prompt and surface the raw response
      // so we can see why parseEmailForQuote is getting null back.
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `Reply with the JSON {"ok": true, "echo": "${text.slice(0, 100).replace(/"/g, "'")}"}` }] }],
              generationConfig: { temperature: 0, maxOutputTokens: 256 },
            }),
          }
        );
        const rawText = await res.text();
        return json({
          hasKey,
          fetchStatus: res.status,
          fetchOk: res.ok,
          rawResponse: rawText.slice(0, 1500),
        });
      } catch (err) {
        return json({ hasKey, fetchError: (err as Error).message });
      }
    }

    if (action === "parseOnly") {
      const text = body.text || body.emailBody || "";
      if (!text) return json({ error: "No text provided" });

      const parsed = await parseEmailForQuote(body.from || "", body.subject || "", text);

      const lineItems = (parsed.lineItems || []).map((li: any, idx: number) => {
        const sizes: Record<string, number> = {};
        if (li.sizes && typeof li.sizes === "object") {
          for (const [k, v] of Object.entries(li.sizes)) {
            const num = Number(v);
            if (num > 0) sizes[k] = num;
          }
        }

        // Build imprints array. The structured parser may have already
        // extracted imprints from header lines (e.g. "5 color graphic on
        // front, back logo"). Otherwise honor Gemini's array if it sent one.
        // Final fallback: single Front 1c imprint.
        let imprintsArr: any[] = [];
        if (Array.isArray(li.imprints) && li.imprints.length > 0) {
          imprintsArr = li.imprints.map((imp: any, j: number) => ({
            id: `imp-${idx}-${j}-${Date.now()}`,
            location: imp.location || "Front",
            colors: Number(imp.colors) || 1,
            technique: "Screen Print",
            // Title combines design description + ink colors so it's visible
            // on the line item card without losing either piece of context.
            title: [imp.description, imp.inkColors ? `Ink: ${imp.inkColors}` : ""]
              .filter(Boolean).join(" — "),
            width: imp.width || "",
            height: imp.height || "",
            pantones: imp.pantones || "",
            linked: false,
          }));
        }
        if (imprintsArr.length === 0) {
          imprintsArr = [{
            id: `imp-${idx}-${Date.now()}`,
            location: li.printLocations || "Front",
            colors: Number(li.colors) || 1,
            technique: "Screen Print",
            title: li.description || "",
            linked: false,
          }];
        }

        return {
          id: `paste-${idx}-${Date.now()}`,
          style: li.style || "",
          brand: li.brand || "",
          category: li.garment || "",
          garmentColor: li.color || "",
          garmentCost: 0,
          sizes,
          imprints: imprintsArr,
        };
      });

      // Compose a notes blob that captures special instructions + ship-to
      // breakdown so Joe can see where each line item is going.
      let composedNotes = parsed.notes || "";
      if (parsed.specialInstructions) {
        composedNotes = [parsed.specialInstructions, composedNotes].filter(Boolean).join("\n\n");
      }
      if (Array.isArray(parsed.shipToAddresses) && parsed.shipToAddresses.length > 0) {
        const shipToBlock = parsed.shipToAddresses
          .map((s: any, i: number) =>
            `Ship-to ${i + 1}: ${s.name || ""}${s.address ? " — " + s.address : ""}${s.items ? "\n  " + s.items : ""}`,
          )
          .join("\n\n");
        composedNotes = [shipToBlock, composedNotes].filter(Boolean).join("\n\n");
      }

      return json({
        isQuoteRequest: !!parsed.isQuoteRequest,
        customerName: parsed.customerName || "",
        customerEmail: parsed.customerEmail || "",
        company: parsed.company || "",
        phone: parsed.phone || "",
        summary: parsed.summary || "",
        inHandsDate: parsed.inHandsDate || null,
        rushNeeded: !!parsed.rushNeeded,
        shipToAddresses: parsed.shipToAddresses || [],
        specialInstructions: parsed.specialInstructions || "",
        notes: composedNotes,
        lineItems,
      });
    }

    // ── checkConnection ─────────────────────────────────────────────
    if (action === "checkGmailConnection") {
      return json({
        connected: !!profile.gmail_access_token,
        lastScan: profile.gmail_last_scan,
      });
    }

    return json({ error: "Unknown action" });
  } catch (err) {
    console.error("emailScanner error:", err);
    return json({ error: err.message }, 500);
  }
});
