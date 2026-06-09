import React, { createContext, useState, useContext, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import { loadShopPricingConfig } from "@/components/shared/pricing";
import { loadShopTimezone } from "@/lib/shopTimezone";
import { loadShopProductionTasks } from "@/lib/productionTasks";
import { userStateChanged } from "@/lib/auth/userStateChanged";
import { setSentryUser, clearSentryUser } from "@/lib/sentry";
import { checkLocalTrustedDevice } from "@/lib/mfa";

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

  // MFA step-up state. After any SIGNED_IN event we check whether the
  // current session is at AAL1 with a verified TOTP factor — if so, the
  // user landed here via magic link (or a session restore that didn't
  // go through LoginModal's challenge), and we need to force the
  // challenge before letting them touch anything.
  //
  // `mfaChallengeRequired` is consumed by MfaSignInChallenge (mounted in
  // App.jsx) which renders a blocking overlay until the challenge is
  // satisfied or the user signs out. LoginModal's password path doesn't
  // trigger this because its own flow steps up to AAL2 before SIGNED_IN
  // fires our handler (so currentLevel reads as aal2 on this check).
  const [mfaChallengeRequired, setMfaChallengeRequired] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState(null);
  const [mfaChallengeId, setMfaChallengeId] = useState(null);

  const clearMfaChallenge = useCallback(() => {
    setMfaChallengeRequired(false);
    setMfaFactorId(null);
    setMfaChallengeId(null);
  }, []);

  // After a successful sign-in, decide whether the current session needs
  // an MFA step-up. Short-circuits on:
  //   - no verified TOTP factor → AAL1 is the user's actual level
  //   - already at AAL2 → LoginModal already did the step-up, nothing to do
  //   - local trusted-device token matches → skip per Phase 3b
  //   - any RPC failure → fail closed (require challenge). Magic-link
  //     bypass is exactly what this is supposed to prevent; we'd rather
  //     over-challenge than miss a sign-in.
  const evaluateMfaStepUp = useCallback(async () => {
    try {
      const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const needs = aalData?.nextLevel === "aal2" && aalData?.currentLevel === "aal1";
      if (!needs) {
        clearMfaChallenge();
        return;
      }
      // Trusted device short-circuit.
      try {
        const trust = await checkLocalTrustedDevice();
        if (trust.ok && trust.trusted) {
          clearMfaChallenge();
          return;
        }
      } catch { /* fall through — challenge */ }

      const { data: factorsData } = await supabase.auth.mfa.listFactors();
      const totp = (factorsData?.totp || []).find((f) => f.status === "verified");
      if (!totp) {
        // Edge case: nextLevel says aal2 but no verified factor found.
        // Don't block — there's nothing to challenge against.
        clearMfaChallenge();
        return;
      }
      const { data: chData, error: chErr } = await supabase.auth.mfa.challenge({ factorId: totp.id });
      if (chErr) throw chErr;
      setMfaFactorId(totp.id);
      setMfaChallengeId(chData.id);
      setMfaChallengeRequired(true);
    } catch (err) {
      // Fail closed: if we couldn't determine MFA state, sign the user
      // out rather than let them through at AAL1. Logging only.
      console.warn("[Auth] MFA step-up evaluation failed:", err?.message);
      try { await supabase.auth.signOut(); } catch { /* ignore */ }
      clearMfaChallenge();
    }
  }, [clearMfaChallenge]);

  const setLoggedOut = useCallback(() => {
    setUser(null);
    setIsAuthenticated(false);
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
        clearMfaChallenge();
      } else {
        // Run the MFA check in parallel with the rest of the state set.
        // Failure modes are handled inside evaluateMfaStepUp (fails
        // closed → sign out). Awaited so the resulting UI state is
        // consistent when checkAppState resolves.
        await evaluateMfaStepUp();
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
      }
    } catch (err) {
      console.error("Auth check failed:", err);
      if (!silent) setLoggedOut();
    } finally {
      if (!silent) setIsLoadingAuth(false);
    }
  }, [setLoggedOut, clearMfaChallenge, evaluateMfaStepUp]);

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
        // MFA step-up surface — MfaSignInChallenge in App.jsx is the
        // sole consumer. Don't read these from page-level code; the
        // overlay's whole job is to gate access while challenged.
        mfaChallengeRequired,
        mfaFactorId,
        mfaChallengeId,
        clearMfaChallenge,
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
