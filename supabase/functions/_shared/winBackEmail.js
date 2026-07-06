// Email built by billingWebhook's customer.subscription.deleted handler — sent
// inline the moment a subscription actually ends (access has lapsed). Short and
// kind: their data is saved, and resubscribing is one click. A delayed drip
// sequence can come later; this is the immediate first touch.
//
// Lives in _shared/ so the shape is unit-testable without Deno/Resend, next to
// trialWillEndEmail.js.

const APP_URL = (typeof Deno !== "undefined" ? Deno.env.get("APP_URL") : "") ||
                (typeof Deno !== "undefined" ? Deno.env.get("VITE_APP_URL") : "") ||
                "https://www.inktracker.app";

/**
 * Build the win-back email sent when access ends.
 *
 * @param {object} args
 * @param {string} args.shopName  Display name (falls back to "your shop")
 * @returns {{ subject: string, html: string }}
 */
export function buildWinBackEmail({ shopName } = {}) {
  const name = (shopName && shopName.trim()) || "your shop";
  const billingUrl = `${APP_URL}/Account?billing=1`;

  const subject = `${name} — your data's still here whenever you're ready`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #0f172a;">
      <h2 style="font-size: 20px; margin: 0 0 12px;">Your InkTracker plan has ended</h2>
      <p style="font-size: 15px; line-height: 1.6; margin: 0 0 12px;">
        Access to ${name} has wrapped up — but nothing's gone. Your quotes, orders,
        customers, and history are all saved exactly as you left them.
      </p>
      <p style="font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
        Whenever you want back in, it's one click — you'll pick up right where you
        left off.
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
