// Translate a PostgREST/Postgres error from a base44.entities.* (or
// auth.updateMe) call into a plain, user-actionable message.
//
// Raw DB errors — "invalid input syntax for type date", "new row violates
// row-level security policy", bare SQLSTATE codes — are developer noise that
// used to reach users verbatim via notify.error / setError (the "Couldn't add
// customer: invalid input syntax for type date" report). This maps the common
// Postgres error codes to language a shop owner can act on. Synchronous —
// entity errors are plain objects (unlike edge Response errors → edgeErrors.js).

const NETWORK_RE = /failed to fetch|networkerror|load failed|network request failed/i;

export function describeEntityError(err, fallback = "Something went wrong. Please try again.") {
  if (!err) return fallback;
  const code = String(err.code || "");
  const msg = String(err.message || "");

  // Couldn't reach the database at all.
  if (NETWORK_RE.test(msg)) {
    return "Couldn't reach the server. Check your internet connection and try again.";
  }

  switch (code) {
    case "23505": // unique_violation
      return "That already exists — it looks like a duplicate of an existing record.";
    case "23503": // foreign_key_violation
      return "This is still linked to other records, so it can't be changed or removed yet.";
    case "23502": // not_null_violation
      return "A required field is missing. Fill in the required fields and try again.";
    case "23514": // check_violation
      return "One of the values isn't allowed here. Double-check your entries and try again.";
    case "22007":
    case "22008": // invalid datetime / datetime field overflow
      return "One of the date fields isn't valid. Check the dates and try again.";
    case "22P02": // invalid_text_representation — e.g. "invalid input syntax for type date"
      return "One of the fields has a value in the wrong format. Check your entries and try again.";
    case "42501": // insufficient_privilege
      return "You don't have permission to do that. Try refreshing the page and signing in again.";
    case "PGRST301": // PostgREST: JWT expired
      return "Your session expired. Refresh the page and sign in again, then try that once more.";
    case "PGRST116": // PostgREST: no rows from .single()
      return "That record couldn't be found — it may have been deleted. Refresh and try again.";
    default:
      break;
  }

  // Row-level security often surfaces without a clean code.
  if (/row-level security|violates row-level/i.test(msg)) {
    return "You don't have permission to do that. Try refreshing the page and signing in again.";
  }
  if (/invalid input syntax|invalid input value/i.test(msg)) {
    return "One of the fields has a value in the wrong format. Check your entries and try again.";
  }
  // Undefined column/table/function (42xxx) is a bug, not user input — never
  // dump the SQL identifier at the user.
  if (/^42/.test(code) || /does not exist/i.test(msg)) {
    return "Something's misconfigured on our end. Please try again — and contact support if it keeps happening.";
  }

  // Nothing matched → a clean fallback, NEVER the raw SQL message.
  return fallback;
}

// Wrap a caught PostgREST error into an Error carrying the friendly message,
// while preserving code/details/hint and the original on `.raw` for logging
// and any (currently none) code-branching.
export function enrichEntityError(err) {
  const e = new Error(describeEntityError(err));
  e.code = err?.code;
  e.details = err?.details;
  e.hint = err?.hint;
  e.raw = err;
  return e;
}
