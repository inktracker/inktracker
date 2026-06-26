import { useState, useEffect } from "react";
import { base44 } from "@/api/supabaseClient";
import { CUSTOMER_PUBLIC_URL } from "@/lib/publicUrls";

// Embed snippets for shops to paste the Quote Wizard on their site.
// Used both in the standalone /Embed page (legacy route) and inline
// underneath the Wizard view itself (the collapsable section the page
// renders by default).
//
// Customer-facing iframe always points at the production app URL so
// the snippet doesn't break when the shop owner is on a vercel preview.

export default function EmbedSnippets() {
  const [copied, setCopied] = useState(null);
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    base44.auth.me().then(u => {
      if (u?.email) setUserEmail(u.email);
    }).catch(() => {});
  }, []);

  const shopParam = encodeURIComponent(userEmail);
  const WIZARD_URL = `${CUSTOMER_PUBLIC_URL}/QuoteRequest?shop=${shopParam}`;

  // height:100vh (not min-height) so the iframe has its own scroll
  // container. Without this, the iframe expands to its content height
  // and the host page scrolls — which means the price bar's sticky
  // positioning slides under the storefront's own header as the user
  // scrolls. With internal scroll, the price bar pins to the top of
  // the iframe (below the storefront nav) and stays visible
  // throughout. Existing embeds with min-height still work, just
  // without the always-visible price bar.
  const iframeSnippet = `<!-- InkTracker Quote Request Widget -->
<iframe
  src="${WIZARD_URL}"
  style="width:100%; height:100vh; border:none;"
  allow="clipboard-write"
  title="Request a Quote">
</iframe>`;

  function copy(text, key) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="grid gap-5">
      {/* Direct Link */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex justify-between items-center mb-2">
          <div>
            <h3 className="font-bold text-slate-800">Direct Link</h3>
            <p className="text-xs text-slate-500 mt-0.5">Share this URL anywhere — email, social, bio link</p>
          </div>
          <button onClick={() => copy(WIZARD_URL, "link")}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${copied==="link" ? "border-emerald-300 text-emerald-600 bg-emerald-50" : "border-slate-200 text-slate-500 hover:border-teal-300 hover:text-teal-600"}`}>
            {copied === "link" ? "✓ Copied!" : "Copy Link"}
          </button>
        </div>
        <div className="bg-slate-50 rounded-xl px-4 py-3 text-sm text-slate-600 font-mono border border-slate-100 break-all">{WIZARD_URL}</div>
      </div>

      {/* Generic iframe */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex justify-between items-center mb-2">
          <div>
            <h3 className="font-bold text-slate-800">Generic iframe (any website)</h3>
            <p className="text-xs text-slate-500 mt-0.5">Works on Wix, Squarespace, WordPress, and any custom site</p>
          </div>
          <button onClick={() => copy(iframeSnippet, "iframe")}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${copied==="iframe" ? "border-emerald-300 text-emerald-600 bg-emerald-50" : "border-slate-200 text-slate-500 hover:border-teal-300 hover:text-teal-600"}`}>
            {copied === "iframe" ? "✓ Copied!" : "Copy Code"}
          </button>
        </div>
        <pre className="bg-slate-50 rounded-xl p-4 text-xs text-slate-500 overflow-x-auto whitespace-pre border border-slate-100">{iframeSnippet}</pre>
      </div>

      {/* How it works */}
      <div className="bg-teal-50 border border-teal-100 rounded-2xl p-5">
        <h3 className="font-bold text-teal-800 mb-3">How it works</h3>
        <ol className="text-sm text-teal-700 space-y-2 list-decimal list-inside">
          <li>Customer fills out the wizard on your website</li>
          <li>They click "Submit Order Request"</li>
          <li>A new <strong>Pending</strong> quote instantly appears in your Quotes page</li>
          <li>You review, price-confirm, and approve it — all from this app</li>
        </ol>
        <div className="mt-3 text-xs text-teal-500">The wizard works without login — customers can submit directly from your website.</div>
      </div>
    </div>
  );
}
