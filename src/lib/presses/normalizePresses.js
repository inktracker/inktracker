// Press configuration normalizer. The `shop.presses` JSONB column has
// been stored two different ways over the lifetime of this code:
//
//   v1: ["Auto 1", "Manual A"]                  (plain string names)
//   v2: [{ name: "Auto 1", colors: 8 }, ...]    (objects with color/
//                                                 station count)
//
// All readers must go through this helper so old shops keep working
// without a backfill. Always returns objects of the v2 shape. Empty/
// invalid entries are dropped. Color count is null when unknown.

/**
 * @param {unknown} raw  Whatever `shop.presses` contained (or anything else)
 * @returns {{ name: string, colors: number | null }[]}
 */
export function normalizePresses(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => {
      if (typeof p === "string") {
        // Defensive unwrap for double-encoded entries — some shops'
        // shop.presses rows ended up with each element stored as a
        // JSON-stringified object instead of a real JSONB object
        // (e.g. `'{"name":"Auto 1","colors":8}'` as a literal string).
        // Without this branch, the v1-string treatment below would
        // render the entire JSON blob as the press's name in the
        // editor. We try to parse first; if it isn't valid JSON
        // describing a press, fall through to the plain-string
        // (v1) path.
        const trimmed = p.trim();
        if (trimmed.length > 1 && trimmed[0] === "{" && trimmed[trimmed.length - 1] === "}") {
          try {
            const obj = JSON.parse(trimmed);
            if (obj && typeof obj === "object" && (obj.name != null)) {
              const name = String(obj.name || "").trim();
              const c = Number(obj.colors);
              const colors = Number.isFinite(c) && c > 0 ? c : null;
              return { name, colors };
            }
          } catch { /* not JSON — fall through */ }
        }
        return { name: trimmed, colors: null };
      }
      if (p && typeof p === "object") {
        const name = String(p.name || "").trim();
        const c = Number(p.colors);
        const colors = Number.isFinite(c) && c > 0 ? c : null;
        return { name, colors };
      }
      return { name: "", colors: null };
    })
    .filter((p) => p.name);
}

/**
 * Inverse: produce the shape we write back to the DB. Same v2 object
 * format. Empty rows dropped. Trims names. Strips invalid color
 * counts (keeps null when unset).
 */
export function serializePresses(rows) {
  return normalizePresses(rows);
}
