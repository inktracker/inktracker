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

## Phase 3 — mobile gotchas

### Phase 3a — infrastructure ✅ (done, this branch)
All native-only, guarded to **no-op on web** (browser build unchanged):
- **`src/lib/mobile/native.js`** — the glue:
  - `isNative()` — true only in the Capacitor shell.
  - `openExternal(url)` — system browser on native (`@capacitor/browser`), new
    tab on web. Use for ALL external links (payments, OAuth, vendor carts, files).
  - `initNativeApp()` — status-bar style, `cap-native` root class (CSS safe-area
    hook), and the `appUrlOpen` deep-link listener that routes OAuth / magic-link
    returns back into the app. Booted from `main.jsx`.
- **Safe areas** — `html.cap-native body` insets via `env(safe-area-inset-*)` in
  `index.css` (web never matches the selector).
- **First external site wired** — supplier reorder carts (`NorcalOrderModal`)
  now open via `openExternal`.

### App icon + splash ✅ (sources staged, this branch)
- `assets/icon.png` (1024², opaque — the drop logo), `assets/splash.png` +
  `assets/splash-dark.png` (2732², logo centered on white). `@capacitor/assets`
  installed (dev).
- After `cap add ios`, generate every required size in one command:
  `npx capacitor-assets generate --ios` → writes into `ios/App/App/Assets.xcassets`.

### Deep-link auth — code done ✅, config is Phase 3b
- `authRedirectUrl(path)` in `native.js` is wired into the LoginModal auth calls
  (sign-up confirm, magic link, password reset). **Web is byte-identical**
  (`${origin}${path}`); native returns `https://www.inktracker.app${path}`, a
  **universal link** iOS routes back into the app.
- **Phase 3b (needs device):** to make those universal links open the app instead
  of Safari, add the **Associated Domains** entitlement (`applinks:www.inktracker.app`)
  in the iOS project + host an **`apple-app-site-association`** file at
  `https://www.inktracker.app/.well-known/apple-app-site-association` listing the
  app ID `7545WWK837.app.inktracker.mobile`. Until then the link opens in Safari
  and still completes login (graceful fallback). Also add the app's redirect to
  the Intuit QB OAuth redirect URIs for the QB-connect return.
- **Convert the remaining in-app external navigations** (`window.location.href =
  <QB OAuth URL>` in OnboardingWizard/BrokerProfile; Stripe billing portal in
  BillingSection) to `openExternal` — deferred until the deep-link return is
  wired, so the browser hand-off has somewhere to come back to. (The customer
  QuotePayment flow is NOT in scope — customers pay from their own phone browser,
  not inside the shop's app.)
- **Safe-area visual tuning** on real hardware (notch, Dynamic Island, home
  indicator across screens).

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
