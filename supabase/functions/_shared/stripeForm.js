// Stripe's form encoding for nested params (pure, tested):
//   { a: { b: 1 }, list: [{ x: "y" }], tags: ["p", "q"] }
//   → a[b]=1&list[0][x]=y&tags[0]=p&tags[1]=q
// undefined/null values are skipped; booleans become "true"/"false".

export function formEncode(params, prefix = "") {
  const parts = [];
  const add = (k, v) => parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  const walk = (value, key) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${key}[${i}]`));
    } else if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, key ? `${key}[${k}]` : k);
    } else {
      add(key, typeof value === "boolean" ? String(value) : String(value));
    }
  };
  walk(params, prefix);
  return parts.join("&");
}
