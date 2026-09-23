# InkTracker — TODO

## Post-launch ideas

### In-app onboarding assistant (built, not deployed)
Floating chat bubble that helps new shop owners get set up. Code is already in place:
- `supabase/functions/onboardingAssistant/index.ts` — edge function, proxies Claude
- `src/components/onboarding/OnboardingAssistant.jsx` — chat bubble UI
- Wired into `src/Layout.jsx`, registered in `supabase/config.toml`

**Holding deployment until the rest of the app is stable.** When ready:
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy onboardingAssistant
npx vercel --prod
```

### Native apps (desktop + mobile)
After launch, wrap the existing Vite/React app:
- **Mobile (iOS + Android):** Capacitor
- **Desktop (Mac/Windows/Linux):** Tauri (preferred over Electron — smaller bundles)
- **Quick-win alternative:** ship as a PWA first to see if users actually want native

Costs: Apple Developer $99/yr, Google Play $25 one-time, Windows code-signing cert ~$70-200/yr (optional).

### Wire actual payment-processor onboarding into the setup wizard
**File:** `src/components/OnboardingWizard.jsx` step 4 (Email & Payments)

Today the wizard shows Stripe Payments as an "Available — set up later from Account → Stripe Payments" badge. Connect, status, and dashboard flows all live on `/Account` already (gated to admin/shop by PR #69 / #73), but the onboarding step doesn't link people through to them.

**Stripe Connect (priority — already implemented backend-side):**
- Add a "Connect Bank Account" button next to the Stripe badge that triggers the same `billing` edge-fn action=`connectStripe` flow used on /Account
- Returns an Account Link → redirect into Stripe's Express onboarding
- On return, the existing `/Account?stripe_connect=return` handler picks up the state
- Tricky bit: Stripe Express onboarding is several screens long and external — losing the wizard's progress could be annoying. Options: (a) defer Stripe to a follow-up screen after onboarding completes, (b) save wizard progress server-side so users can resume, (c) skip the button and lean on the post-onboarding Account page nudge.

**Square (future, no backend yet):**
- Plausible alt for shops that already use Square for in-person sales
- Square's OAuth flow is similar shape to QuickBooks
- Would need: a new edge function (`squareOAuthCallback` + `squareSync`), new profile columns (`square_access_token`, `square_refresh_token`, `square_merchant_id`), and a Connect button in the wizard
- Pricing parity: Square's API is free for partners; per-transaction processing fees are Square's normal rate. No real reason not to support it eventually if 2+ shops ask.

**Build only after seeing real signups stall at this step.** If shops keep skipping payments and never coming back to set them up, the wizard handoff is the place to fix it. If they reliably set up Stripe via /Account post-onboarding, the current "set up later" badge is fine.

---

### Paperclip for ops automation (https://paperclip.ing)
Once there are paying customers, use Paperclip to orchestrate AI agents for repetitive ops work:
- Support agent — drafts replies to common inbox questions
- Customer success agent — flags stuck trial users, drafts personalized outreach
- Marketing agent — blog posts, scheduled tweets, competitor monitoring
- Sales ops agent — follow-ups on abandoned signups

Paperclip is self-hosted (`npx paperclipai onboard --yes`), MIT-licensed, bring-your-own-agents. **Don't build this until 2-3 specific repetitive tasks have emerged from real ops work** — otherwise it's just busywork dressed up as automation.
