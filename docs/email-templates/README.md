# InkTracker Email Templates

Two kinds of email leave InkTracker, themed identically:

1. **In-code emails** — quotes, replies, Stripe receipts. Sent via Resend from edge functions. The HTML is generated in code by `supabase/functions/_shared/emailLayout.ts`. Edit that file to change the theme; all three in-code emails follow it automatically.

2. **Supabase-managed auth emails** — signup confirmation, password reset, magic link, broker invite. These live in the **Supabase Dashboard → Authentication → Email Templates**. Supabase renders them at send time and substitutes its own template variables (e.g. `{{ .ConfirmationURL }}`). They can't be deployed via code.

This directory holds the HTML for the Supabase-managed templates so the theme stays in sync.

## How to update the Supabase templates

1. Open https://supabase.com/dashboard/project/skmltfbibaqcjddmeqvi/auth/templates
2. For each template (Confirm signup, Magic Link, Reset Password, Invite User):
   - Copy the matching `.html` file in this directory
   - Paste into the dashboard's HTML editor
   - Update the Subject line if needed (see top of each file)
   - Click **Save**
3. Send yourself a test for each one to verify rendering in Gmail / Apple Mail / Outlook web.

If you change the look in `_shared/emailLayout.ts`, update these files too — they're hand-written copies of the same layout because Supabase can't import shared code.

## Template variables

Supabase substitutes these at send time. Don't change them.

| Variable               | Where it appears                |
|------------------------|--------------------------------|
| `{{ .ConfirmationURL }}` | All four templates             |
| `{{ .Email }}`         | All four templates             |
| `{{ .SiteURL }}`       | Footer links (optional)        |
| `{{ .Token }}`         | OTP code (we don't use it)     |
