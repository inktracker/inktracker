// Escape a string for use as a LITERAL inside a Postgres LIKE/ILIKE pattern.
//
// Why this exists: `.ilike(column, userInput)` treats `%` and `_` in the input
// as live wildcards. On an anonymous endpoint that is an enumeration oracle —
// e.g. getPublicShopConfig took a request-body email straight into ilike, so
// `{"ownerEmail":"%@gmail.com"}` matched real shops and prefix-walking leaked
// every shop's pricing_config (found 2026-09-30). Escaping turns ilike into
// plain case-insensitive equality: exactly what "look up a shop by email,
// any casing" needs, with no pattern semantics left for the caller to abuse.
//
// Backslash is Postgres's default LIKE escape character; it must be escaped
// first so user backslashes can't un-escape the wildcards we escape after.
export function escapeLikeLiteral(input) {
  return String(input ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}
