// Shop-level team-notification category toggles. A missing key means ON —
// '{}' (the column default) preserves the original always-on behavior.
// @mentions are deliberately NOT a category: a human pinging a human by
// name always delivers.

export function notifyPrefEnabled(prefs, key) {
  const v = prefs?.[key];
  return v === false ? false : true;
}
