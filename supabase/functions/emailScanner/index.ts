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

// Parse email content with Gemini to extract quote details
async function parseEmailForQuote(from: string, subject: string, body: string): Promise<any> {
  const customerName = from.split("<")[0].trim().replace(/"/g, "") || from;
  const customerEmail = from.match(/<([^>]+)>/)?.[1] || from;
  const fullText = (subject + " " + body).toLowerCase();

  // Smart keyword detection — check for apparel/printing signals
  const garmentWords = /shirt|tee|hoodie|sweatshirt|tank|polo|cap|hat|beanie|crop top|crewneck|jersey|jacket/i;
  const printWords = /print|screen|dtg|embroid|logo|artwork|design|color.*(front|back|sleeve|chest)/i;
  const orderWords = /quote|pricing|order|sizes|quantity|quantities|how much|need.*printed|want.*printed/i;
  const styleNumbers = /\b\d{4}\b/; // 4-digit style numbers like 1580, 3001, 5000
  const sizePatterns = /\b(XS|S|M|L|XL|2XL|3XL|XXL)\s*[:\-]\s*\d+/i;
  const brandNames = /bella.*canvas|comfort\s*colors|next\s*level|gildan|hanes|champion|independent/i;

  const signals = [
    garmentWords.test(fullText),
    printWords.test(fullText),
    orderWords.test(fullText),
    styleNumbers.test(fullText),
    sizePatterns.test(fullText),
    brandNames.test(fullText),
  ].filter(Boolean).length;

  // If 2+ signals match, it's likely a quote request (even without AI)
  const keywordMatch = signals >= 2;

  if (!GEMINI_API_KEY) {
    if (!keywordMatch) {
      return { isQuoteRequest: false, customerName, customerEmail };
    }

    // Split body into sections by garment headers and extract sizes per section
    const lines = body.split(/\n/);
    const lineItems: any[] = [];
    let currentItem: any = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Detect garment header lines (contain garment words or style numbers but not size patterns)
      const isHeader = (garmentWords.test(trimmed) || brandNames.test(trimmed) || /\b\d{4}\b/.test(trimmed))
        && !/^\s*(XS|S|M|L|XL|2XL|3XL|XXL)\s*[:\-]/i.test(trimmed);

      if (isHeader) {
        if (currentItem) lineItems.push(currentItem);
        const styleMatch = trimmed.match(/\b(\d{4})\b/);
        currentItem = {
          garment: trimmed.replace(/\s*[-–]\s*\d{4}.*/, "").trim(),
          style: styleMatch ? styleMatch[1] : "",
          color: "",
          sizes: {},
          description: "",
          colors: 1,
          printLocations: "Front",
        };
        continue;
      }

      // Detect size lines
      const sizeMatch = trimmed.match(/^\s*(XS|S|M|L|XL|2XL|3XL|XXL)\s*[:\-]\s*(\d+)/i);
      if (sizeMatch) {
        if (!currentItem) currentItem = { garment: "", style: "", color: "", sizes: {}, description: "", colors: 1, printLocations: "Front" };
        currentItem.sizes[sizeMatch[1].toUpperCase()] = parseInt(sizeMatch[2]);
      }
    }
    if (currentItem && Object.keys(currentItem.sizes).length > 0) lineItems.push(currentItem);

    // Fallback: if no structured items found, create one with all sizes
    if (lineItems.length === 0) {
      const sizeMap: Record<string, number> = {};
      const sizeRegex = /\b(XS|S|M|L|XL|2XL|3XL|XXL)\s*[:\-]\s*(\d+)/gi;
      let m;
      while ((m = sizeRegex.exec(body)) !== null) sizeMap[m[1].toUpperCase()] = parseInt(m[2]);
      lineItems.push({ garment: "", style: "", color: "", sizes: sizeMap, description: "", colors: 1, printLocations: "Front" });
    }

    return {
      isQuoteRequest: true,
      customerName,
      customerEmail,
      summary: subject,
      lineItems,
      notes: body.slice(0, 500),
    };
  }

  // Skip Gemini for emails that clearly aren't quote-related (saves API quota)
  if (!keywordMatch) {
    return { isQuoteRequest: false, customerName, customerEmail };
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
