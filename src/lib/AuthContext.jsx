import React, { createContext, useState, useContext, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";

const AuthContext = createContext();

async function fetchUserWithProfile() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("auth_id", user.id)
    .maybeSingle();

  if (!profile) return null;
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
        setUser((prev) => {
          // Avoid triggering re-renders if nothing actually changed
          if (prev && prev.id === fullUser.id && prev.email === fullUser.email) return prev;
          return fullUser;
        });
        setIsAuthenticated(true);
        setAuthError(null);
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
      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        checkAppState({ silent: true });
      } else if (event === "SIGNED_OUT") {
        setLoggedOut();
      }
      // TOKEN_REFRESHED / INITIAL_SESSION: ignore — already handled by initial check
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
