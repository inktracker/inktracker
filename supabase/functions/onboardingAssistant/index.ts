// Onboarding Assistant — in-app AI chat that helps new shop owners get set up.
//
// Flow:
//   1. Authenticates the user via their Supabase Bearer token.
//   2. Pulls a snapshot of their setup state (profile + shop row + entity counts).
//   3. Builds a system prompt that includes:
//        - What InkTracker is and what's in it (product context)
//        - This specific user's current setup state (so it can personalize)
//   4. Forwards conversation to Anthropic's Messages API.
//   5. Returns the assistant's reply.
//
// Read-only by design — the model cannot mutate user data. It can only answer
// questions and point users at the right page/setting.

import { createClient } from "npm:@supabase/supabase-js@2";
import { requireActiveSubscription } from "../_shared/subscriptionGuard.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("ONBOARDING_ASSISTANT_MODEL") ?? "claude-haiku-4-5-20251001";

// Per-user daily cap. 50 is generous (no human asks 50 onboarding
// questions in a day) but bounded — worst-case ~$0.20/day per
// abusive account. Overridable via env if Joe needs to tune.
const DAILY_LIMIT = Number(Deno.env.get("ONBOARDING_ASSISTANT_DAILY_LIMIT") ?? "50");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BROKER_CONTEXT = `
You are the InkTracker Broker Assistant — a friendly, plain-spoken helper for
brokers (sales reps / resellers) who quote screen-printing and embroidery jobs
to their clients and submit them to a shop for production. Brokers do NOT run
their own production — they're the middle-tier between a buyer and a shop.

What a broker can do in InkTracker:
- BrokerDashboard — main view: their quotes, clients, orders, profit
- Quotes tab — build a quote with line items, send to the shop for review,
  then send to the client. Two outputs per quote: a Shop Order Form (what
  the broker pays the shop, broker price) and a Client Quote (what the
  broker charges the client, retail price). The difference is the broker's profit.
- Clients tab — broker's own CRM-lite list of their end clients
- Orders tab — quotes that became orders after shop approval + payment
- Messages tab — chat with the shop
- Documents tab — files shared with the shop
- Files tab — artwork/job files
- Performance tab — broker's profit and order analytics
- Invoices tab — broker's billing history with their clients
- Profile tab — broker's own info (name, company, phone, address)

Flow they live in:
  1. Build a quote with line items, save as Draft.
  2. Submit to Shop → status becomes Pending. Shop reviews.
  3. Shop Approves (or pushes back). Broker sees "Shop Approved".
  4. Broker sends to Client. Status: Sent to Client.
  5. Client approves. Broker collects deposit. Status moves through
     Client Approved → Deposit Paid → Paid in Full.
  6. Quote converts to an Order; the shop produces and ships.

Pricing model the broker should understand:
- Broker Price (lower) = what the shop charges the broker. This is the wholesale
  rate the shop has set for its brokers.
- Client Total (higher) = what the broker charges the end client. The broker can
  adjust the per-line price on the quote.
- Total Broker Profit = Client Total − Broker Price.
- The shop never charges the broker tax (B2B). The broker chooses whether to
  charge their own client tax via the broker tax rate field on the quote.

Tone:
- Warm, concise, practical. Short answers (2-4 sentences) unless the user asks
  for detail.
- PLAIN TEXT ONLY — no markdown. The chat window renders raw text, so **bold**,
  bullets-with-asterisks, and [links](url) appear as literal punctuation. Write
  URLs bare and use plain sentences or simple dashes for lists.
- Brokers are sales-minded; speak in terms of their margin, close rate, and
  client relationship — not shop-floor concepts (presses, inks, etc.).
- Never invent features that aren't listed above. If you don't know, say so
  and suggest they email support.
- You're read-only. Recommend, don't act.

CRITICAL — DO NOT INVENT UI DETAILS:
You can't see the user's screen. Describe actions in general terms — never
invent specific button labels or positions. Page names listed above are stable
to cite; sub-controls inside pages should be referred to in general terms.
`.trim();

const PRODUCT_CONTEXT = `
You are the InkTracker Onboarding Assistant — a friendly, plain-spoken helper for
shop owners who run screen-printing and embroidery businesses. InkTracker is
their print-shop management SaaS.

What lives in InkTracker (pages users can navigate to):
- Dashboard — overview of quotes, orders, recent activity
- Quotes — build and send quotes to customers; includes the line item editor
- Production — track jobs through the shop (artwork → press → ship)
- Orders — confirmed orders that came from quotes
- Customers — CRM-lite, customer history
- Inventory — stock of blanks pulled from S&S Activewear / AS Colour
- Invoices — invoicing + QuickBooks sync
- Expenses — track shop expenses, sync to QB
- Performance — reports and analytics (gated on the paid plan)
- Mockups — visual mockup tool (paid plan)
- Wizard — public order-request form customers can fill in (paid plan)
- Embed — embed code for the wizard on their own website (paid plan)
- Account — settings: shop info, pricing, integrations, billing
- AdminPanel — user/team management (admin only)
- ShopFloor — simplified view for press operators
- BrokerDashboard — for brokers managing multiple shops

Integrations they can connect (all from the Account page):
- QuickBooks Online — two-way sync of invoices and expenses, AND how customers
  pay online: creating a QB invoice from a quote mints a payment link, and when
  the customer pays, InkTracker automatically converts the quote to an order.
  QuickBooks Payments must be activated inside QBO for the pay link to appear.
  Full setup checklist: https://www.inktracker.app/qb-setup
- S&S Activewear API — live garment pricing and ordering
- AS Colour API — live garment pricing and inventory
- Resend / verified email domain — to send quote emails from their own address

There is NO Stripe integration for customer payments — if asked how customers
pay, the answer is QuickBooks payment links (see above). Stripe only handles
the shop's own InkTracker subscription billing.

Important QuickBooks invoice fact: creating a QB invoice from InkTracker
ALWAYS emails the customer immediately — an Intuit API constraint, because
the only endpoint that mints the customer payment link also sends the email.
There is no silent create with a pay link. If a shop wants an invoice in QB
without notifying the customer: draft it inside QuickBooks Online directly
(QBO saves without sending), review, then send from QBO when ready — the
payment link and email go out at that moment, InkTracker picks the invoice
up on its next sync, and payment still auto-converts the quote to an order.
Full guide: https://www.inktracker.app/qb-setup

Duplicate customers (e.g. after connecting QB late): the rule is merge in
QuickBooks, not in InkTracker — QB is the book of record. After a QB-side
merge, InkTracker detects it on the Customers page and shows a banner with a
one-click finish that safely combines the local records (nothing is deleted
until every quote/order/invoice has moved). Never advise deleting a customer
that has history.

Billing: $99/month "Shop" plan, with a 14-day free trial. All features included.

Pricing engine: per-shop pricing config supports screen-print (color-count tiers)
and embroidery (stitch-count tiers). Found under Account → Pricing.

Tone:
- Warm, concise, practical. Short answers (2-4 sentences) unless the user asks
  for detail.
- PLAIN TEXT ONLY — no markdown. The chat window renders raw text, so **bold**,
  bullets-with-asterisks, and [links](url) appear as literal punctuation. Write
  URLs bare and use plain sentences or simple dashes for lists.
- Speak in plain English. Print-shop owners are not developers.
- If the user asks something unrelated to InkTracker (random trivia, coding
  help, jokes), politely refocus: "I'm here to help you get set up in
  InkTracker — what part of the app are you working on?"
- Never invent features that aren't listed above. If you don't know, say so
  and suggest they email support.
- Do NOT make changes on their behalf. You're read-only — recommend, don't act.

CRITICAL — DO NOT INVENT UI DETAILS:
You cannot see the user's screen. You do NOT know exact button labels, menu
names, panel positions, or icon text. Saying "click the Send Quote button (top
right)" when the actual button is labeled "+ New Quote" makes you wrong and
erodes trust fast.

Rules:
- Use the page names listed above (those are stable).
- For sub-controls inside pages, describe ACTIONS in general terms — never
  invent specific button text or positions.
  - BAD: "Click Send Quote (top right) → enter email → hit Send."
  - GOOD: "Open the quote and use the option to send it to your customer.
    You'll be prompted for their email and an optional message."
- If a user asks "where exactly is the X button?", say honestly that you
  can't see the screen, and point them at the right page: "It's on the
  Quotes page — look for the option to create or send a quote."
- Page names you CAN cite verbatim: Dashboard, Quotes, Production, Orders,
  Customers, Inventory, Invoices, Expenses, Performance, Mockups, Wizard,
  Embed, Account, AdminPanel, ShopFloor, BrokerDashboard.
- Sub-sections inside Account that you CAN cite (these are stable): Pricing,
  Supplier API Keys, Billing, Profile. Beyond that, stay general.
`.trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!ANTHROPIC_API_KEY) {
    return json({ error: "Assistant not configured. Missing ANTHROPIC_API_KEY." }, 500);
  }

  // ── 1. Authenticate ────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.replace("Bearer ", "");

  const supaUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: { user }, error: userErr } = await supaUser.auth.getUser(token);
  if (userErr || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  // ── 2. Pull profile + subscription guard ──────────────────────────────────
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("auth_id", user.id)
    .maybeSingle();

  if (!profile) {
    return json({ error: "Profile not found." }, 404);
  }

  // Enforce trial / paid subscription
  const blocked = requireActiveSubscription(profile);
  if (blocked) return blocked;

  // Employees don't get the assistant (shop floor only — no setup decisions).
  // Brokers DO get it, with a broker-specific system prompt and snapshot.
  if (profile.role === "employee") {
    return json({ error: "Not available for this role." }, 403);
  }
  const isBroker = profile.role === "broker";

  // ── 2.5 Per-user daily rate limit ─────────────────────────────────────────
  // Atomic increment via SECURITY DEFINER function (see migration
  // 20260602_assistant_usage.sql). Returns the new count for today.
  // If we're over the limit, 429. The rejected call counts against
  // the user too — fine, keeps the logic single-statement.
  const { data: newCount, error: rateErr } = await admin
    .rpc("increment_assistant_usage", { p_user_id: user.id });

  if (rateErr) {
    // If the rate-limit infra is unhealthy, fail open rather than
    // breaking the assistant for everyone. Log so we notice.
    console.error("assistant rate-limit increment failed:", rateErr);
  } else if (typeof newCount === "number" && newCount > DAILY_LIMIT) {
    return json(
      { error: `You've reached today's question limit (${DAILY_LIMIT}/day). Try again tomorrow.` },
      429,
    );
  }

  // ── 3. Read body ──────────────────────────────────────────────────────────
  let body: { messages?: Array<{ role: "user" | "assistant"; content: string }> };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const incomingMessages = Array.isArray(body.messages) ? body.messages : [];
  if (incomingMessages.length === 0) {
    return json({ error: "messages array is required" }, 400);
  }

  // Hard cap message history so the system prompt never gets out of hand.
  // The client should keep a reasonable rolling window, but we belt-and-brace it.
  const MAX_MESSAGES = 30;
  const MAX_CONTENT_CHARS = 4000;
  const trimmed = incomingMessages
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content ?? "").slice(0, MAX_CONTENT_CHARS),
    }))
    .filter((m) => m.content.length > 0);

  // Anthropic requires the first message in the history to be `user`.
  while (trimmed.length && trimmed[0].role !== "user") trimmed.shift();
  if (trimmed.length === 0) {
    return json({ error: "No usable user message in history" }, 400);
  }

  // ── 4. Build the per-user context block ───────────────────────────────────
  // Shop owners are scoped by their own email; brokers are scoped by
  // broker_id (their email used as the broker identity on quotes/orders).
  // Customer count for brokers is meaningless (brokers track their own
  // client list separately), so we skip it.
  const userEmail = profile.email || user.email || "";

  let setup: string;
  if (isBroker) {
    const assignedShop = Array.isArray(profile.assigned_shops) ? profile.assigned_shops[0] : null;
    const [{ data: shopOwnerProfile }, brokerQuoteCount, brokerOrderCount] = await Promise.all([
      assignedShop
        ? admin.from("profiles").select("shop_name, email").eq("email", assignedShop).maybeSingle()
        : Promise.resolve({ data: null }),
      countBrokerScoped(admin, "quotes", userEmail),
      countBrokerScoped(admin, "orders", userEmail),
    ]);
    setup = describeBrokerSetup(profile, shopOwnerProfile, {
      quoteCount: brokerQuoteCount,
      orderCount: brokerOrderCount,
    });
  } else {
    const [{ data: shopRow }, quoteCount, orderCount, customerCount] = await Promise.all([
      userEmail
        ? admin.from("shops").select("*").eq("owner_email", userEmail).maybeSingle()
        : Promise.resolve({ data: null }),
      countSafe(admin, "quotes", userEmail),
      countSafe(admin, "orders", userEmail),
      countSafe(admin, "customers", userEmail),
    ]);
    setup = describeSetup(profile, shopRow, { quoteCount, orderCount, customerCount });
  }

  const systemPrompt = [
    isBroker ? BROKER_CONTEXT : PRODUCT_CONTEXT,
    "",
    "=== THIS USER'S CURRENT SETUP ===",
    setup,
    "",
    "When relevant, reference the user's actual setup state above. Don't",
    "recite the whole block back at them — use it silently.",
  ].join("\n");

  // ── 5. Call Anthropic ─────────────────────────────────────────────────────
  let upstream: Response;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system: systemPrompt,
        messages: trimmed,
      }),
    });
  } catch (err) {
    return json({ error: `Upstream request failed: ${err instanceof Error ? err.message : String(err)}` }, 502);
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return json(
      { error: "Anthropic API error", status: upstream.status, detail: detail.slice(0, 500) },
      502,
    );
  }

  const data = await upstream.json().catch(() => null) as
    | { content?: Array<{ type: string; text?: string }>; usage?: unknown }
    | null;

  const reply = data?.content
    ?.filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n")
    .trim() ?? "";

  if (!reply) {
    return json({ error: "Empty reply from model", raw: data }, 502);
  }

  return json({ reply, model: MODEL });
});

// ─── helpers ────────────────────────────────────────────────────────────────

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function countSafe(
  admin: ReturnType<typeof createClient>,
  table: string,
  shopOwner: string,
): Promise<number> {
  if (!shopOwner) return 0;
  try {
    const { count, error } = await admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("shop_owner", shopOwner);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

// Brokers' rows are keyed by `broker_id` (= their email), not shop_owner.
async function countBrokerScoped(
  admin: ReturnType<typeof createClient>,
  table: string,
  brokerEmail: string,
): Promise<number> {
  if (!brokerEmail) return 0;
  try {
    const { count, error } = await admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("broker_id", brokerEmail);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** Broker-specific setup snapshot. */
function describeBrokerSetup(
  profile: Record<string, any>,
  shopOwnerProfile: Record<string, any> | null,
  counts: { quoteCount: number; orderCount: number },
): string {
  const lines: string[] = [];
  lines.push(`Broker: ${profile.full_name || profile.email || "(unknown)"} <${profile.email || "?"}>`);
  if (profile.company_name) lines.push(`Company: ${profile.company_name}`);
  if (profile.broker_phone) lines.push(`Phone on file: yes`);
  else                      lines.push(`Phone on file: NOT set (Profile)`);
  if (profile.broker_address) lines.push(`Address on file: yes`);
  else                        lines.push(`Address on file: NOT set (Profile)`);

  if (shopOwnerProfile?.shop_name) {
    lines.push(`Assigned to shop: ${shopOwnerProfile.shop_name} <${shopOwnerProfile.email}>`);
  } else {
    lines.push(`Assigned to shop: NOT yet linked — they need an invite from their shop admin`);
  }

  lines.push(`Quotes created: ${counts.quoteCount}`);
  lines.push(`Orders converted: ${counts.orderCount}`);

  return lines.join("\n");
}

/** Convert raw profile/shop data into a short, human-readable status block. */
function describeSetup(
  profile: Record<string, any>,
  shop: Record<string, any> | null,
  counts: { quoteCount: number; orderCount: number; customerCount: number },
): string {
  const lines: string[] = [];

  // Identity
  lines.push(`Shop name: ${profile.shop_name || "(not set yet)"}`);
  lines.push(`Owner: ${profile.full_name || profile.email || "(unknown)"} <${profile.email || "?"}>`);
  if (profile.role) lines.push(`Role: ${profile.role}`);

  // Trial / billing
  const tier = profile.subscription_tier || "(none)";
  const status = profile.subscription_status || "(none)";
  if (profile.trial_ends_at) {
    const daysLeft = Math.max(
      0,
      Math.ceil((new Date(profile.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
    );
    lines.push(`Plan: ${tier} (${status}) — ${daysLeft} day${daysLeft === 1 ? "" : "s"} left in trial`);
  } else {
    lines.push(`Plan: ${tier} (${status})`);
  }

  // Basics
  lines.push(`Logo uploaded: ${truthy(profile.logo_url)}`);
  lines.push(`Address on file: ${truthy(profile.address)}`);
  lines.push(`Default tax rate: ${profile.default_tax_rate ? profile.default_tax_rate + "%" : "not set"}`);

  // Pricing config (on the shops row)
  const pricingConfig = shop?.pricing_config;
  if (pricingConfig && typeof pricingConfig === "object" && Object.keys(pricingConfig).length > 0) {
    lines.push(`Pricing config: configured`);
  } else {
    lines.push(`Pricing config: NOT configured (Account → Pricing)`);
  }

  // Integrations
  const qbConnected = truthyVal(profile.qb_access_token);
  lines.push(`QuickBooks: ${qbConnected ? "connected" : "not connected"} (needed for online quote payments via QB payment links)`);

  const ssConnected = truthyVal(profile.ss_account_number) && truthyVal(profile.ss_api_key);
  lines.push(`S&S Activewear: ${ssConnected ? "connected" : "not connected"}`);

  const acConnected = truthyVal(profile.ac_username) || truthyVal(profile.ac_account);
  lines.push(`AS Colour: ${acConnected ? "connected" : "not connected"}`);

  const emailDomain = profile.email_from_domain || profile.verified_email_domain;
  lines.push(`Custom email domain: ${emailDomain ? "verified (" + emailDomain + ")" : "not set (sends from quotes@inktracker.app)"}`);

  // Activity
  lines.push(`Quotes created so far: ${counts.quoteCount}`);
  lines.push(`Orders so far: ${counts.orderCount}`);
  lines.push(`Customers in CRM: ${counts.customerCount}`);

  return lines.join("\n");
}

function truthy(v: unknown): string {
  return truthyVal(v) ? "yes" : "no";
}

function truthyVal(v: unknown): boolean {
  return v !== null && v !== undefined && v !== "" && v !== false;
}
