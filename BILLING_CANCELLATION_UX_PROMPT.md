# Surface pending cancellations + add cancellation / win-back emails

Right now a shop that cancels goes silently dark at period end: the webhook ignores `cancel_at_period_end`, so there's no "your plan ends on X" state anywhere, and the only lifecycle email we send is the trial-will-end reminder. This adds (1) a stored pending-cancellation state + in-app banner, and (2) two lifecycle emails (cancellation scheduled, and win-back after it ends). Retention is our biggest lever — this is the cheap first pass at it.

Branch `feat/cancellation-ux`. Keep `npm test` green. **Do NOT deploy** — edge functions are a separate deploy target (see CLAUDE.md) and I'll ship it. Report files changed + the migration name.

## Guardrails (read first)
- **Verify DB columns before writing them.** This needs a migration (below) — the new fields don't exist yet. Don't add them to any insert/update payload before the migration is in the branch.
- **Don't break webhook idempotency.** The dedup claim in `billingWebhook/index.ts` stays exactly as-is. New side effects go *inside* the existing `switch`, and any email send must be best-effort (a Resend failure must not return non-2xx — mirror the `trial_will_end` handler's try/catch).
- **Keep the three-way billing logic in lockstep.** If you touch access logic, the SQL `has_active_subscription()`, `_shared/billingLogic.js`, and `src/lib/billing.js` must stay mirrored. This change is mostly *additive display state*, so avoid altering the access gate at all.
- Single flat plan, Stripe cancel-at-period-end flow. This does not change cancellation behavior — only visibility and comms.

## 1. Migration — store the pending cancellation
Add a migration `supabase/migrations/<timestamp>_cancellation_state.sql`:
- `profiles.cancel_at_period_end boolean NOT NULL DEFAULT false`
- `profiles.subscription_ends_at timestamptz` (nullable — the date access actually ends when a cancel is pending)

No RLS change (these are read via the same profile row the app already reads). Confirm the profile SELECT paths already return `*` or add the columns to the explicit selects in `AuthContext`.

## 2. Webhook — capture + clear the state (`billingWebhook/index.ts`)
Add a small **pure** helper in `_shared/billingLogic.js` (unit-tested, no SDK):
```
// Maps a Stripe subscription to the pending-cancellation fields we persist.
// current_period_end is unix seconds → ISO. When not canceling, fields clear.
export function cancellationFieldsFromSubscription(sub) {
  const pending = Boolean(sub?.cancel_at_period_end);
  const endsAt = pending && sub?.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;
  return { cancel_at_period_end: pending, subscription_ends_at: endsAt };
}
```
In the **`customer.subscription.updated`** case: after the existing status logic, also apply `cancellationFieldsFromSubscription(sub)` via `updateProfileByCustomer`. This both sets the fields when a cancel is scheduled AND clears them if the shop un-cancels (Stripe fires `updated` with `cancel_at_period_end:false`).

In the **`customer.subscription.deleted`** case: also set `cancel_at_period_end:false, subscription_ends_at:null` (the pending state is now realized as `expired`).

**Transition guard for the email** (don't email on every `updated` — Stripe fires it for many reasons): only send the "cancellation scheduled" email when the flag *transitions* false→true. Read the profile's current `cancel_at_period_end` before updating; send only if it was false/absent and is now true. Mirror the `markPastDue` COALESCE pattern (check-then-act).

## 3. Emails (best-effort, logged)
Add two templates in `_shared/` next to `trialWillEndEmail.js`, and send via the existing `sendAndLogApprovalNotification` helper so they land in `notification_log`:
- **`buildCancellationScheduledEmail({ shopName, endsOn })`** — event_type `cancellation_scheduled`. Warm, printer-voice: their plan is set to end on `endsOn`, their data stays put, and they can resume anytime (link to the billing portal / account page). No guilt-trip.
- **`buildWinBackEmail({ shopName })`** — event_type `winback`. Sent from the `customer.subscription.deleted` handler. Access has ended, data is saved, one-click resubscribe. Keep it short and kind.

Sender: the platform billing sender (FROM `quotes@inktracker.app` is fine — verified domain), TO the shop owner (`profiles.shop_owner`). These are InkTracker→owner, so no Reply-To-to-owner. Both sends wrapped in try/catch — log and swallow, never 5xx the webhook.

(If a scheduled task for a *delayed* win-back is easy, skip it for now — send the win-back inline on `subscription.deleted`. A drip sequence can come later.)

## 4. In-app banner (frontend)
- Add `cancel_at_period_end` + `subscription_ends_at` to the owner-subscription fields carried in `resolveTeamSubscription` (so team members see the same notice the owner does) and to whatever `AuthContext` selects.
- New component `src/components/CancellationBanner.jsx` (model it on `TrialStatusBanner.jsx`): shows only when `cancel_at_period_end === true` and `subscription_ends_at` is in the future. Copy: "Your InkTracker plan ends on {date}. You'll keep full access until then." + a "Resume subscription" button that opens the Stripe billing portal (reuse the existing `portal` action). Informational styling, not alarming. Render it wherever `TrialStatusBanner` renders.
- This is **display only** — do not change `getEffectiveTier` / `canAccess` / `isReadOnly`. A pending cancel is still `active` until it isn't.

## 5. Tests
- Unit-test `cancellationFieldsFromSubscription` (pending true→date, false→nulls, missing period_end→null) in `_shared/__tests__/billingLogic.test.js`.
- Unit-test the transition guard logic (false→true sends; true→true doesn't; the un-cancel path clears).
- Light render test that `CancellationBanner` shows on a pending-cancel profile with a future end date and hides otherwise.
- `npm test` green.

## Verify / report
- Migration adds both columns with correct defaults; no RLS regression.
- Webhook sets fields on scheduled cancel, clears on un-cancel and on delete, and only emails on the false→true transition.
- Both emails send best-effort and log to `notification_log`.
- Banner shows "ends on X" for a pending-cancel shop (owner + team), hidden otherwise; access gate unchanged.
- List files changed + the migration filename. Do not deploy.
