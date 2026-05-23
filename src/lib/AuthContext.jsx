import React, { createContext, useState, useContext, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import { loadShopPricingConfig } from "@/components/shared/pricing";
import { loadShopTimezone } from "@/lib/shopTimezone";
import { userStateChanged } from "@/lib/auth/userStateChanged";
import { setSentryUser, clearSentryUser } from "@/lib/sentry";

const AuthContext = createContext();

async function fetchUserWithProfile() {
  const { data: { user }, error } = await supabase.auth.getUser();
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
      .select("pricing_config, timezone")
      .eq("owner_email", shopOwner)
      .maybeSingle();
    loadShopPricingConfig(shop?.pricing_config || null);
    loadShopTimezone(shop?.timezone || null);
  } catch {
    loadShopPricingConfig(null);
    loadShopTimezone(null);
  }

  return { ...profile, email: user.email };
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);

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
