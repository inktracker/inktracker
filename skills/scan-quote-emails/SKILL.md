---
name: scan-quote-emails
description: "Scan Joe's Gmail inbox for quote requests and have InkTracker auto-draft quotes for review. Use whenever the user asks to check email for quote requests, draft quotes from email, see what's in the inbox needing quoting, look for new orders, or anything along the lines of 'any new quotes come in?', 'check my email', 'scan for quote requests', 'pull quotes from gmail', 'what came in overnight'. Also use proactively at the start of a session when the user mentions getting back to work or asks 'what's on my plate' — fresh email-driven drafts are usually the most time-sensitive thing on a screen-print shop's plate."
---

# scan-quote-emails

Pull recent Gmail messages, parse the ones that look like quote requests, and create draft quotes in InkTracker. Then summarize what was created so Joe can review and edit before sending.

## What this skill does

1. **Triggers an InkTracker scan** — calls the `emailScanner` Supabase edge function with `action: "scanEmails"`. The function pulls the last 7 days from Joe's Gmail (excluding his own sends, promotions, and known noise senders), runs each through the keyword/Gemini parser, dedupes against existing quotes, and inserts drafts.

2. **Surfaces the result in chat** — reports `scanned`, `quotesCreated`, the list of new drafts (customer, subject, quote ID), and any skipped items with reasons. Includes direct links to each draft.

3. **Reminds Joe what's next** — drafts have `status: "Draft"` and `source: "email"`. Joe needs to review, fill in pricing details, and send. The skill should make that next step obvious.

## How to invoke the scanner

The scanner lives at `https://skmltfbibaqcjddmeqvi.supabase.co/functions/v1/emailScanner` and requires a Supabase user JWT (Joe's session token). Two ways to get the token:

### Option A — pull token from the browser tab (preferred)

If Joe has InkTracker open in Chrome (check via `mcp__Claude_in_Chrome__tabs_context_mcp`), grab the access token from localStorage:

```javascript
// in a javascript_tool call against the inktracker tab
JSON.parse(localStorage.getItem('sb-skmltfbibaqcjddmeqvi-auth-token'))?.access_token
```

Then POST:

```bash
curl -X POST https://skmltfbibaqcjddmeqvi.supabase.co/functions/v1/emailScanner \
  -H "Content-Type: application/json" \
  -d '{"action":"scanEmails","accessToken":"<JWT>"}'
```

### Option B — drive the UI

If no token is available (no tab open / not logged in), navigate Chrome to `https://inktracker.vercel.app/Account`, expand "Gmail Quote Scanner", click "Scan for Quote Requests", wait ~10s, then read the result panel. Slower but works without token extraction.

If Chrome isn't available either, tell Joe to click the button himself — don't fall back to anything else.

## Reading the response

The scanner returns:

```json
{
  "scanned": 12,
  "quotesCreated": 2,
  "results": [
    {"subject": "Need 50 hoodies", "from": "Sara at Tahoe Co", "quoteId": "Q-2026-AB12"}
  ],
  "skipped": [
    {"from": "...", "subject": "...", "reason": "already processed"},
    {"from": "...", "subject": "...", "reason": "not a quote request"},
    {"from": "...", "subject": "...", "reason": "recent quote exists for this sender"}
  ]
}
```

`quotesCreated: 0` is a normal outcome — it means nothing new came in, not that the skill broke.

## Reporting format

Keep it short. Joe doesn't want a wall of text every time he asks.

**When new drafts were created (the interesting case):**

```
Drafted N quote(s) from your inbox:
  • Q-2026-AB12 — Sara at Tahoe Co — "Need 50 hoodies"
    https://inktracker.vercel.app/Quotes (filter: Draft)
  • Q-2026-CD34 — Mike — "Crew tees for the wedding"
    https://inktracker.vercel.app/Quotes (filter: Draft)

Open Quotes to fill in pricing and send.
```

**When nothing new:**

```
Scanned 12 emails — nothing new to draft. (Skipped: 8 already-processed, 3 not quote requests, 1 recent dupe.)
```

Don't list every skipped email by default — only surface them if Joe asks.

## Edge cases

- **Token expired** — if the API returns `{"error": "Gmail not connected or token expired"}`, the Gmail OAuth refresh failed. Tell Joe to re-connect at `/Account` → Gmail Quote Scanner → Connect Gmail.
- **No emails at all** — `scanned: 0` means Gmail returned no messages matching the search filter (last 7 days, inbox, not noise). Probably normal during slow weeks.
- **Customer not in InkTracker** — drafts will have `customer_name` from the email header but `customer_id: null`. That's fine; Joe can attach a customer when he edits the quote. Don't try to auto-create customers — that's his judgment call.
- **Multiple line items in one email** — parser handles this. Each garment becomes a line item with whatever sizes/colors it could extract. Sizes the parser couldn't read will be empty for Joe to fill in.

## Why a manual review step

Quotes need pricing applied (garment cost lookup, print location pricing, deposit %, tax). The parser doesn't price — it just structures the request. So every draft is genuinely a draft until Joe sets prices and clicks Send. The scanner is a research-and-prep tool, not an autopilot.

## Companion: schedule

If Joe wants this to run on its own (not just when he asks), use the `schedule` skill to run this skill on an interval — e.g., every 2 hours during business days. Suggest this if he scans more than once or twice in a session.
