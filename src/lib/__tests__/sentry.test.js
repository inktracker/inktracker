import { describe, it, expect } from "vitest";
import { scrubSentryEvent } from "@/lib/sentry";

describe("scrubSentryEvent — Supabase error normalization", () => {
  it("wraps a bare Supabase error object into a tagged message + SupabaseError type", () => {
    const supabaseErr = {
      code: "PGRST116",
      details: null,
      hint: "Make sure you select at least one column.",
      message: "JSON object requested, multiple (or no) rows returned",
    };
    const event = {
      message: null,
      exception: { values: [{ type: "Error", value: "Non-Error promise rejection" }] },
    };
    const out = scrubSentryEvent(event, { originalException: supabaseErr });

    expect(out.message).toBe("Supabase: JSON object requested, multiple (or no) rows returned (code=PGRST116)");
    expect(out.exception.values[0].type).toBe("SupabaseError");
    expect(out.exception.values[0].value).toContain("Supabase:");
    expect(out.tags).toEqual({ source: "supabase" });
  });

  it("handles Supabase errors missing the code field", () => {
    const supabaseErr = { message: "some db error", details: "more info", hint: null };
    const event = { exception: { values: [{ type: "Error", value: "x" }] } };
    const out = scrubSentryEvent(event, { originalException: supabaseErr });
    expect(out.message).toBe("Supabase: some db error");
    expect(out.tags.source).toBe("supabase");
  });

  it("does NOT wrap real Error instances (those already group correctly)", () => {
    const err = new Error("boom");
    const event = { message: null, tags: {} };
    const out = scrubSentryEvent(event, { originalException: err });
    expect(out.message).toBeNull();
    expect(out.tags.source).toBeUndefined();
  });

  it("does NOT wrap plain objects without the Supabase shape", () => {
    const event = { message: "original" };
    const out = scrubSentryEvent(event, { originalException: { foo: "bar" } });
    expect(out.message).toBe("original");
    expect(out.tags).toBeUndefined();
  });

  it("returns event unchanged when no hint is provided", () => {
    const event = { message: "hello" };
    const out = scrubSentryEvent(event);
    expect(out.message).toBe("hello");
  });
});

describe("scrubSentryEvent — email scrubbing", () => {
  it("replaces email addresses in the message field with [email]", () => {
    const out = scrubSentryEvent({ message: "fetch failed for joe@biotamfg.co" });
    expect(out.message).toBe("fetch failed for [email]");
  });

  it("scrubs emails from breadcrumb messages and URLs", () => {
    const event = {
      breadcrumbs: [
        { message: "navigated to /profile?email=alice@example.test" },
        { data: { url: "/api/users?email=bob@example.test" } },
      ],
    };
    const out = scrubSentryEvent(event);
    expect(out.breadcrumbs[0].message).toContain("[email]");
    expect(out.breadcrumbs[1].data.url).toContain("[email]");
  });

  it("scrubs emails from exception values", () => {
    const event = {
      exception: { values: [{ value: "could not find user@example.test" }] },
    };
    const out = scrubSentryEvent(event);
    expect(out.exception.values[0].value).toContain("[email]");
  });
});

describe("scrubSentryEvent — request scrubbing", () => {
  it("strips Authorization headers (both cases)", () => {
    const event = {
      request: { headers: { authorization: "Bearer abc", Authorization: "Bearer xyz", "x-other": "keep" } },
    };
    const out = scrubSentryEvent(event);
    expect(out.request.headers.authorization).toBeUndefined();
    expect(out.request.headers.Authorization).toBeUndefined();
    expect(out.request.headers["x-other"]).toBe("keep");
  });
});

describe("scrubSentryEvent — failure safety", () => {
  it("returns the event even when an internal step throws", () => {
    // Mutating breadcrumbs.map via a getter that throws.
    const event = {
      message: "ok",
      get breadcrumbs() { throw new Error("induced"); },
    };
    expect(() => scrubSentryEvent(event)).not.toThrow();
    const out = scrubSentryEvent(event);
    expect(out).toBe(event);
  });
});
