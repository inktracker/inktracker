// Welcome email for self-serve shop signups — the first thing InkTracker
// ever sends the OWNER (until now they got silence: the signup notify
// goes to the platform admin, invite emails only cover invited team
// members, and MFA codes are transactional).
//
// Pure builder — notifySignup does the I/O. Kept separate so the copy
// and structure are unit-testable without Deno/Resend.
//
// reply_to is the platform admin: for a new product, a reply that lands
// with a human IS the support channel.

import {
  renderEmailLayout,
  renderEmailButton,
  EMAIL_MUTED,
  EMAIL_FOREST,
  EMAIL_HAIRLINE,
} from "./emailLayout.ts";
import { escapeHtml } from "./emailSanitize.js";

const APP_URL = "https://www.inktracker.app";

export interface WelcomeEmailInput {
  email: string;
  shopName?: string | null;
}

export function buildWelcomeEmail({ email, shopName }: WelcomeEmailInput): {
  subject: string;
  html: string;
} {
  const shop = (shopName || "").trim();
  const greeting = shop ? `Welcome, ${escapeHtml(shop)}!` : "Welcome to InkTracker!";

  const step = (n: number, title: string, body: string) => `
    <table role="presentation" style="border-collapse:collapse;width:100%;margin:0 0 14px;">
      <tr>
        <td style="vertical-align:top;width:34px;">
          <div style="width:24px;height:24px;background:${EMAIL_FOREST};color:#fff;font-size:13px;font-weight:700;text-align:center;line-height:24px;">${n}</div>
        </td>
        <td style="vertical-align:top;">
          <div style="font-weight:700;font-size:14px;">${title}</div>
          <div style="color:${EMAIL_MUTED};font-size:13px;line-height:1.55;margin-top:2px;">${body}</div>
        </td>
      </tr>
    </table>`;

  const contentHtml = `
    <h1 style="margin:0 0 6px;font-size:20px;line-height:1.3;">${greeting}</h1>
    <p style="margin:0 0 18px;color:${EMAIL_MUTED};">
      Your 14-day free trial is live — every feature included, nothing gated.
      Here's the fastest way to see what InkTracker does for your shop:
    </p>

    ${step(1, "Set your pricing",
      "Load your price grid once — screen print tiers, embroidery stitch counts, garment markups — and every quote after that prices itself.")}
    ${step(2, "Send your first quote",
      "Build it in the quote editor; your customer gets a clean branded page where they can approve and pay online.")}
    ${step(3, "Connect QuickBooks (optional)",
      "Invoices, payments, and customers sync both ways, so the books keep themselves.")}

    <div style="margin:24px 0;">${renderEmailButton("Open InkTracker", APP_URL)}</div>

    <p style="margin:0;padding-top:16px;border-top:1px solid ${EMAIL_HAIRLINE};color:${EMAIL_MUTED};font-size:13px;line-height:1.6;">
      Questions, stuck, or just want to tell us what your shop needs?
      Reply to this email — it goes straight to a real person, not a ticket queue.
    </p>`;

  return {
    subject: "Welcome to InkTracker — your trial is live",
    html: renderEmailLayout({
      shopName: "InkTracker",
      subhead: "Print shop management",
      contentHtml,
      footerHtml: `Sent because ${escapeHtml(email)} signed up at inktracker.app.`,
    }),
  };
}
