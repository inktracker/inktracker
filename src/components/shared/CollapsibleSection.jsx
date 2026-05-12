// Collapsible section header — used by detail modals (quotes, orders,
// invoices) to let users hide noisy sub-sections like the Messages
// thread. State optionally persists to localStorage so the user's
// "I always want this collapsed" preference survives across sessions.
//
// Usage:
//   <CollapsibleSection
//     title="Messages"
//     icon={<MessageSquare className="w-4 h-4 text-slate-500" />}
//     storageKey="messages-window-collapsed"
//   >
//     <MessagesTab ... />
//   </CollapsibleSection>

import { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";

export default function CollapsibleSection({
  title,
  icon,
  children,
  storageKey,         // optional — localStorage key for persistence
  defaultCollapsed = false,
  className = "",
}) {
  // Initialize from localStorage if a key is provided; otherwise
  // fall through to the prop default. Wrapped in a function so it
  // runs once on mount (vs every render).
  const [collapsed, setCollapsed] = useState(() => {
    if (!storageKey) return defaultCollapsed;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === "true")  return true;
      if (stored === "false") return false;
    } catch (_) { /* ignore — private mode / disabled storage */ }
    return defaultCollapsed;
  });

  useEffect(() => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, collapsed ? "true" : "false"); }
    catch (_) { /* ignore */ }
  }, [storageKey, collapsed]);

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex items-center gap-2 w-full text-left mb-3 group focus:outline-none"
      >
        {icon}
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex-1">
          {title}
        </h3>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 group-hover:text-slate-600 transition-transform duration-200 ${
            collapsed ? "-rotate-90" : "rotate-0"
          }`}
          aria-hidden="true"
        />
      </button>
      {!collapsed && children}
    </div>
  );
}
