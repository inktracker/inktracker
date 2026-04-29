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

// Deterministic structured-text parser. Handles "size list" style input —
// the format shop owners actually paste. Walks lines, treats anything that
// looks like a garment description as a header that opens a new line item,
// and assigns subsequent size lines to the current item.
function structuredParse(body: string): any[] {
  const lines = body.split(/\n/);
  const items: any[] = [];
  let current: any = null;

  const blank = () => ({
    garment: "",
    style: "",
    color: "",
    sizes: {} as Record<string, number>,
    description: "",
    colors: 1,
    printLocations: "Front",
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

      // Try to extract a color from the header itself (e.g. "Womens Crop Tee 1580 Black")
      const colorMatch = line.match(/\b(black|white|navy|red|royal|forest|kelly|olive|charcoal|heather|grey|gray|berry|jade|coral|indigo|rust|sage|pink|orange|yellow|green|blue|tan|cream|natural|maroon|burgundy)\b/i);
      if (colorMatch) current.color = colorMatch[1];
      continue;
    }
  }

  if (current && Object.keys(current.sizes).length > 0) items.push(current);
  return items;
}

// Parse email content — try deterministic parser first, fall back to Gemini for prose.
async function parseEmailForQuote(from: string, subject: string, body: string): Promise<any> {
  const customerName = from.split("<")[0].trim().replace(/"/g, "") || from;
  const customerEmail = from.match(/<([^>]+)>/)?.[1] || from;
  const fullText = (subject + " " + body).toLowerCase();
  const signals = countSignals(fullText);
  const keywordMatch = signals >= 2;

  // First, try the deterministic structured parser. If it finds at least one
  // line item with sizes, trust it — the input was structured enough that we
  // don't need to roll the dice on an LLM. This is the path Joe paste-orders take.
  const structured = structuredParse(body);
  const hasStructuredItems = structured.length > 0 &&
    structured.some((it) => Object.keys(it.sizes).length > 0);

  if (hasStructuredItems) {
    return {
      isQuoteRequest: true,
      customerName,
      customerEmail,
      summary: subject,
      lineItems: structured,
      notes: body.slice(0, 500),
    };
  }

  if (!keywordMatch) {
    return { isQuoteRequest: false, customerName, customerEmail };
  }

  // No structured line items found — body is probably prose. Hand to Gemini if available.
  if (!GEMINI_API_KEY) {
    // No AI available; emit a single lumped item from any sizes we can find.
    const sizeMap: Record<string, number> = {};
    const sizeRegex = /\b(XS|S|M|L|XL|2XL|3XL|XXL)\s*[:\-]\s*(\d+)/gi;
    let m;
    while ((m = sizeRegex.exec(body)) !== null) sizeMap[m[1].toUpperCase()] = parseInt(m[2]);
    return {
      isQuoteRequest: true,
      customerName,
      customerEmail,
      summary: subject,
      lineItems: [{ garment: "", style: "", color: "", sizes: sizeMap, description: "", colors: 1, printLocations: "Front" }],
      notes: body.slice(0, 500),
    };
  }

  const prompt = `Analyze this email and determine if it could be related to a screen printing or custom apparel order. Be LIBERAL in your assessment — if the email mentions ANY of the following, mark it as a quote request:
- Garment types (shirts, tees, hoodies, tanks, crop tops, hats, etc.)
- Style numbers (like 1580, 3001, 5000)
- Sizes or quantities (S, M, L, XL, or any numbers)
- Printing, logos, artwork, designs, colors
- Pricing, quotes, orders
- Brand names (Bella Canvas, Comfort Colors, Next Level, Gildan, etc.)

Even casual/conversational emails from existing customers discussing garments or orders should be marked as quote requests.

From: ${from}
Subject: ${subject}
Body: ${body}

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "isQuoteRequest": true/false,
  "customerName": "name from email",
  "customerEmail": "email address",
  "company": "company name if mentioned",
  "phone": "phone if mentioned",
  "summary": "brief summary of what they want",
  "lineItems": [
    {
      "garment": "type of garment (t-shirt, hoodie, etc)",
      "style": "specific style number if mentioned (e.g. 1580, 3001)",
      "color": "color if mentioned",
      "quantity": estimated total quantity or 0,
      "sizes": {"XS": 0, "S": 0, "M": 0, "L": 0, "XL": 0, "2XL": 0},
      "printLocations": "front, back, etc if mentioned",
      "colors": number of print colors if mentioned or 1,
      "description": "print/design description"
    }
  ],
  "rushNeeded": true/false,
  "notes": "any other relevant details"
}

For sizes, fill in actual numbers from the email if provided. For garment style, extract the style number (like 1580, 3001) if mentioned.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
        }),
      }
    );

    if (!res.ok) {
      console.error("Gemini API failed:", res.status);
      // Fall back to keyword matcher on API failure
      if (keywordMatch) {
        const sizeMap: Record<string, number> = {};
        const sizeRegex = /\b(XS|S|M|L|XL|2XL|3XL|XXL)\s*[:\-]\s*(\d+)/gi;
        let m;
        while ((m = sizeRegex.exec(body)) !== null) sizeMap[m[1].toUpperCase()] = parseInt(m[2]);
        return { isQuoteRequest: true, customerName, customerEmail, summary: subject, lineItems: [{ garment: "", style: "", color: "", sizes: sizeMap, description: "", colors: 1, printLocations: "Front" }], notes: body.slice(0, 500) };
      }
      return { isQuoteRequest: false };
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Strip markdown code fences if present
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    try {
      return JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      return { isQuoteRequest: false };
    }
  } catch (err) {
    console.error("Gemini parse error:", err);
    return { isQuoteRequest: false };
  }
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
        return {
          id: `paste-${idx}-${Date.now()}`,
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

      return json({
        isQuoteRequest: !!parsed.isQuoteRequest,
        customerName: parsed.customerName || "",
        customerEmail: parsed.customerEmail || "",
        company: parsed.company || "",
        phone: parsed.phone || "",
        summary: parsed.summary || "",
        rushNeeded: !!parsed.rushNeeded,
        notes: parsed.notes || "",
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
