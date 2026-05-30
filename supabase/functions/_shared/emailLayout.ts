// Shared HTML wrapper for every email InkTracker sends via Resend.
// Matches the marketing-site theme (forest-green header, square corners,
// Anton-style headlines with web-safe fallbacks, Inter body) so a
// customer's first touch with the brand carries through into their inbox.
//
// Used by:
//   - sendQuoteEmail/index.ts  → quote sent to customer
//   - sendReply/index.ts        → shop's free-form reply to customer
//   - stripeWebhook/index.ts    → Stripe payment receipt (deposit + final)
//
// Supabase-managed templates (signup confirmation, password reset, magic
// link, broker invite) live in the Supabase dashboard and have to be
// pasted in manually. Their HTML mirrors this layout — see
// docs/email-templates/ in the repo.

// Brand tokens — must match the constants in src/App.jsx so the email
// reads as a continuation of the marketing site / app shell.
export const EMAIL_INK         = "#0e0e0e";
export const EMAIL_MUTED       = "#6b6b6b";
export const EMAIL_HAIRLINE    = "#e5e5e5";
export const EMAIL_FOREST      = "#2c5840";
export const EMAIL_FOREST_DARK = "#1a3a28";
export const EMAIL_BG_SOFT     = "#f5f5f3";

// 1024×1024 drop logo, served from www.inktracker.app. Email clients
// block inline base64 images above ~1 KB on many providers, so we link
// to a public asset instead. The canonical host is www. — the bare
// inktracker.app does a 307 redirect, and many mail clients (including
// Apple Mail's preview, Supabase's template preview, and several
// webmails) refuse to follow image redirects, rendering a broken icon.
export const EMAIL_LOGO_URL = "https://www.inktracker.app/icon-512.png";

const BODY_FONT =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Anton isn't web-safe inside email clients. Fall back through Impact /
// Arial Narrow Bold so we still get the condensed/uppercase feeling on
// the shop name + section headers even when Anton itself doesn't load.
const DISPLAY_FONT =
  "'Anton', 'Oswald', Impact, 'Arial Narrow Bold', 'Helvetica Neue Condensed', sans-serif";

export interface EmailLayoutOptions {
  shopName?: string;     // shown in the header bar (uppercase, condensed)
  subhead?: string;       // optional smaller text under the shop name
  contentHtml: string;    // the body — caller-built HTML
  footerHtml?: string;    // optional extra footer text above the powered-by line
  logoUrl?: string;       // override the header logo (shop emails pass the
                          // shop's logo_url; defaults to the InkTracker drop)
}

// Google-Fonts import so Anton + Inter render where supported (Apple
// Mail, iOS Mail, most webmails). Outlook desktop / some Gmail contexts
// strip <style>; for those, the inline `font-family` chains below fall
// through to Impact/Arial Narrow (display) and -apple-system/Helvetica
// (body) — closest web-safe approximations of the brand fonts.
const FONT_IMPORT_BLOCK = `<style type="text/css">
  @import url('https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&display=swap');
</style>`;

/**
 * Render the full email body HTML. Caller provides the inner content;
 * this function adds the header (logo + shop name), surrounding
 * white card with hairline border, and the powered-by footer.
 */
export function renderEmailLayout({
  shopName,
  subhead,
  contentHtml,
  footerHtml,
  logoUrl,
}: EmailLayoutOptions): string {
  const safeShop = (shopName || "InkTracker").replace(/[<>]/g, "");
  const safeSubhead = subhead ? subhead.replace(/[<>]/g, "") : "";
  const headerLogo = logoUrl && /^https?:\/\//.test(logoUrl) ? logoUrl : EMAIL_LOGO_URL;

  return `
${FONT_IMPORT_BLOCK}
<div style="background-color:${EMAIL_BG_SOFT};padding:24px 16px;margin:0;font-family:${BODY_FONT};">
  <div style="max-width:560px;margin:0 auto;background-color:#ffffff;border:1px solid ${EMAIL_HAIRLINE};">

    <!-- Header — forest green bar with the logo and the shop name. -->
    <div style="background-color:${EMAIL_FOREST_DARK};padding:24px 28px;text-align:left;">
      <table role="presentation" style="border-collapse:collapse;width:100%;">
        <tr>
          <td style="vertical-align:middle;width:52px;padding-right:14px;">
            <img src="${headerLogo}" alt="" width="44" height="44" style="display:block;border:0;outline:none;text-decoration:none;max-width:44px;max-height:44px;object-fit:contain;" />
          </td>
          <td style="vertical-align:middle;">
            <div style="color:#ffffff;font-family:${DISPLAY_FONT};font-size:22px;line-height:1.1;letter-spacing:0.04em;text-transform:uppercase;font-weight:700;">${safeShop}</div>
            ${safeSubhead ? `<div style="color:rgba(255,255,255,0.7);font-size:12px;line-height:1.4;margin-top:4px;letter-spacing:0.04em;text-transform:uppercase;font-family:${BODY_FONT};">${safeSubhead}</div>` : ""}
          </td>
        </tr>
      </table>
    </div>

    <!-- Body — caller-rendered content. -->
    <div style="padding:32px 28px;color:${EMAIL_INK};font-size:15px;line-height:1.65;">
      ${contentHtml}
    </div>

    <!-- Footer — hairline divider, optional caller note, powered-by line. -->
    <div style="border-top:1px solid ${EMAIL_HAIRLINE};padding:18px 28px;background-color:#ffffff;">
      ${footerHtml ? `<p style="margin:0 0 10px;color:${EMAIL_MUTED};font-size:11px;line-height:1.55;">${footerHtml}</p>` : ""}
      <p style="margin:0;color:${EMAIL_MUTED};font-size:11px;line-height:1.55;">
        Powered by
        <a href="https://www.inktracker.app" style="color:${EMAIL_FOREST};text-decoration:none;font-weight:600;">InkTracker</a>
      </p>
    </div>

  </div>
</div>
`;
}

/**
 * Square-cornered button used for CTAs (View Quote, Approve, Pay).
 * Caller passes label + href. Background is the forest accent.
 */
export function renderEmailButton(label: string, href: string): string {
  const safeLabel = label.replace(/[<>]/g, "");
  return `
<div style="text-align:center;margin:24px 0;">
  <a href="${href}"
     style="display:inline-block;background-color:${EMAIL_FOREST};color:#ffffff;font-family:${BODY_FONT};font-size:14px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;padding:14px 32px;text-decoration:none;border:0;">
    ${safeLabel}
  </a>
</div>`;
}

/**
 * Total / amount highlight block — forest accent, prominent.
 * Used by sendQuoteEmail + stripeWebhook for "Quote Total" / "Amount Paid".
 */
export function renderEmailHighlight(label: string, amount: string): string {
  return `
<div style="background-color:${EMAIL_BG_SOFT};border:1px solid ${EMAIL_HAIRLINE};padding:18px 20px;margin:0 0 24px;text-align:center;">
  <div style="color:${EMAIL_MUTED};font-family:${DISPLAY_FONT};font-size:11px;letter-spacing:0.22em;text-transform:uppercase;margin:0 0 6px;">${label}</div>
  <div style="color:${EMAIL_FOREST_DARK};font-size:30px;font-weight:800;margin:0;">${amount}</div>
</div>`;
}
