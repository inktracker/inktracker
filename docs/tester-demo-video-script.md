# InkTracker — Tester Demo Video Script

A ~2-minute screen-record walkthrough for shop owners you're inviting to test. Pair with `tester-onboarding.md`.

**Tone:** conversational, no marketing-speak. Talk to one person, not an audience. Pause briefly when clicking through screens so the viewer can follow.

**Setup before recording:**
- Use a throwaway shop account (don't show Biota's real data).
- Have a sandbox or test QuickBooks account ready to connect.
- Close all browser tabs except the one you're recording.
- Camera off; it's a screen demo, not a face-cam pitch.
- Quiet room, headset mic if you have one.

---

## Cold open — 0:00–0:10

**On screen:** Landing page at https://www.inktracker.app

> Hey, Joe here at Biota. I built InkTracker because we've spent ten years running a print shop on software that didn't quite fit. This is a two-minute walkthrough of how the QuickBooks side works, so you know what you're signing up for.

---

## Sign up + onboarding — 0:10–0:30

**On screen:** Click "Start free trial." Throwaway email. Email confirmation. Land on dashboard.

> Signup's standard — email, confirm, you're in. Fourteen-day trial, no card. The onboarding wizard asks for your shop name, tax rate, and time zone — about ninety seconds.

**On screen:** Optional — quickly show the dashboard after onboarding completes.

> The wizard doesn't deep-link you to QuickBooks setup yet. You finish, you land on the dashboard, then you head to Account to connect.

---

## Turn on 2FA first — 0:30–0:45

**On screen:** Account → Security tab → enable email sign-in code → enter test code → confirm.

> Before we touch QuickBooks, I'd turn on two-factor. Account, Security, enable email sign-in code. Next time you sign in you'll get a six-digit code by email. There's a "remember this device for thirty days" checkbox so you're not typing a code every morning.

---

## Connect QuickBooks — 0:45–1:25

**On screen:** Account → Integrations → click Connect QuickBooks → Intuit OAuth flow → approve → land back on Account with green "Connected" badge.

> Then the main event. Account, Integrations, Connect QuickBooks. The OAuth flow opens in a new tab — log in to your real QBO account, pick the company you want to connect, authorize, done. You land back here with a green Connected badge.

**On screen:** Briefly hover on the Disconnect button.

> Disconnect any time. We ask for a six-digit code to confirm so a stolen session can't yank your QB connection. Your already-synced invoices stay in QuickBooks — disconnecting just stops future syncs.

---

## The auto-email gotcha — 1:25–1:50

**On screen:** Quote detail modal → click "Create QB Invoice" → confirm dialog appears → cancel out without confirming.

> Here's the one thing I want you to hear from me directly. When you create a QuickBooks invoice from InkTracker, QuickBooks emails your customer right away. There's no draft mode — the only API endpoint that mints the customer payment link also sends them the email. We put a confirm dialog on every Create Invoice button so you won't accidentally fire one off, but if you want a true draft, you do it in QuickBooks itself and let us pick it up on the next sync.

---

## Customer pays — 1:50–2:10

**On screen:** Optional — show the QB-side payment portal the customer would receive, OR show a quote whose status flipped to "Approved and Paid" after a webhook.

> When the customer pays through the QuickBooks link, a webhook fires back here and the quote automatically flips to "Approved and Paid" and converts to an order. You don't have to babysit it.

---

## Outro — 2:10–2:25

**On screen:** Back to dashboard, then to email client showing joe@biotamfg.co address.

> That's the QB side. If anything breaks — anything at all — email me at joe@biotamfg.co. I usually respond within a few hours during business hours. Thanks for being one of the first shops to take this for a real run.

---

## Trims if you need to come in under 2 minutes

- Drop the dashboard glance at 0:25 (saves ~5s)
- Combine 2FA into "I'd also recommend turning on email two-factor under Account, Security" without showing the flow (saves ~10s)
- Skip the optional QB-side payment portal at 1:50 — just show the InkTracker quote status changing (saves ~10s)

## Trims for an even tighter App Store submission cut (~60s)

If you also want to repurpose this for the Intuit App Store Loom demo (which has a strict 60-second feel):

1. Cold open (5s) — "This is InkTracker, a print-shop workflow tool with QuickBooks Online integration."
2. Connect QB (25s) — Account → Integrations → OAuth → green badge
3. Send a quote (15s) — show "Create QB Invoice" → confirm dialog appears
4. Disconnect (10s) — show the step-up code prompt
5. Outro (5s) — "Listed soon at apps.intuit.com — InkTracker, by Biota Manufacturing."
