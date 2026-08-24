import { describe, it, expect } from "vitest";
import { targetUrl, buildPushPayload, urgencyFor, isFreshEnough } from "../pushPayload.js";

describe("targetUrl", () => {
  it("routes each known entity to its page", () => {
    expect(targetUrl("quote", "q1")).toBe("/Quotes?focus=q1");
    expect(targetUrl("order", "o1")).toBe("/Orders?focus=o1");
    expect(targetUrl("invoice", "i1")).toBe("/Invoices?focus=i1");
  });

  it("falls back to the bell for unknown or missing entities", () => {
    // related_entity is free text written by whichever function inserted
    // the row — a typo or a new event type must not produce a dead link.
    expect(targetUrl("widget", "x")).toBe("/Notifications");
    expect(targetUrl(null, "x")).toBe("/Notifications");
    expect(targetUrl(undefined, undefined)).toBe("/Notifications");
  });

  it("omits the focus param when there's no id", () => {
    expect(targetUrl("quote", null)).toBe("/Quotes");
    expect(targetUrl("quote", "")).toBe("/Quotes");
  });

  it("encodes ids so they can't break out of the query string", () => {
    expect(targetUrl("quote", "a&b=c")).toBe("/Quotes?focus=a%26b%3Dc");
    expect(targetUrl("quote", "a b")).toBe("/Quotes?focus=a%20b");
  });

  // The routing table is an allowlist, never string interpolation — a
  // prototype-chain key must not resolve to a route.
  it("does not resolve inherited Object properties as routes", () => {
    expect(targetUrl("constructor", "x")).toBe("/Notifications");
    expect(targetUrl("toString", "x")).toBe("/Notifications");
  });
});

describe("buildPushPayload", () => {
  const note = {
    id: 42,
    event_type: "quote_paid",
    severity: "alert",
    title: "Payment received",
    body: "Barrett Green paid $1,240.00",
    related_entity: "quote",
    related_id: "q-777",
  };

  it("carries what the service worker needs", () => {
    const p = JSON.parse(buildPushPayload(note));
    expect(p).toEqual({
      title: "Payment received",
      body: "Barrett Green paid $1,240.00",
      url: "/Quotes?focus=q-777",
      tag: "quote_paid:q-777",
      severity: "alert",
      notificationId: 42,
    });
  });

  it("tags by entity so repeats collapse instead of stacking", () => {
    const a = JSON.parse(buildPushPayload(note));
    const b = JSON.parse(buildPushPayload({ ...note, id: 43, title: "Payment received (retry)" }));
    expect(a.tag).toBe(b.tag);
  });

  it("falls back to the row id for tagging when there's no entity", () => {
    const p = JSON.parse(buildPushPayload({ ...note, related_id: null }));
    expect(p.tag).toBe("quote_paid:42");
  });

  it("never emits a null body (the SW would render 'null')", () => {
    expect(JSON.parse(buildPushPayload({ ...note, body: null })).body).toBe("");
  });
});

describe("urgencyFor", () => {
  it("pushes money moments hard and info softly", () => {
    expect(urgencyFor("info")).toBe("normal");
    expect(urgencyFor("warning")).toBe("high");
    expect(urgencyFor("alert")).toBe("high");
  });
});

describe("isFreshEnough", () => {
  const now = Date.parse("2026-08-24T20:00:00Z");

  it("accepts a just-created notification", () => {
    expect(isFreshEnough("2026-08-24T19:59:30Z", now)).toBe(true);
  });

  it("rejects a replayed old row", () => {
    // The forgery guard: POSTing an ancient id must not push anything.
    expect(isFreshEnough("2026-08-24T19:30:00Z", now)).toBe(false);
    expect(isFreshEnough("2026-01-01T00:00:00Z", now)).toBe(false);
  });

  it("rejects an unparseable timestamp rather than defaulting to send", () => {
    expect(isFreshEnough("not a date", now)).toBe(false);
    expect(isFreshEnough(null, now)).toBe(false);
  });

  it("treats the boundary as still fresh", () => {
    expect(isFreshEnough(new Date(now - 10 * 60 * 1000).toISOString(), now)).toBe(true);
    expect(isFreshEnough(new Date(now - 10 * 60 * 1000 - 1).toISOString(), now)).toBe(false);
  });
});
