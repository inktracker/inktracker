// Per-tab "MFA verified for this session" flag.
//
// The MFA gate (src/components/MfaGate.jsx) marks the current session
// as verified after the user successfully enters a 6-digit code.
// AuthContext reads this flag on every auth check; while it's absent
// the gate stays up regardless of whether Supabase considers the
// session valid.
//
// sessionStorage is per-tab, which is exactly the property we want:
//   - Page refresh in the same tab → flag persists → no re-challenge.
//   - Close tab / open new tab → flag gone → re-challenge.
//   - Closing the browser invalidates all in-flight verifications.
//
// The flag is keyed by auth user id so signing out and signing back
// in as someone else can't reuse a stale verification.

const PREFIX = "inktracker_mfa_session_verified_";

function key(userId) {
  return `${PREFIX}${userId}`;
}

export function markMfaSessionVerified(userId) {
  if (!userId) return;
  try { sessionStorage.setItem(key(userId), "1"); } catch { /* ignore */ }
}

export function isMfaSessionVerified(userId) {
  if (!userId) return false;
  try { return sessionStorage.getItem(key(userId)) === "1"; } catch { return false; }
}

export function clearMfaSessionVerified(userId) {
  if (!userId) return;
  try { sessionStorage.removeItem(key(userId)); } catch { /* ignore */ }
}

// Wipe all per-user flags. Called on sign-out so a subsequent sign-in
// in the same tab as a different account can't reuse anything.
export function clearAllMfaSessionFlags() {
  try {
    const toRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(PREFIX)) toRemove.push(k);
    }
    toRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch { /* ignore */ }
}
