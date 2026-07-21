import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// observability.ts reads Deno.env at call time; stub a minimal Deno global.
const env = new Map();
globalThis.Deno = { env: { get: (k) => env.get(k) } };

const { captureError } = await import("../observability.ts");

const DSN_WEB = "https://webkey@o1.ingest.sentry.io/1111";
const DSN_EDGE = "https://edgekey@o1.ingest.sentry.io/2222";

let fetchMock;
beforeEach(() => {
  env.clear();
  fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const sentEvent = () => JSON.parse(fetchMock.mock.calls[0][1].body);
const sentUrl = () => fetchMock.mock.calls[0][0];

describe("captureError — DSN routing", () => {
  it("no-ops silently when no DSN is configured", async () => {
    await captureError(new Error("boom"), { fn: "x" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to SENTRY_DSN when no edge DSN is set", async () => {
    env.set("SENTRY_DSN", DSN_WEB);
    await captureError(new Error("boom"), { fn: "qbSync" });
    expect(sentUrl()).toContain("/api/1111/store/");
  });

  it("PREFERS SENTRY_EDGE_DSN so backend errors land in their own project", async () => {
    env.set("SENTRY_DSN", DSN_WEB);
    env.set("SENTRY_EDGE_DSN", DSN_EDGE);
    await captureError(new Error("boom"), { fn: "qbSync" });
    expect(sentUrl()).toContain("/api/2222/store/");
    expect(fetchMock.mock.calls[0][1].headers["X-Sentry-Auth"]).toContain("sentry_key=edgekey");
  });
});

describe("captureError — event shape", () => {
  beforeEach(() => env.set("SENTRY_DSN", DSN_WEB));

  it("tags edge events with a distinct environment (not the frontend's)", async () => {
    await captureError(new Error("boom"), { fn: "wizardSubmit" });
    const ev = sentEvent();
    expect(ev.environment).toBe("edge");
    expect(ev.environment).not.toBe("production");
    expect(ev.logger).toBe("edge");
  });

  it("allows overriding the environment", async () => {
    env.set("SENTRY_ENVIRONMENT", "edge-staging");
    await captureError(new Error("boom"), { fn: "x" });
    expect(sentEvent().environment).toBe("edge-staging");
  });

  it("carries the function name in tags and server_name", async () => {
    await captureError(new Error("boom"), { fn: "createCheckoutSession" });
    const ev = sentEvent();
    expect(ev.tags.fn).toBe("createCheckoutSession");
    expect(ev.server_name).toBe("createCheckoutSession");
  });

  it("NEVER throws, even when the transport fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(captureError(new Error("boom"), { fn: "x" })).resolves.toBeUndefined();
  });

  it("NEVER throws on a malformed DSN", async () => {
    env.set("SENTRY_DSN", "not-a-url");
    await expect(captureError(new Error("boom"), { fn: "x" })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
