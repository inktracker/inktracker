import React, { createContext, useState, useContext, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import { loadShopPricingConfig } from "@/components/shared/pricing";
import { loadShopTimezone } from "@/lib/shopTimezone";
import { loadShopProductionTasks } from "@/lib/productionTasks";
import { userStateChanged } from "@/lib/auth/userStateChanged";
import { setSentryUser, clearSentryUser } from "@/lib/sentry";
import { clearMetricsCache } from "@/lib/qbMetricsCache";
import { checkLocalTrustedDevice } from "@/lib/mfa";
import {
  isMfaSessionVerified,
  markMfaSessionVerified,
  clearAllMfaSessionFlags,
} from "@/lib/mfaSession";

const AuthContext = createContext();

async function fetchUserWithProfile() {
  // detectSessionInUrl runs asynchronously when the page loads with
  // #access_token=... or ?code=... (email confirmation, magic link,
  // password reset). On slower devices (mobile) this can race against
  // the initial AuthContext check — getUser() fires BEFORE the URL
  // token is processed, returns null, and we incorrectly mark the
  // user as logged out. Desktop is usually fast enough to dodge this.
  //
  // If we see auth-token signals in the URL but getUser() didn't find
  // a user yet, wait briefly for getSession() (which awaits the
  // in-flight URL-recovery promise) and retry once. Fixes the mobile
  // "click confirmation link → still on landing page" bug.
  const urlHasAuthTokens =
    typeof window !== "undefined" && (
      window.location.hash?.includes("access_token") ||
      window.location.search?.includes("code=")
    );
  let { data: { user }, error } = await supabase.auth.getUser();
  if ((!user || error) && urlHasAuthTokens) {
    // Block on the initial URL-session resolution.
    await supabase.auth.getSession();
    ({ data: { user }, error } = await supabase.auth.getUser());
  }
  if (error || !user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("auth_id", user.id)
    .maybeSingle();

  if (!profile) {
    // Auth user exists, but no profile row yet. Two cases:
    //   - Race with handle_new_user trigger (most common): the JWT got
    //     to the browser before the profile insert finished. PostConfirmSpinner's
    //     retry loop will resolve this within a second or two.
    //   - Genuinely missing profile (partial signup): activate_trial
    //     returns 'no_profile' and PostConfirmSpinner surfaces a clear
    //     error pointing the user at support.
    //
    // Either way, we MUST NOT return null here. The previous behavior
    // bounced the user to PublicLandingPage with no explanation; users
    // had no idea that confirming their email had silently failed. By
    // returning a stub with role='user', AuthProvider treats us as
    // authenticated and AuthenticatedApp mounts PostConfirmSpinner,
    // which is the component designed for exactly this state.
    return { auth_id: user.id, email: user.email, role: "user" };
  }

  // Load per-shop pricing config + timezone. Brokers (and other team
  // roles) inherit from their assigned shop, not from their own email —
  // a broker has no shops row keyed to their email, so without this
  // they'd silently fall back to default pricing config. That defaulting
  // made broker-side broker prices diverge from shop-side numbers
  // because the shop's customized `brokerMarkupShare` was ignored.
  try {
    const assignedShop = Array.isArray(profile.assigned_shops)
      ? profile.assigned_shops[0]
      : null;
    const shopOwner =
      profile.shop_owner ||
      assignedShop ||
      profile.email ||
      user.email;
    const { data: shop } = await supabase
      .from("shops")
      .select("pricing_config, timezone, production_tasks")
      .eq("owner_email", shopOwner)
      .maybeSingle();
    loadShopPricingConfig(shop?.pricing_config || null);
    loadShopTimezone(shop?.timezone || null);
    loadShopProductionTasks(shop?.production_tasks || null);
  } catch {
    loadShopPricingConfig(null);
    loadShopTimezone(null);
    loadShopProductionTasks(null);
  }

  return { ...profile, email: user.email };
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  // The real MFA enforcement point. profiles.mfa_email_enabled is the
  // source of truth — if true, this flag stays true until the user
  // either (a) verifies a 6-digit email code in this tab, or (b) has a
  // valid trusted-device match. App.jsx renders <MfaGate> while this is
  // true, blocking access to the rest of the app.
  const [needsMfaChallenge, setNeedsMfaChallenge] = useState(false);

  const markMfaChallengePassed = useCallback(() => {
    setNeedsMfaChallenge(false);
  }, []);

  const setLoggedOut = useCallback(() => {
    setUser(null);
    setIsAuthenticated(false);
    setNeedsMfaChallenge(false);
    clearAllMfaSessionFlags();
    // Clear cached shop financials so they don't sit in localStorage for the
    // next person on a shared back-office machine.
    clearMetricsCache();
    setAuthError({ type: "auth_required", message: "Authentication required" });
    clearSentryUser();
  }, []);

  // Named so it can be called with or without showing the loading spinner.
  // `silent=true` (default on auth state changes) just refreshes user data in
  // the background — it does NOT flash the full-page loading screen.
  const checkAppState = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setIsLoadingAuth(true);
    setAuthError(null);
    try {
      const fullUser = await fetchUserWithProfile();
      if (!fullUser) {
        setLoggedOut();
      } else {
        // Pure decision + tests in src/lib/auth/userStateChanged.js — keeps
        // role / subscription transitions from being eaten by an over-eager
        // identity-only equality check.
        setUser((prev) => (userStateChanged(prev, fullUser) ? fullUser : prev));
        setIsAuthenticated(true);
        setAuthError(null);
        // Tag future Sentry events with this user's opaque ID + their
        // shop_name (used as Sentry "username" + a filterable tag).
        // Triage shows "Biota Mfg" directly instead of needing a
        // Supabase lookup on the auth_id. No email / person name sent.
        setSentryUser(fullUser.auth_id || fullUser.id, { shopName: fullUser.shop_name });

        // ── MFA gate decision ─────────────────────────────────────────
        // The session is technically valid at this point (Supabase has
        // a JWT), but we treat the user as gated until the email-MFA
        // challenge is satisfied. Order of checks:
        //   1. mfa_email_enabled false on profile → no gate.
        //   2. This tab already verified for this user in sessionStorage
        //      → no gate (page refresh, route nav).
        //   3. Trusted device match (30-day token in localStorage that
        //      the server still has a row for) → mark verified + skip.
        //   4. Otherwise → gate.
        // Fail-CLOSED: if any check throws, we gate. Better to over-
        // challenge than miss one.
        if (!fullUser.mfa_email_enabled) {
          setNeedsMfaChallenge(false);
        } else if (isMfaSessionVerified(fullUser.auth_id)) {
          setNeedsMfaChallenge(false);
        } else {
          try {
            const trust = await checkLocalTrustedDevice();
            if (trust.ok && trust.trusted) {
              markMfaSessionVerified(fullUser.auth_id);
              setNeedsMfaChallenge(false);
            } else {
              setNeedsMfaChallenge(true);
            }
          } catch {
            setNeedsMfaChallenge(true);
          }
        }
      }
    } catch (err) {
      console.error("Auth check failed:", err);
      if (!silent) setLoggedOut();
    } finally {
      if (!silent) setIsLoadingAuth(false);
    }
  }, [setLoggedOut]);

  useEffect(() => {
    // Initial check — this one DOES show the loading state
    checkAppState({ silent: false });

    // Listen for Supabase auth state changes. SIGNED_IN fires on cross-tab sync
    // when refocusing the tab; running a silent refresh avoids remounting
    // the app tree (which was causing the "everything reloads on tab switch" UX).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      // Password-recovery flow special-case. When a user clicks a reset
      // email link, supabase-js fires PASSWORD_RECOVERY immediately
      // followed by SIGNED_IN (the recovery session IS a signed-in
      // session). If we run the normal SIGNED_IN handler, the app
      // re-renders as authenticated and unmounts ResetPassword.jsx
      // before the user can type a new password — they get bounced to
      // the dashboard with no chance to reset. We also have to skip
      // the URL hash cleanup so ResetPassword's fallback detection
      // (`hash.includes("type=recovery")`) still works.
      if (event === "PASSWORD_RECOVERY") {
        return;
      }
      const pathname = (window.location.pathname || "").toLowerCase();
      const onResetPage = pathname.includes("/resetpassword");
      if (onResetPage && (event === "SIGNED_IN" || event === "USER_UPDATED")) {
        // Stay out of the way — ResetPassword.jsx owns this screen until
        // the user submits a new password and navigates away itself.
        return;
      }
      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        // If URL has auth tokens (email confirmation link), do a full non-silent check
        const hasTokens = window.location.hash?.includes("access_token") || window.location.search?.includes("code=");
        checkAppState({ silent: !hasTokens });
        // Clean up the URL hash after processing
        if (hasTokens && window.location.hash) {
          window.history.replaceState(null, "", window.location.pathname);
        }
      } else if (event === "SIGNED_OUT") {
        setLoggedOut();
      }
    });

    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const logout = async (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    setNeedsMfaChallenge(false);
    clearAllMfaSessionFlags();
    clearMetricsCache();
    setAuthError({ type: "auth_required", message: "Authentication required" });
    await supabase.auth.signOut();
    if (shouldRedirect) window.location.href = "/";
  };

  // In Supabase mode, login is handled by the LoginModal in App.jsx — no redirect needed
  const navigateToLogin = () => {};

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoadingAuth,
        authError,
        logout,
        navigateToLogin,
        checkAppState,
        needsMfaChallenge,
        markMfaChallengePassed,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
