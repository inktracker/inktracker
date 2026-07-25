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

### Deep-link auth — code done ✅, artifacts staged ✅, activation is Phase 3b
`authRedirectUrl(path)` in `native.js` is wired into the LoginModal auth calls
(sign-up confirm, magic link, password reset). **Web is byte-identical**
(`${origin}${path}`); native returns `https://www.inktracker.app${path}`.

**Two return mechanisms — we need both, because the two providers differ:**

| Provider | Constraint | Reliable mechanism |
|----------|-----------|--------------------|
| **Supabase** (magic link, signup confirm, password reset) | The tapped email link hits `*.supabase.co` first, which then **302-redirects** to the app URL. Universal Links do **not** fire on a 302 chain, but a 302 whose `Location` is a **custom URL scheme** *does* hand off to the app. | **Custom URL scheme** `app.inktracker.mobile://…` |
| **QuickBooks / Intuit** | Intuit only accepts **https** redirect URIs (no custom schemes), returning to `https://inktracker.app/api/qb-callback`. | **Universal Link** on that path (or an https callback page that conditionally bounces to the custom scheme) |

**Staged in this branch (all inert until activated — the first Simulator run is untouched):**
- **Custom URL scheme** `app.inktracker.mobile` registered in `Info.plist`
  (`CFBundleURLTypes`). Captured by the existing `appUrlOpen` → `routeDeepLink`
  listener in `native.js`. Scheme = the bundle ID, for guaranteed uniqueness.
- **`apple-app-site-association`** at `public/.well-known/apple-app-site-association`
  (deploys with the web app; served as `application/json` via a `vercel.json`
  header rule). App ID `7545WWK837.app.inktracker.mobile`, scoped to
  `/api/qb-callback`, `/ResetPassword`, and a reserved `/mobile-auth` path — **not**
  a `*` wildcard, so it never hijacks the marketing domain for a signed-in owner.
- **`ios/App/App/App.entitlements`** with `applinks:inktracker.app` +
  `applinks:www.inktracker.app`. **Created but NOT referenced by the build** —
  see activation step 1.

**Phase 3b activation (needs the Simulator/device + Joe's account access):**
1. **Wire the entitlement:** set `CODE_SIGN_ENTITLEMENTS = App/App.entitlements`
   on the App target (Xcode → Signing & Capabilities → **+ Associated Domains**,
   or the pbxproj build setting). Do this *after* the first clean Simulator run.
2. **Apple Developer portal:** enable the **Associated Domains** capability on
   App ID `app.inktracker.mobile`, then let automatic signing regenerate the
   profile.
3. **Supabase → Auth → URL Configuration → Redirect URLs allow-list:** add
   `app.inktracker.mobile://*` (and the reserved `https://www.inktracker.app/mobile-auth`).
   Then, if device testing confirms the 302→scheme hand-off, switch
   `authRedirectUrl()` on native from the https URL to
   `app.inktracker.mobile://mobile-auth` and route it in `routeDeepLink`. Leave
   the https value until tested — Safari fallback still completes login.
4. **Intuit developer portal → app → Redirect URIs:** confirm
   `https://inktracker.app/api/qb-callback` is registered. To bounce the https
   return into the native app, `/api/qb-callback` must detect a native round-trip
   (e.g. a `state`/`?native=1` marker carried through the OAuth request) and
   redirect to `app.inktracker.mobile://qb-callback?<params>`; otherwise it stays
   in the in-app browser (still completes the connect, just no auto-return).
5. **Reconcile hosts:** confirm whether the canonical domain is apex
   `inktracker.app` or `www.` (QB uses apex, `authRedirectUrl` uses www). The AASA
   is served on both since it's the same deployment; the entitlement lists both.
6. **Verify the AASA is live + correct** once deployed:
   `curl -sI https://inktracker.app/.well-known/apple-app-site-association`
   (expect `200` + `content-type: application/json`), and check Apple's CDN cache
   picks it up (`https://app-site-association.cdn-apple.com/a/v1/inktracker.app`).

**Then — convert the remaining in-app external navigations** (`window.location.href =
<QB OAuth URL>` in OnboardingWizard/BrokerProfile; Stripe billing portal in
BillingSection) to `openExternal` — deferred until the deep-link return is wired,
so the browser hand-off has somewhere to come back to. (The customer QuotePayment
flow is NOT in scope — customers pay from their own phone browser, not inside the
shop's app.)

**Safe-area visual tuning** on real hardware (notch, Dynamic Island, home
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
