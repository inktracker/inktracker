// One-line rendering of profiles.signup_source for the admin signup email.
// Mirrors src/lib/attribution.js#describeSignupSource — keep the priority
// rules in sync (self-reported > utm > referrer > "direct").

export function describeSignupSource(src: unknown): string {
  if (!src || typeof src !== "object" || Array.isArray(src)) return "";
  const s = src as Record<string, unknown>;
  const parts: string[] = [];
  if (s.self_reported) parts.push(`"${String(s.self_reported)}"`);
  if (s.utm_source) {
    parts.push(
      `utm: ${[s.utm_source, s.utm_medium, s.utm_campaign].filter(Boolean).map(String).join(" / ")}`,
    );
  } else if (s.referrer) {
    try {
      parts.push(`via ${new URL(String(s.referrer)).hostname}`);
    } catch {
      parts.push(`via ${String(s.referrer).slice(0, 80)}`);
    }
  }
  if (parts.length === 0) return s.landing || s.captured_at ? "direct" : "";
  return parts.join(" · ");
}
