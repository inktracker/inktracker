// Email built by the billingWebhook's customer.subscription.trial_will_end
// handler. Stripe fires that event 3 days before a subscription's trial
// period ends. Since trialPeriodDaysForCheckout syncs Stripe's trial
// with the user's remaining in-app trial, this email lands 3 days
// before they'd flip from trial → standard ($99) or trial → annual
// ($999) billing.
//
// Lives in _shared/ so the unit-testable shape is one import away from
// any future cron / scheduled reminder we add for users who never
// subscribed through Stripe checkout (today the in-app banner covers
// that case).

const APP_URL = (typeof Deno !== "undefined" ? Deno.env.get("APP_URL") : "") ||
                (typeof Deno !== "undefined" ? Deno.env.get("VITE_APP_URL") : "") ||
                "https://www.inktracker.app";

/**
 * Build the email body for a trial-will-end reminder.
 *
 * @param {object} args
 * @param {string} args.shopName       Display name (falls back to "your shop")
 * @param {string} args.trialEndsOn    Already-formatted human date ("June 9, 2026") or null
 * @returns {{ subject: string, html: string }}
 */
export function buildTrialWillEndEmail({ shopName, trialEndsOn } = {}) {
  const name = (shopName && shopName.trim()) || "your shop";
  const dateLine = trialEndsOn
    ? `Your InkTracker free trial ends on <strong>${trialEndsOn}</strong>.`
    : `Your InkTracker free trial is ending in a few days.`;

  const billingUrl = `${APP_URL}/Account?billing=1`;

  const subject = `Your InkTracker trial ends in 3 days`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #0f172a;">
      <h2 style="font-size: 20px; margin: 0 0 12px;">Heads up — trial ending soon</h2>
      <p style="font-size: 15px; line-height: 1.6; margin: 0 0 12px;">
        ${dateLine}
      </p>
      <p style="font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
        Pick a plan to keep ${name} running without interruption — monthly $99/mo
        or annual $999/yr.
      </p>
      <a href="${billingUrl}" style="display: inline-block; background: #0d9488; color: white; text-decoration: none; font-weight: 600; padding: 10px 18px; border-radius: 10px; font-size: 14px;">
        Choose a plan
      </a>
      <p style="font-size: 12px; color: #64748b; margin: 24px 0 0;">
        Questions? Just reply to this email.
      </p>
    </div>
  `;

  return { subject, html };
}
