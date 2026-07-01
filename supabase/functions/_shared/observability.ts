// Edge-function error visibility. Sentry covers the frontend; edge failures
// were invisible beyond console logs. captureError reports an error to Sentry
// when SENTRY_DSN (Deno env) is set, and no-ops cleanly when it isn't.
//
// HARD CONTRACT: this must NEVER throw and NEVER block the real response.
// Every path is wrapped in try/catch and the network call is time-boxed, so a
// Sentry outage or a malformed DSN can't turn an edge error into a hang or a
// second failure. Callers add `await captureError(err, { fn })` inside their
// top-level catch WITHOUT changing the response they return.

interface ParsedDsn {
  ingestUrl: string;
  publicKey: string;
}

// Sentry DSN: https://<publicKey>@<host>/<projectId>
// Classic "store" ingest endpoint: https://<host>/api/<projectId>/store/
function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    const projectId = u.pathname.replace(/^\/+/, "");
    if (!publicKey || !projectId) return null;
    return {
      publicKey,
      ingestUrl: `${u.protocol}//${u.host}/api/${projectId}/store/`,
    };
  } catch {
    return null;
  }
}

function errToPayload(err: unknown) {
  if (err instanceof Error) {
    return { type: err.name || "Error", value: err.message || String(err), stacktrace: err.stack || null };
  }
  return { type: "NonError", value: typeof err === "string" ? err : JSON.stringify(err), stacktrace: null };
}

export async function captureError(
  err: unknown,
  context: Record<string, unknown> = {},
): Promise<void> {
  try {
    const dsn = Deno.env.get("SENTRY_DSN");
    if (!dsn) return; // not configured → silent no-op (the common case)
    const parsed = parseDsn(dsn);
    if (!parsed) return;

    const e = errToPayload(err);
    const event = {
      platform: "javascript",
      level: "error",
      timestamp: Date.now() / 1000,
      logger: "edge",
      server_name: (context.fn as string) || "edge-function",
      message: e.value,
      exception: { values: [{ type: e.type, value: e.value, stacktrace: e.stacktrace ? { frames: [], raw: e.stacktrace } : undefined }] },
      extra: context,
      tags: { fn: (context.fn as string) || "unknown" },
    };

    // Time-box the report so observability can never delay the response.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      await fetch(parsed.ingestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=inktracker-edge/1.0, sentry_key=${parsed.publicKey}`,
        },
        body: JSON.stringify(event),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Swallow EVERYTHING — a reporting failure must never surface to the caller.
  }
}
