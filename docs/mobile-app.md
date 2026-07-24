# InkTracker mobile app (iOS via Capacitor)

The mobile app **wraps the existing Vite/React web app** in a native iOS shell
(Capacitor) — no rewrite, one codebase. `npm run build` produces `dist/`, and
Capacitor packages that into a real `.ipa` for the App Store.

- **Approach:** Capacitor (wrap), iOS first (Android is a later `cap add android`).
- **Bundle ID:** `app.inktracker.mobile` (in `capacitor.config.json`). Must match
  the App ID registered in the Apple Developer portal.
- **App name:** InkTracker.

## Phase 1 — foundation ✅ (done, this branch)
- Installed `@capacitor/core|cli|ios` + `@capacitor/app|browser|status-bar`.
- `capacitor.config.json` (appId / appName / webDir=`dist`).
- npm scripts: `mobile:sync`, `mobile:ios`, `mobile:add:ios`.
- `.gitignore` entries for iOS build artifacts.
- Also applied the semver-safe `npm audit fix` the install surfaced (dompurify /
  brace-expansion high-sev patches — no major bumps; react-router stayed v6).

## Phase 2 — native project (needs Xcode + CocoaPods — install these first)
This machine currently has **only Command Line Tools**, not full Xcode, and no
CocoaPods. Both are required to create/run the iOS project and submit to the App
Store. Install:
1. **Xcode** — from the Mac App Store (~. large download). Then:
   `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`
2. **CocoaPods** — `brew install cocoapods` (or `sudo gem install cocoapods`).

Then scaffold the native project:
```
npm run mobile:add:ios     # creates ios/  (runs pod install)
npm run mobile:ios         # build web → sync → open in Xcode
```
In Xcode: select the App target → Signing & Capabilities → your Apple Team →
enable **Automatic signing**. Run on a simulator or a connected device.

## Phase 3 — mobile gotchas to handle (before shipping)
Wrapping a web app natively has three known sharp edges in THIS app. Each is
already scoped; none is a blocker:

1. **Auth redirect / deep links.** Login uses `window.location` for magic-link /
   OAuth round-trips (`src/lib/AuthContext.jsx`). In a native shell that must
   come back via a **custom URL scheme / universal link**, wired through
   `@capacitor/app`'s `appUrlOpen`. Supabase `redirectTo` needs a native URL.
2. **Stripe / QuickBooks checkout.** Payment flows use `window.open`
   (`src/pages/QuotePayment.jsx`). On iOS these MUST open in the **system
   browser** (`@capacitor/browser`), not the in-app webview — Apple rejects
   in-webview payment, and Stripe/QB need a real browser. Route external/payment
   URLs through `Browser.open`.
3. **Safe areas + status bar.** Notch/home-indicator insets (`contentInset:
   always` is set) and `@capacitor/status-bar` styling so the app doesn't draw
   under the clock/battery.

## Phase 4 — App Store Connect
Create the app record in App Store Connect (name, bundle ID `app.inktracker.mobile`,
category, privacy nutrition labels, screenshots), archive in Xcode
(Product → Archive), upload, submit for review.

## Apple-side checklist (Joe)
- Apple Developer Program membership active ($99/yr).
- App ID `app.inktracker.mobile` registered (Certificates, Identifiers & Profiles
  → Identifiers).
- App Store Connect app record (Phase 4).
- Automatic signing in Xcode handles certs/provisioning for development.
