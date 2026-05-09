import { useState, useEffect } from "react";
import { base44 } from "@/api/supabaseClient";
import { CUSTOMER_PUBLIC_URL } from "@/lib/publicUrls";

// Customers will paste the embed snippet on their website — always point at
// the production domain so it doesn't break when shop owner is on a vercel preview.
const APP_URL = CUSTOMER_PUBLIC_URL;

export default function Embed() {
  const [copied, setCopied] = useState(null);
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    base44.auth.me().then(u => {
      if (u?.email) setUserEmail(u.email);
    }).catch(() => {});
  }, []);

  const shopParam = encodeURIComponent(userEmail);
  const WIZARD_URL = `${APP_URL}/QuoteRequest?shop=${shopParam}`;

  const iframeSnippet = `<!-- InkTracker Quote Request Widget -->
<iframe
  src="${APP_URL}/QuoteRequest?shop=${shopParam}"
  style="width:100%; min-height:1000px; border:none;"
  allow="clipboard-write"
  title="Request a Quote">
</iframe>`;

  const shopifySnippet = `<!-- Add to Shopify: Theme Editor → Custom Liquid section -->
<div style="max-width:960px; margin:0 auto; padding:0 16px;">
  <iframe
    src="${APP_URL}/QuoteRequest?shop=${shopParam}"
    style="width:100%; min-height:1000px; border:none;"
    allow="clipboard-write"
    title="Request a Quote">
  </iframe>
</div>`;

  function copy(text, key) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-slate-900">Embed Quote Wizard</h2>
      <p className="text-slate-500 text-sm">Paste one of these snippets into your website so customers can submit quote requests directly — they'll show up in your Quotes page automatically.</p>

      <div className="grid gap-5">

        {/* Direct Link */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex justify-between items-center mb-2">
            <div>
              <h3 className="font-bold text-slate-800">Direct Link</h3>
              <p className="text-xs text-slate-400 mt-0.5">Share this URL anywhere — email, social, bio link</p>
            </div>
            <button onClick={() => copy(WIZARD_URL, "link")}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${copied==="link" ? "border-emerald-300 text-emerald-600 bg-emerald-50" : "border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600"}`}>
              {copied === "link" ? "✓ Copied!" : "Copy Link"}
            </button>
          </div>
          <div className="bg-slate-50 rounded-xl px-4 py-3 text-sm text-slate-600 font-mono border border-slate-100 break-all">{WIZARD_URL}</div>
        </div>

        {/* Shopify */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex justify-between items-center mb-2">
            <div>
              <h3 className="font-bold text-slate-800">Shopify Embed</h3>
              <p className="text-xs text-slate-400 mt-0.5">In Shopify: Pages → Add page → Insert Custom HTML → paste this</p>
            </div>
            <button onClick={() => copy(shopifySnippet, "shopify")}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${copied==="shopify" ? "border-emerald-300 text-emerald-600 bg-emerald-50" : "border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600"}`}>
              {copied === "shopify" ? "✓ Copied!" : "Copy Code"}
            </button>
          </div>
          <pre className="bg-slate-50 rounded-xl p-4 text-xs text-slate-500 overflow-x-auto whitespace-pre border border-slate-100">{shopifySnippet}</pre>
          <div className="mt-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-700">
            <strong>Shopify tip:</strong> In your Theme Editor, add a <strong>Custom Liquid</strong> section to your quote page and paste this code. The rich text editor may strip iframes — Custom Liquid is the most reliable method.
          </div>
        </div>

        {/* Generic iframe */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex justify-between items-center mb-2">
            <div>
              <h3 className="font-bold text-slate-800">Generic iframe (any website)</h3>
              <p className="text-xs text-slate-400 mt-0.5">Works on Wix, Squarespace, WordPress, and any custom site</p>
            </div>
            <button onClick={() => copy(iframeSnippet, "iframe")}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${copied==="iframe" ? "border-emerald-300 text-emerald-600 bg-emerald-50" : "border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600"}`}>
              {copied === "iframe" ? "✓ Copied!" : "Copy Code"}
            </button>
          </div>
          <pre className="bg-slate-50 rounded-xl p-4 text-xs text-slate-500 overflow-x-auto whitespace-pre border border-slate-100">{iframeSnippet}</pre>
        </div>

        {/* How it works */}
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-5">
          <h3 className="font-bold text-indigo-800 mb-3">How it works</h3>
          <ol className="text-sm text-indigo-700 space-y-2 list-decimal list-inside">
            <li>Customer fills out the wizard on your Shopify page</li>
            <li>They click "Submit Order Request"</li>
            <li>A new <strong>Pending</strong> quote instantly appears in your Quotes page</li>
            <li>You review, price-confirm, and approve it — all from this app</li>
          </ol>
          <div className="mt-3 text-xs text-indigo-500">The wizard works without login — customers can submit directly from your website.</div>
        </div>
      </div>
    </div>
  );
}