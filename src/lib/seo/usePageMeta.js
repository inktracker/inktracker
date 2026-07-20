import { useEffect } from "react";

// Per-route <title> + <link rel="canonical"> for client-rendered public
// pages. The SPA ships a single static canonical (the homepage) baked into
// index.html, so without this every route — /terms, /support, /security,
// /privacy, /changelog — inherited the homepage canonical and Google folded
// them all into "/". This sets the correct canonical on mount (Google renders
// JS and reads it) and restores the site defaults on unmount so navigating
// away never leaves a stale canonical behind.
//
// Canonical host is pinned to the production origin on purpose: a canonical
// must be stable regardless of preview/staging overrides, and it has to match
// the www host that index.html + sitemap.xml already emit.
const CANON_BASE = "https://www.inktracker.app";
const DEFAULT_TITLE = "InkTracker — Screen Printing Shop Management Software";
const DEFAULT_CANONICAL = `${CANON_BASE}/`;

function setCanonical(href) {
  let link = document.head.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.appendChild(link);
  }
  link.setAttribute("href", href);
}

export function usePageMeta({ title, path }) {
  useEffect(() => {
    if (title) document.title = title;
    setCanonical(`${CANON_BASE}${path || "/"}`);
    return () => {
      document.title = DEFAULT_TITLE;
      setCanonical(DEFAULT_CANONICAL);
    };
  }, [title, path]);
}
