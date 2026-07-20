import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describeEdgeError } from "../edgeErrors";

// Fake supabase-js FunctionsHttpError: opaque .message, real reason in the
// .context Response (body readable once via .text()).
function httpError(status, body) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: { status, text: async () => raw },
  };
}

describe("describeEdgeError — never leaks the opaque message", () => {
  it("pulls the function's real { error } out of the Response body", async () => {
    const msg = await describeEdgeError(httpError(400, { error: "Recipient not associated with this quote" }));
    expect(msg).toBe("Recipient not associated with this quote");
  });

  it("401 → actionable session-expired guidance (not the raw body)", async () => {
    const msg = await describeEdgeError(httpError(401, { error: "Unauthorized" }));
    expect(msg).toMatch(/session expired/i);
    expect(msg).toMatch(/sign in again/i);
  });

  it("403 anonymous-attachment rejection → session-expired guidance", async () => {
    // The exact trap Joe hit: authed send fell to the anon path.
    const msg = await describeEdgeError(httpError(403, { error: "Anonymous callers may not include payment links, attachments, proof images, or broker fields" }));
    expect(msg).toMatch(/session expired/i);
  });

  it("500 with a body → the function's message", async () => {
    expect(await describeEdgeError(httpError(500, { error: "QuickBooks refused the invoice" })))
      .toBe("QuickBooks refused the invoice");
  });

  it("500 with no body → an on-our-end message, never the opaque string", async () => {
    const msg = await describeEdgeError(httpError(500, ""));
    expect(msg).toMatch(/on our end|try again/i);
    expect(msg).not.toMatch(/non-2xx status code/i);
  });

  it("plain-text (non-JSON) 400 body is surfaced", async () => {
    expect(await describeEdgeError(httpError(400, "invalid input syntax for type date"))).
      toBe("invalid input syntax for type date");
  });

  it("network failure (no status, fetch TypeError) → connection guidance", async () => {
    const msg = await describeEdgeError({ message: "Failed to fetch" });
    expect(msg).toMatch(/reach the server|connection/i);
  });

  it("a real plain Error passes through", async () => {
    expect(await describeEdgeError(new Error("Not signed in."))).toMatch(/session expired|not signed in/i);
  });

  it("null / no error → fallback, and NEVER the opaque generic string", async () => {
    expect(await describeEdgeError(null)).toBeTruthy();
    const opaque = { message: "Edge Function returned a non-2xx status code" };
    const msg = await describeEdgeError(opaque);
    expect(msg).not.toMatch(/non-2xx status code/i);
  });

  it("uses the provided fallback when nothing else is available", async () => {
    expect(await describeEdgeError({}, "Couldn't send the quote.")).toBe("Couldn't send the quote.");
  });
});

describe("guard — supabase.functions.invoke is globally translated", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../../api/supabaseClient.js", import.meta.url)),
    "utf8",
  );

  it("supabase.functions.invoke is patched, and the patch runs describeEdgeError", () => {
    const idx = src.indexOf("supabase.functions.invoke =");
    expect(idx, "the global invoke patch must exist").toBeGreaterThan(-1);
    const patchBlock = src.slice(idx, idx + 600);
    expect(patchBlock).toMatch(/describeEdgeError/);
    // Must preserve context so self-unwrapping money-flow callers keep working.
    expect(patchBlock).toMatch(/\.context/);
  });
});
