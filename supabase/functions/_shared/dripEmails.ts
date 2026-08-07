// Trial lifecycle drip emails — the two sends between the day-0 welcome
// (notifySignup → welcomeEmail.ts) and conversion:
//
//   day-2 activation nudge  → trialing shops that haven't created a quote
//   trial-ending reminder   → trialing shops with ≤3 days left
//
// Pure builders — lifecycleDrip/index.ts does the selection, dedup, and
// I/O. Kept separate so copy and structure are unit-testable without
// Deno/Resend (same split as welcomeEmail.ts).
//
// reply_to on both is the platform admin: for a new product, a reply
// that lands with a human IS the support channel.

import {
  renderEmailLayout,
  renderEmailButton,
  EMAIL_MUTED,
  EMAIL_HAIRLINE,
} from "./emailLayout.ts";
import { escapeHtml } from "./emailSanitize.js";

const APP_URL = "https://www.inktracker.app";

export interface DripEmailInput {
  email: string;
  shopName?: string | null;
}

export interface TrialEndingInput extends DripEmailInput {
  daysLeft: number; // 0 = ends today
}

const supportFooter = `
    <p style="margin:0;padding-top:16px;border-top:1px solid ${EMAIL_HAIRLINE};color:${EMAIL_MUTED};font-size:13px;line-height:1.6;">
      Stuck on anything? Reply to this email — it goes straight to a real
      person, not a ticket queue.
    </p>`;

// ── Day-2: first-quote nudge (only sent when the shop has 0 quotes) ──
export function buildDay2NudgeEmail({ email, shopName }: DripEmailInput): {
  subject: string;
  html: string;
} {
  const shop = (shopName || "").trim();
  const contentHtml = `
    <h1 style="margin:0 0 6px;font-size:20px;line-height:1.3;">Your first quote takes about two minutes</h1>
    <p style="margin:0 0 14px;color:${EMAIL_MUTED};line-height:1.6;">
      ${shop ? `${escapeHtml(shop)} is` : "You're"} set up — the fastest way to
      see what InkTracker actually does is to build one real quote. Pick a job
      you've already priced by hand and run it through the quote editor:
      garments pull live supplier costs, print pricing comes off your tiers,
      and the total just falls out.
    </p>
    <p style="margin:0 0 18px;color:${EMAIL_MUTED};line-height:1.6;">
      When you send it, your customer gets a clean branded page where they can
      approve and pay online — no PDF attachments, no "did you get my email?"
    </p>
    <div style="margin:24px 0;">${renderEmailButton("Create a quote", `${APP_URL}/Quotes`)}</div>
    ${supportFooter}`;

  return {
    subject: "Your first quote takes about two minutes",
    html: renderEmailLayout({
      shopName: "InkTracker",
      subhead: "Print shop management",
      contentHtml,
      footerHtml: `Sent because ${escapeHtml(email)} is on an InkTracker free trial.`,
    }),
  };
}

// ── Trial ending: honest heads-up with the two outcomes spelled out ──
export function buildTrialEndingEmail({ email, shopName, daysLeft }: TrialEndingInput): {
  subject: string;
  html: string;
} {
  const shop = (shopName || "").trim();
  const when =
    daysLeft <= 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`;

  const contentHtml = `
    <h1 style="margin:0 0 6px;font-size:20px;line-height:1.3;">Your free trial ends ${when}</h1>
    <p style="margin:0 0 14px;color:${EMAIL_MUTED};line-height:1.6;">
      ${shop ? `${escapeHtml(shop)}'s` : "Your"} 14-day trial is almost up. To
      keep creating quotes and orders, pick a plan — it's one flat price,
      $99/mo or $999/yr, every feature and unlimited team members included.
    </p>
    <p style="margin:0 0 18px;color:${EMAIL_MUTED};line-height:1.6;">
      If the timing isn't right, that's fine too: your account switches to
      view-only, nothing is deleted, and everything you entered — customers,
      quotes, orders — stays exportable and waiting whenever you're ready.
    </p>
    <div style="margin:24px 0;">${renderEmailButton("Choose a plan", `${APP_URL}/Account?billing=1`)}</div>
    ${supportFooter}`;

  return {
    subject:
      daysLeft <= 0
        ? "Your InkTracker trial ends today"
        : daysLeft === 1
          ? "Your InkTracker trial ends tomorrow"
          : `Your InkTracker trial ends in ${daysLeft} days`,
    html: renderEmailLayout({
      shopName: "InkTracker",
      subhead: "Print shop management",
      contentHtml,
      footerHtml: `Sent because ${escapeHtml(email)} is on an InkTracker free trial.`,
    }),
  };
}
