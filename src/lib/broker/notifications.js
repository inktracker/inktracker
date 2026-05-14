// Pure-logic for BrokerNotificationFeed.jsx.
//
// timeAgo(dateStr, now)
//   → "5s ago" / "12m ago" / "3h ago" / "2d ago"
//
// unreadCount(list)
//   → number of notifications where read is falsy.
//
// markRead / markAllRead / removeById — pure transforms over the
// notifications array. Components call these to derive the next
// state without mutating in place.

export function timeAgo(dateStr, now = Date.now()) {
  if (!dateStr) return "";
  const t = new Date(dateStr).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Math.floor((now - t) / 1000);
  if (diff < 0) return "just now"; // clock skew safeguard
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function unreadCount(list) {
  if (!Array.isArray(list)) return 0;
  return list.filter((n) => !n.read).length;
}

export function markRead(list, id) {
  if (!Array.isArray(list)) return [];
  return list.map((n) => (n.id === id ? { ...n, read: true } : n));
}

export function markAllRead(list) {
  if (!Array.isArray(list)) return [];
  return list.map((n) => (n.read ? n : { ...n, read: true }));
}

export function removeById(list, id) {
  if (!Array.isArray(list)) return [];
  return list.filter((n) => n.id !== id);
}
