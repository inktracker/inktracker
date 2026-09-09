// Guards the two holes that let the React.lazy "undefined is not an object
// (evaluating 't.default')" Sentry crash through after a redeploy:
//   1. Safari resolving a stale chunk to a module with no default export.
//   2. The message-match for a chunk that failed to fetch.
import { describe, it, expect } from "vitest";
import { isBrokenLazyModule, isStaleChunkError } from "../pages.config.js";

describe("isBrokenLazyModule", () => {
  it("accepts a normal page module (has a default export)", () => {
    expect(isBrokenLazyModule({ default: () => null })).toBe(false);
  });
  it("flags a module with no default export (Safari stale-chunk resolve)", () => {
    expect(isBrokenLazyModule({})).toBe(true);
    expect(isBrokenLazyModule({ default: undefined })).toBe(true);
    expect(isBrokenLazyModule({ default: null })).toBe(true);
  });
  it("flags a nullish import result", () => {
    expect(isBrokenLazyModule(undefined)).toBe(true);
    expect(isBrokenLazyModule(null)).toBe(true);
  });
});

describe("isStaleChunkError", () => {
  it("matches the fetch-failure phrasings across browsers", () => {
    expect(isStaleChunkError("Failed to fetch dynamically imported module: https://x/assets/a.js")).toBe(true);
    expect(isStaleChunkError("error loading dynamically imported module")).toBe(true);
    expect(isStaleChunkError("Importing a module script failed.")).toBe(true);
    expect(isStaleChunkError("Load failed")).toBe(true); // Safari
    expect(isStaleChunkError("Lazy chunk resolved without a default export (stale/broken chunk)")).toBe(true);
  });
  it("does NOT match an ordinary app error", () => {
    expect(isStaleChunkError("TypeError: cannot read x of undefined")).toBe(false);
    expect(isStaleChunkError("Network request failed")).toBe(false);
    expect(isStaleChunkError("")).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
  });
});
