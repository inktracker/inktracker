// Email built by billingWebhook's customer.subscription.updated handler when a
// shop's subscription FIRST transitions to cancel_at_period_end=true (the
// false→true guard in isCancellationNewlyScheduled). Warm, no guilt-trip: their
// plan is set to end, their data stays put, and they can resume anytime.
//
// Lives in _shared/ so the shape is unit-testable without Deno/Resend, next to
// trialWillEndEmail.js.

const APP_URL = (typeof Deno !== "undefined" ? Deno.env.get("APP_URL") : "") ||
                (typeof Deno !== "undefined" ? Deno.env.get("VITE_APP_URL") : "") ||
                "https://www.inktracker.app";

/**
 * Build the "your plan is set to end" email.
 *
 * @param {object} args
 * @param {string} args.shopName  Display name (falls back to "your shop")
 * @param {string} args.endsOn    Already-formatted human date ("July 9, 2026") or null
 * @returns {{ subject: string, html: string }}
 */
export function buildCancellationScheduledEmail({ shopName, endsOn } = {}) {
  const name = (shopName && shopName.trim()) || "your shop";
  const dateLine = endsOn
    ? `Your InkTracker plan is set to end on <strong>${endsOn}</strong>.`
    : `Your InkTracker plan is set to end at the close of your billing period.`;

  const billingUrl = `${APP_URL}/Account?billing=1`;

  const subject = `Your InkTracker plan is set to end`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #0f172a;">
      <h2 style="font-size: 20px; margin: 0 0 12px;">We got your cancellation</h2>
      <p style="font-size: 15px; line-height: 1.6; margin: 0 0 12px;">
        ${dateLine} You'll keep full access to ${name} until then — nothing changes before that date.
      </p>
      <p style="font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
        Your quotes, orders, and customers stay right where they are. If you change
        your mind, you can resume anytime — no need to set anything back up.
      </p>
      <a href="${billingUrl}" style="display: inline-block; background: #0d9488; color: white; text-decoration: none; font-weight: 600; padding: 10px 18px; border-radius: 10px; font-size: 14px;">
        Resume subscription
      </a>
      <p style="font-size: 12px; color: #64748b; margin: 24px 0 0;">
        Questions? Just reply to this email.
      </p>
    </div>
  `;

  return { subject, html };
}
