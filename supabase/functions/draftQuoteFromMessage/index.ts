// AI quote draft — turn a pasted customer message into a structured draft
// the shop reviews in the real quote editor.
//
// TESTING GATE: reachable only from the Paste Order UI, which is hidden
// behind the ?paste=1 localStorage flag (internal testers). Nothing in the
// prod UI calls this. This function NEVER writes to the database — it
// returns a draft; the shop saves (or doesn't) through the normal editor.
//
// Pipeline (the decisions live in _shared/quoteDraftLogic.js, unit-tested):
//   1. auth: accessToken → shop (same posture as partnerHandoff)
//   2. Pass 1 (Haiku): extract structured intent from the message
//   3. context: match the customer (RLS-scoped to THIS shop), summarize
//      their recent orders; collect light shop priors
//   4. Pass 2 (Sonnet): extraction + context → draft with explicit
//      assumptions[] and blanks[] — the model may NOT price anything
//   5. catalog: for lines with no concrete style, fetch 3 candidates from
//      the shop's supplier (S&S) so "some hoodies" becomes pickable
//
// Cost per call: ~1 Haiku pass (~2k tok) + 1 Sonnet pass (~3-6k tok)
// ≈ $0.02-0.04. No retries beyond one malformed-output re-ask.

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import {
  EXTRACT_MODEL_DEFAULT, DRAFT_MODEL_DEFAULT,
  EXTRACTION_TOOL, DRAFT_TOOL,
  buildExtractionPrompt, buildDraftPrompt,
  coerceExtraction, coerceDraft,
  summarizeHistory, shapeCandidates, sizeCurve,
} from "../_shared/quoteDraftLogic.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const EXTRACT_MODEL = Deno.env.get("QUOTE_DRAFT_EXTRACT_MODEL") || EXTRACT_MODEL_DEFAULT;
const DRAFT_MODEL = Deno.env.get("QUOTE_DRAFT_MODEL") || DRAFT_MODEL_DEFAULT;

function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

// One forced-tool call. Returns the tool input or null (caller decides
// whether to re-ask). Never throws on model refusal — a draft feature
// must degrade to "couldn't read that", not a 500.
async function callClaude(model: string, prompt: string, tool: any, maxTokens: number): Promise<any | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    console.error(`[quoteDraft] ${model} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return null;
  }
  const data = await res.json();
  const block = (data?.content || []).find((b: any) => b.type === "tool_use" && b.name === tool.name);
  return block?.input ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: "AI drafting isn't configured on this install." }, 503);

  try {
    const { accessToken, message, customerId } = await req.json();
    if (!accessToken) return json({ error: "accessToken required" }, 401);
    const text = String(message || "").trim();
    if (!text) return json({ error: "Paste a message first." }, 400);
    if (text.length > 20_000) return json({ error: "That message is too long — trim it to the relevant part." }, 400);

    // ── auth: token → shop (partnerHandoff posture) ──────────────────
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${accessToken}` } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser(accessToken);
    if (userErr || !user) return json({ error: "Invalid access token" }, 401);

    const db = admin();
    const { data: profile } = await db
      .from("profiles").select("email, role, shop_owner")
      .eq("auth_id", user.id).maybeSingle();
    if (!profile) return json({ error: "Profile not found" }, 404);
    if (!["shop", "admin", "manager"].includes(profile.role || "")) {
      return json({ error: "Quote drafting requires an owner or manager account." }, 403);
    }
    const myShop = String(profile.shop_owner || profile.email || "").toLowerCase();
    if (!myShop) return json({ error: "No shop resolved for this account" }, 403);

    // ── pass 1: extraction ───────────────────────────────────────────
    let extraction = coerceExtraction(
      await callClaude(EXTRACT_MODEL, buildExtractionPrompt(text), EXTRACTION_TOOL, 2048),
    );
    if (!extraction) {
      // one re-ask, then give up gracefully
      extraction = coerceExtraction(
        await callClaude(EXTRACT_MODEL, buildExtractionPrompt(text), EXTRACTION_TOOL, 2048),
      );
    }
    if (!extraction) return json({ error: "Couldn't read that message — try trimming it to the request itself." });
    // Items are the real signal; is_quote_request is only a tiebreaker for
    // itemless text. A bare size list carries no "asking" language and the
    // classifier is entitled to shrug — but if items were found, we draft.
    // (Joe's second local test: a raw size run got refused on this gate.)
    if (!extraction.items.length) {
      return json({ error: "No items found — add garment names or style numbers to the list." });
    }

    // ── context: customer + history (STRICTLY this shop's rows) ──────
    let customer: any = null;
    if (customerId) {
      const { data } = await db.from("customers")
        .select("id, name, company, email, phone")
        .eq("shop_owner", myShop).eq("id", customerId).maybeSingle();
      customer = data;
    }
    if (!customer) {
      // Try email exact first (strongest), then company/name ILIKE.
      const tryFind = async (col: string, val: string) => {
        if (!val) return null;
        const { data } = await db.from("customers")
          .select("id, name, company, email, phone")
          .eq("shop_owner", myShop).ilike(col, val).limit(1);
        return data?.[0] ?? null;
      };
      customer = await tryFind("email", extraction.customer_email)
        || await tryFind("company", extraction.company)
        || await tryFind("name", extraction.customer_name);
    }

    let historyText = "";
    if (customer) {
      const { data: orders } = await db.from("orders")
        .select("order_id, created_at, completed_date, line_items")
        .eq("shop_owner", myShop).eq("customer_id", customer.id)
        .order("created_at", { ascending: false }).limit(3);
      historyText = summarizeHistory(orders || []);
    }

    // Shop priors: most-used garment styles from recent quotes (weak hints).
    const { data: recentQuotes } = await db.from("quotes")
      .select("line_items").eq("shop_owner", myShop)
      .order("created_at", { ascending: false }).limit(15);
    const styleCounts = new Map<string, { n: number; label: string }>();
    for (const q of recentQuotes || []) {
      for (const li of (q.line_items as any[]) || []) {
        const key = `${li.brand || ""} ${li.style || ""}`.trim();
        if (!key || !li.style) continue;
        const cur = styleCounts.get(key) || { n: 0, label: `${key} (${li.styleName || ""})` };
        cur.n++;
        styleCounts.set(key, cur);
      }
    }
    const shopPriorsText = [...styleCounts.entries()]
      .sort((a, b) => b[1].n - a[1].n).slice(0, 5)
      .map(([, v]) => `- ${v.label} ×${v.n}`).join("\n");

    // ── pass 2: draft ────────────────────────────────────────────────
    const todayISO = new Date().toISOString().slice(0, 10);
    const draftPrompt = buildDraftPrompt({ extraction, historyText, todayISO, shopPriorsText });
    let draft = coerceDraft(await callClaude(DRAFT_MODEL, draftPrompt, DRAFT_TOOL, 4096));
    if (!draft) draft = coerceDraft(await callClaude(DRAFT_MODEL, draftPrompt, DRAFT_TOOL, 4096));
    if (!draft) return json({ error: "Couldn't build a draft from that message. It's saved nothing — try again or enter it manually." });

    // Deterministic dropped-item guard: the drafter merging lines is fine,
    // silently losing them is not. If the draft has fewer lines than the
    // extraction found items, make the shop confirm.
    if (draft.line_items.length < extraction.items.length) {
      draft.blanks.push(
        `The message mentioned ${extraction.items.length} item blocks but the draft has ${draft.line_items.length} line(s) — check nothing was dropped or wrongly merged.`,
      );
    }

    // Fill size curves where only a total was given (deterministic, not AI).
    for (const li of draft.line_items) {
      if (!Object.keys(li.sizes).length && li.total_qty > 0) {
        li.sizes = sizeCurve(li.total_qty);
        draft.assumptions.push(
          `Spread ${li.total_qty} pcs across a standard adult size curve for "${li.style_name || li.catalog_search || li.style_number}" — adjust to their real split.`,
        );
      }
    }

    // ── catalog candidates for unknown garments ──────────────────────
    // Sibling edge function (shopOwner path) so supplier auth stays in
    // one place. Failures degrade to "no candidates", never to an error.
    const fnBase = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
    for (const li of draft.line_items) {
      if (li.style_number || !li.catalog_search) continue;
      try {
        // The functions GATEWAY (not the function) rejects calls without an
        // Authorization header when the sibling was deployed with JWT
        // verification on — found live: {"code":"UNAUTHORIZED_NO_AUTH_HEADER"}.
        // Forward the caller's token + anon apikey exactly like the browser does.
        const res = await fetch(`${fnBase}/ssSearchCatalog`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
          },
          body: JSON.stringify({ query: li.catalog_search, limit: 8, accessToken }),
        });
        const data = res.ok ? await res.json() : null;
        // ssSearchCatalog returns { products } — found the hard way in the first
        // live test (candidates came back empty on every cold request).
        (li as any).candidates = shapeCandidates(data?.products || []);
      } catch (e) {
        console.error("[quoteDraft] catalog search failed:", (e as Error).message);
        (li as any).candidates = [];
      }
      if (!(li as any).candidates?.length) {
        draft.blanks.push(`Pick a garment for "${li.catalog_search}" — catalog search returned nothing usable.`);
      }
    }

    console.log(`[quoteDraft] shop=${myShop} customer=${customer?.id || "none"} lines=${draft.line_items.length} blanks=${draft.blanks.length}`);
    return json({
      ok: true,
      draft,
      customer: customer
        ? { id: customer.id, name: customer.name, company: customer.company, email: customer.email }
        : null,
      extraction: {
        customer_name: extraction.customer_name,
        company: extraction.company,
        customer_email: extraction.customer_email,
        phone: extraction.phone,
        deadline_text: extraction.deadline_text,
      },
    });
  } catch (e) {
    console.error("[quoteDraft] failed:", e instanceof Error ? e.message : e);
    return json({ error: "Drafting failed — nothing was saved. Try again." }, 500);
  }
});
