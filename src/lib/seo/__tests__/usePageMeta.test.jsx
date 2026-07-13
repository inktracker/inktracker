// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePageMeta } from "../usePageMeta";

const canonicalHref = () =>
  document.head.querySelector('link[rel="canonical"]')?.getAttribute("href");

describe("usePageMeta", () => {
  it("sets the title and a www canonical for the given path", () => {
    renderHook(() => usePageMeta({ title: "Terms of Service — InkTracker", path: "/terms" }));
    expect(document.title).toBe("Terms of Service — InkTracker");
    expect(canonicalHref()).toBe("https://www.inktracker.app/terms");
  });

  it("creates the canonical link element if index.html didn't ship one", () => {
    document.head.querySelectorAll('link[rel="canonical"]').forEach((n) => n.remove());
    renderHook(() => usePageMeta({ title: "Support & Help — InkTracker", path: "/support" }));
    expect(document.head.querySelectorAll('link[rel="canonical"]').length).toBe(1);
    expect(canonicalHref()).toBe("https://www.inktracker.app/support");
  });

  it("restores the homepage canonical + default title on unmount (no stale canonical)", () => {
    const { unmount } = renderHook(() => usePageMeta({ title: "Privacy Policy — InkTracker", path: "/privacy" }));
    expect(canonicalHref()).toBe("https://www.inktracker.app/privacy");
    unmount();
    expect(canonicalHref()).toBe("https://www.inktracker.app/");
    expect(document.title).toBe("InkTracker — Screen Printing Shop Management Software");
  });

  it("does not create duplicate canonical elements across route changes", () => {
    document.head.querySelectorAll('link[rel="canonical"]').forEach((n) => n.remove());
    const a = renderHook(() => usePageMeta({ title: "A", path: "/security" }));
    a.unmount();
    const b = renderHook(() => usePageMeta({ title: "B", path: "/changelog" }));
    expect(document.head.querySelectorAll('link[rel="canonical"]').length).toBe(1);
    expect(canonicalHref()).toBe("https://www.inktracker.app/changelog");
    b.unmount();
  });
});
