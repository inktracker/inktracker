import { describe, it, expect } from "vitest";
import {
  timeAgo,
  unreadCount,
  markRead,
  markAllRead,
  removeById,
} from "../notifications.js";

const NOW = new Date("2026-05-14T12:00:00Z").getTime();
const secondsAgo = (n) => new Date(NOW - n * 1000).toISOString();

describe("timeAgo", () => {
  it("formats seconds", () => {
    expect(timeAgo(secondsAgo(5), NOW)).toBe("5s ago");
    expect(timeAgo(secondsAgo(59), NOW)).toBe("59s ago");
  });

  it("formats minutes", () => {
    expect(timeAgo(secondsAgo(60), NOW)).toBe("1m ago");
    expect(timeAgo(secondsAgo(3599), NOW)).toBe("59m ago");
  });

  it("formats hours", () => {
    expect(timeAgo(secondsAgo(3600), NOW)).toBe("1h ago");
    expect(timeAgo(secondsAgo(7200), NOW)).toBe("2h ago");
    expect(timeAgo(secondsAgo(86399), NOW)).toBe("23h ago");
  });

  it("formats days", () => {
    expect(timeAgo(secondsAgo(86400), NOW)).toBe("1d ago");
    expect(timeAgo(secondsAgo(172800), NOW)).toBe("2d ago");
  });

  it("handles falsy and invalid input by returning empty string", () => {
    expect(timeAgo(null, NOW)).toBe("");
    expect(timeAgo("", NOW)).toBe("");
    expect(timeAgo("garbage", NOW)).toBe("");
  });

  it("guards against clock skew (timestamp in the future)", () => {
    const future = new Date(NOW + 60_000).toISOString();
    expect(timeAgo(future, NOW)).toBe("just now");
  });
});

describe("unreadCount", () => {
  it("counts notifications where read is falsy", () => {
    expect(unreadCount([
      { id: "1", read: true },
      { id: "2", read: false },
      { id: "3" }, // missing read → unread
      { id: "4", read: null },
    ])).toBe(3);
  });

  it("returns 0 on empty / non-array input", () => {
    expect(unreadCount([])).toBe(0);
    expect(unreadCount(null)).toBe(0);
    expect(unreadCount(undefined)).toBe(0);
  });
});

describe("markRead", () => {
  const list = [{ id: "1", read: false }, { id: "2", read: false }];

  it("marks only the matching id as read", () => {
    const out = markRead(list, "1");
    expect(out).toEqual([{ id: "1", read: true }, { id: "2", read: false }]);
  });

  it("returns the same shape when id doesn't match", () => {
    const out = markRead(list, "999");
    expect(out).toEqual(list);
  });

  it("doesn't mutate the original list", () => {
    markRead(list, "1");
    expect(list[0].read).toBe(false);
  });

  it("returns [] for null input", () => {
    expect(markRead(null, "1")).toEqual([]);
  });
});

describe("markAllRead", () => {
  it("marks every notification as read", () => {
    const out = markAllRead([
      { id: "1", read: false },
      { id: "2", read: true },
      { id: "3" },
    ]);
    expect(out.every((n) => n.read === true)).toBe(true);
  });

  it("returns the same row reference for already-read items (no churn)", () => {
    const read = { id: "1", read: true };
    const out = markAllRead([read]);
    expect(out[0]).toBe(read);
  });
});

describe("removeById", () => {
  it("removes the matching notification", () => {
    const out = removeById([{ id: "1" }, { id: "2" }], "1");
    expect(out).toEqual([{ id: "2" }]);
  });

  it("returns the same content when no match", () => {
    const list = [{ id: "1" }];
    expect(removeById(list, "999")).toEqual(list);
  });
});
