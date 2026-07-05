import { useState, useEffect } from "react";
import { base44 } from "@/api/supabaseClient";
import { CenteredCardSkeleton } from "@/components/shared/Skeletons";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Lock,
  CreditCard,
  MapPin,
} from "lucide-react";
import {
  calcQuoteTotals,
  calcLinkedLinePrice,
  buildLinkedQtyMap,
  getLineExtras,
  fmtMoney,
  fmtDate,
  getQty,
  BIG_SIZES,
  sortSizeEntries,
} from "../components/shared/pricing";
import { resolveCheckoutTarget } from "@/lib/payment/resolveCheckoutTarget";
import { artworkProxyUrl } from "@/lib/artwork/proxyUrl";
import { toCustomerFacingQuote, customerFacingShopName, customerFacingTotals, isBrokerQuote } from "@/lib/quotes/customerFacingQuote";
import { normalizeAdditionalCharges } from "@/lib/pricing/additionalCharges";
import { isQbStale } from "@/lib/quotes/qbStale";
import { quoteAlreadyApproved, quoteAlreadyPaid } from "@/lib/quotes/approvalState";
import { imprintCountText } from "@/lib/quotes/imprintLabels";
import { savedAfterDiscount } from "@/lib/quotes/effectiveTotals";
import ArtworkPreviewOverlay from "@/components/shared/ArtworkPreviewOverlay";

function cleanText(value) {
  return String(value || "").trim();
}

function looksLikeCode(value) {
  const txt = cleanText(value);
  if (!txt) return false;
  return /^[A-Z0-9-]{2,30}$/i.test(txt) && /\d/.test(txt) && !txt.includes(" ");
}

function isWarehouseSku(value) {
  const txt = cleanText(value).toUpperCase();
  if (!txt) return false;
  return /^0\d{3,}$/.test(txt) || /^\d{5,}$/.test(txt);
}

function extractTrailingCode(title) {
  const txt = cleanText(title);
  if (!txt) return "";
  const match = txt.match(/-\s*([A-Z0-9-]{2,30})$/i);
  return match ? cleanText(match[1]).toUpperCase() : "";
}

function stripTrailingCode(title) {
  const txt = cleanText(title);
  if (!txt) return "";
  return txt.replace(/\s*-\s*[A-Z0-9-]{2,30}\s*$/i, "").trim();
}

function getPreferredGarmentNumber(li) {
  const candidates = [
    li?.supplierStyleNumber,
    li?.resolvedStyleNumber,
    li?.styleNumber,
    li?.garmentNumber,
    li?.productNumber,
  ];

  for (const candidate of candidates) {
    const value = cleanText(candidate).toUpperCase();
    if (!value) continue;
    if (isWarehouseSku(value)) continue;
    if (!looksLikeCode(value)) continue;
    return value;
  }

  const productTitleTail = extractTrailingCode(li?.productTitle);
  if (productTitleTail && !isWarehouseSku(productTitleTail)) {
    return productTitleTail;
  }

  const resolvedTitleTail = extractTrailingCode(li?.resolvedTitle);
  if (resolvedTitleTail && !isWarehouseSku(resolvedTitleTail)) {
    return resolvedTitleTail;
  }

  return cleanText(li?.style) || "Garment";
}

function getPreferredGarmentDescription(li) {
  const candidates = [
    cleanText(li?.resolvedDescription),
    cleanText(li?.productDescription),
    cleanText(li?.product_description),
    cleanText(li?.garmentName),
    cleanText(li?.styleName),
    cleanText(li?.description),
    stripTrailingCode(li?.productTitle),
    stripTrailingCode(li?.resolvedTitle),
    cleanText(li?.title),
    cleanText(li?.displayName),
  ];

  const garmentNumber = getPreferredGarmentNumber(li).toLowerCase();

  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = candidate.toLowerCase();

    if (normalized === garmentNumber) continue;
    if (looksLikeCode(candidate)) continue;
    if (normalized === "shirt") continue;
    if (normalized === "garment") continue;

    // Strip trailing style number from descriptions like "Comfort Colors — 1717"
    const stripped = candidate.replace(/\s*[—–-]\s*\d{3,5}[A-Z]?\s*$/i, "").trim();
    if (stripped && stripped.toLowerCase() !== garmentNumber) return stripped;
    if (stripped) return stripped;
  }

  if (cleanText(li?.brand)) return cleanText(li.brand);
  return "";
}

function getGarmentHeader(li) {
  const number = getPreferredGarmentNumber(li);
  const description = getPreferredGarmentDescription(li);
  return description ? `${number} - ${description}` : number;
}

function getLineItemPricing(li, quote) {
  const qty = getQty(li);

  if (!qty) {
    return { qty: 0, pricing: null, lineTotal: 0, perPiece: 0 };
  }

  // Use saved pricing when available (stamped at save time)
  if (li._ppp != null && li._lineTotal != null) {
    return {
      qty,
      pricing: { ppp: li._ppp, lineTotal: li._lineTotal, rushFee: li._rushFee || 0 },
      lineTotal: li._lineTotal,
      perPiece: li._ppp,
    };
  }

  // Legacy fallback
  const linkedQtyMap = buildLinkedQtyMap(quote.line_items || []);
  const pricing = calcLinkedLinePrice(li, quote.rush_rate, getLineExtras(li, quote), undefined, linkedQtyMap);
  const lineTotal = pricing ? pricing.lineTotal : 0;
  const perPiece = qty > 0 ? lineTotal / qty : 0;

  return { qty, pricing, lineTotal, perPiece };
}

// buildCheckoutLineItems + decideCustomerCharge moved to
// src/lib/quotes/customerCharge.js so they're testable. See
// __tests__/customerCharge.test.js for the pinned contracts:
//   CT1–CT6  effectiveCustomerTotal priority (qb > saved > live)
//   DC1–DC8  deposit / remaining / full math
//   BL1–BL5  Stripe line-item shape + refuse-on-$0 contract
//   XC1–XC4  end-to-end "Stripe charges what the email said"

export default function QuotePayment() {
  const [quote, setQuote] = useState(null);
  const [shop, setShop] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // checkoutLoading was used by the removed Stripe path. Keeping the
  // variable name in the JSX (alongside approveLoading) — always false
  // now so the button disable state degrades to "while approving" only.
  const checkoutLoading = false;
  const [checkoutError, setCheckoutError] = useState("");
  const [recaptchaReady, setRecaptchaReady] = useState(false);
  const [approveLoading, setApproveLoading] = useState(false);
  const [approveError, setApproveError] = useState("");
  const [approveSuccess, setApproveSuccess] = useState(false);
  const [previewArt, setPreviewArt] = useState(null);

  const RECAPTCHA_SITE_KEY = "6LdFgbIsAAAAAKlrO8Sv9y-3HUJv4f-1hjHEjsi9";
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

  const params = new URLSearchParams(window.location.search);
  const quoteDbId = params.get("id");
  // public_token gates anonymous access. Without it the edge function returns 404.
  const publicToken = params.get("token");

  useEffect(() => {
    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`;
    script.onload = () => setRecaptchaReady(true);
    document.head.appendChild(script);
    return () => document.head.removeChild(script);
  }, []);

  useEffect(() => {
    if (!quoteDbId) {
      setError("No quote ID provided.");
      setLoading(false);
      return;
    }
    if (!publicToken) {
      setError("This quote link is missing a security token. Please use the link from your email.");
      setLoading(false);
      return;
    }

    async function load() {
      try {
        const response = await base44.functions.invoke("createCheckoutSession", {
          action: "getQuote",
          quoteId: quoteDbId,
          token: publicToken,
        });

        if (response?.data?.error) {
          setError(response.data.error);
          setLoading(false);
          return;
        }

        if (!response?.data?.quote) {
          setError("Quote not found.");
          setLoading(false);
          return;
        }

        setQuote(response.data.quote);
        setShop(response.data.shop || null);
        setCustomer(response.data.customer || null);
      } catch (err) {
        setError("Failed to load quote. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [quoteDbId]);

  const alreadyPaid = quoteAlreadyPaid(quote);

  // Includes "Converted to Order" / "Client Approved" / converted_order_id —
  // a stale emailed link re-opened after conversion must render as already
  // approved, never offer a live Approve action (the server would refuse the
  // write anyway; see _shared/approveQuoteEffect.js).
  const alreadyApproved = quoteAlreadyApproved(quote);

  const isExpired = (() => {
    if (!quote?.expires_date) return false;
    if (alreadyApproved || alreadyPaid) return false;
    return new Date(quote.expires_date) < new Date();
  })();

  // ── Payment-provider availability ──────────────────────────────────
  // Stripe Connect was removed for the initial launch — QuickBooks is the
  // only customer-payment path. The customer needs a usable QB payment
  // link or the page falls back to Approve-only ("pay out-of-band").
  // resolveCheckoutTarget already rejects legacy login-required Intuit
  // URLs so qbAvailable here means a real customer-facing share link.
  // If the quote was edited after its QB invoice was created (e.g. a fee added),
  // qb_total is stale and the QB payment link would charge the OLD lower amount.
  // Block QB payment until the shop regenerates — better the customer approves
  // and waits for a correct link than underpays.
  const qbStaleFlag = isQbStale(quote);
  const qbCheckoutTarget = resolveCheckoutTarget(quote);
  // Broker quotes: the QB invoice/link is the shop→broker WHOLESALE charge,
  // not the broker's end-client price. Never route the end client to it —
  // fall back to approve-only so the broker collects from their client
  // out-of-band. (Display totals are likewise gated via customerFacingTotals.)
  const qbAvailable = qbCheckoutTarget.provider === "qb" && Boolean(qbCheckoutTarget.url) && !qbStaleFlag && !isBrokerQuote(quote);
  const canCollectPayment = qbAvailable;

  async function handleApprove() {
    if (!quote?.id) return false;

    setApproveLoading(true);
    setApproveError("");
    setApproveSuccess(false);

    try {
      const response = await base44.functions.invoke("createCheckoutSession", {
        action: "approveQuote",
        quoteId: quote.id,
        token: publicToken,
      });

      if (response?.data?.error) {
        setApproveError(response.data.error);
        return false;
      }

      if (response?.data?.quote) {
        setQuote(response.data.quote);
        if (response.data.shop) setShop(response.data.shop);
        if (response.data.customer) setCustomer(response.data.customer);
      }

      setApproveSuccess(true);
      return true;
    } catch (err) {
      setApproveError(err?.message || "Unable to approve quote right now.");
      return false;
    } finally {
      setApproveLoading(false);
    }
  }

  async function handleCheckout() {
    setCheckoutError("");

    // Verify reCAPTCHA
    if (recaptchaReady && window.grecaptcha) {
      try {
        const token = await window.grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: "checkout" });
        const { data: verifyData, error: invErr } = await base44.functions.invoke("verifyRecaptcha", { token });
        if (invErr) {
          console.warn("[QuotePayment] reCAPTCHA verify failed:", invErr.message);
          // Don't block — Stripe Checkout has its own fraud prevention
        } else if (!verifyData?.success) {
          console.warn("[QuotePayment] reCAPTCHA score too low:", verifyData?.score);
        }
      } catch {
        // If reCAPTCHA itself errors (blocked, network), allow through
      }
    }

    // Same predicate as the render gate — converted / client-approved quotes
    // must not auto-fire another approveQuote before checkout.
    if (!quoteAlreadyApproved(quote)) {
      const approved = await handleApprove();
      if (!approved) return;
    }

    if (window.self !== window.top) {
      alert("Payment checkout requires opening in a new window. Please open this page directly in your browser.");
      window.open(window.location.href, "_blank");
      return;
    }

    // Prefer QB payment page when the link is a real customer-facing payment
    // URL. resolveCheckoutTarget rejects anything that would land the customer
    // at an Intuit login screen.
    const qbTarget = resolveCheckoutTarget(quote);
    if (qbTarget.provider === "qb" && qbTarget.url) {
      window.location.href = qbTarget.url;
      return;
    }

    // Stripe Connect was removed for the initial launch — QuickBooks is
    // the only payment path. If we got here without a usable QB link
    // (e.g. the shop sent the quote before connecting QB), tell the
    // customer to reach out to the shop instead of silently failing.
    setCheckoutError(
      "Online payment isn't available on this quote yet. Please contact the shop directly to arrange payment.",
    );
  }

  if (loading) {
    return <CenteredCardSkeleton />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 max-w-md w-full text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">
            Quote Not Found
          </h2>
          <p className="text-slate-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  // For broker quotes, swap client_* fields onto the standard ones so
  // every customer-facing read below picks up the client price the
  // broker quoted (e.g. $753), not the broker-side wholesale ($646).
  // toCustomerFacingQuote is a no-op for non-broker quotes. The saved
  // quote row is not mutated — this is a derived view used only for
  // display on this page.
  const displayQuote = toCustomerFacingQuote(quote);

  // Customer-facing brand name. For broker quotes the end client must
  // see the broker as the merchant of record; the print shop is
  // invisible by design. Shared helper so the email header, the page
  // header here, and any future surface all resolve identically.
  const displayShopName = customerFacingShopName({
    quote,
    shopName: shop?.shop_name,
    fallback: "Shop",
  });

  // Use saved totals when available (calculate-once principle)
  const totals = (displayQuote.total != null && displayQuote.subtotal != null)
    ? {
        sub: Number(displayQuote.subtotal),
        subtotal: Number(displayQuote.subtotal),
        rushTotal: 0,
        afterDisc: savedAfterDiscount(displayQuote),
        tax: Number(displayQuote.tax || 0),
        total: Number(displayQuote.total),
      }
    : calcQuoteTotals(displayQuote);

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-slate-900 rounded-2xl px-4 sm:px-8 py-6 flex items-center gap-4">
          {shop?.logo_url ? (
            <img
              src={shop.logo_url}
              alt="Logo"
              className="w-12 h-12 object-contain rounded-lg"
            />
          ) : (
            <div className="w-12 h-12 bg-teal-600 rounded-lg flex items-center justify-center text-white font-black text-xl">
              {(displayShopName || "S")[0]}
            </div>
          )}
          <div className="flex-1">
            <div className="text-white font-bold text-lg leading-tight">
              {displayShopName}
            </div>
            <div className="text-slate-500 text-sm">
              Quote #{quote.quote_id}
            </div>
          </div>
          <div className="text-right">
            <div className="text-slate-500 text-xs uppercase tracking-wide mb-0.5">
              QUOTE
            </div>
            {quote.date && (
              <div className="text-slate-300 text-sm">{fmtDate(quote.date)}</div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 sm:px-8 py-6">
          <div className="flex flex-wrap justify-between gap-4">
            <div>
              {customer?.company && (
                <div className="text-xl font-black text-slate-900">
                  {customer.company}
                </div>
              )}
              <div
                className={`font-semibold text-slate-700 ${
                  customer?.company
                    ? "text-base mt-0.5"
                    : "text-xl font-black text-slate-900"
                }`}
              >
                {quote.customer_name}
              </div>
              {(quote.customer_email || quote.sent_to) && (
                <div className="text-sm text-slate-500 mt-0.5">
                  {quote.customer_email || quote.sent_to}
                </div>
              )}
            </div>
            <div className="text-right text-sm space-y-1">
              {quote.date && (
                <div>
                  <span className="text-slate-500">Date: </span>
                  <span className="font-semibold text-slate-700">
                    {fmtDate(quote.date)}
                  </span>
                </div>
              )}
              {quote.due_date && (
                <div>
                  <span className="text-slate-500">In-Hands: </span>
                  <span className="font-semibold text-teal-700">
                    {fmtDate(quote.due_date)}
                  </span>
                </div>
              )}
              {quote.status && (
                <div>
                  <span className="text-slate-500">Status: </span>
                  <span className="font-semibold text-slate-700">
                    {quote.status}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Art proof / mockups — so the customer can review the proof before
            approving. Reads selected_artwork (the shop's attached proofs). The
            bucket is public, so public URLs render; the overlay's signed-URL
            sign falls back to the public URL for anon viewers. */}
        {(() => {
          const proofs = (displayQuote.selected_artwork || [])
            .filter((a) => a && (a.url || a.file_url))
            .map((a) => {
              const fallback = a.url || a.file_url;
              // M-1: render via the token-gated proxy so the (soon-private)
              // bucket stays sealed. Falls back to the existing url if we can't
              // build a proxy link, and via <img onError> while the bucket is
              // still public — so nothing breaks during the transition.
              const src = artworkProxyUrl({ type: "quote", id: quote.id, token: publicToken, pathOrUrl: a.path || fallback }) || fallback;
              return { ...a, _src: src, _fallback: fallback };
            });
          if (proofs.length === 0) return null;
          const isPdf = (a) => /\.pdf(\?|$)/i.test(a.url || a.file_url || a.name || "");
          return (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 sm:px-8 py-6">
              <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3 mb-4">
                Art Proof
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {proofs.map((a, i) => (
                  <button
                    key={a.id || a.url || i}
                    type="button"
                    onClick={() => setPreviewArt({ ...a, url: a._src, file_url: a._src, path: null })}
                    className="group relative aspect-square rounded-xl border border-slate-200 bg-slate-50 overflow-hidden hover:border-teal-400 hover:shadow-md transition"
                    title={`${a.name || "Artwork"} — click to enlarge`}
                  >
                    {isPdf(a) ? (
                      <object
                        data={`${a._src}#toolbar=0&navpanes=0&view=FitH`}
                        type="application/pdf"
                        className="w-full h-full pointer-events-none"
                        aria-label={a.name || "PDF proof"}
                      />
                    ) : (
                      <img
                        src={a._src}
                        onError={(e) => { if (a._fallback && e.currentTarget.src !== a._fallback) e.currentTarget.src = a._fallback; }}
                        alt={a.name || "Art proof"}
                        className="w-full h-full object-contain"
                      />
                    )}
                    <span className="absolute inset-x-0 bottom-0 bg-black/55 text-white text-[10px] px-1.5 py-1 truncate opacity-0 group-hover:opacity-100 transition">
                      {a.name || "Artwork"}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-3">
                Click any proof to enlarge. Approved proofs are final.
              </p>
            </div>
          );
        })()}

        {(displayQuote.line_items || []).length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 sm:px-8 py-6 space-y-5">
            <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
              Quote Details
            </h3>

            {displayQuote.line_items.map((li, idx) => {
              const activeSizes = sortSizeEntries(Object.entries(li.sizes || {})).filter(
                ([, v]) => parseInt(v, 10) > 0
              );
              const { qty, lineTotal, perPiece } = getLineItemPricing(li, displayQuote);
              const displayHeader = getGarmentHeader(li);

              return (
                <div
                  key={li.id || idx}
                  className="border border-slate-100 rounded-xl overflow-hidden"
                >
                  <div className="bg-slate-50 px-4 py-3 flex justify-between items-center gap-4">
                    <div>
                      <div className="font-bold text-slate-900">
                        {displayHeader}
                      </div>
                      <div className="text-slate-500 text-sm mt-0.5">
                        {li.brand ? `Brand: ${li.brand}` : ""}
                        {li.brand && li.garmentColor ? " • " : ""}
                        {li.garmentColor ? `Color: ${li.garmentColor}` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-teal-700">
                        {fmtMoney(lineTotal)}
                      </div>
                      {qty > 0 && (
                        <div className="text-xs text-slate-500">
                          {fmtMoney(perPiece)} each
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="px-4 py-3 space-y-3">
                    {activeSizes.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="text-xs w-auto">
                          <thead>
                            <tr>
                              <th className="text-left text-slate-500 font-semibold pr-4 py-1 w-16"></th>
                              {activeSizes.map(([sz]) => (
                                <th
                                  key={sz}
                                  className="text-center text-slate-500 font-semibold px-3 py-1"
                                >
                                  {sz}
                                </th>
                              ))}
                              <th className="text-center text-slate-500 font-bold px-3 py-1">
                                Total
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="text-slate-500 pr-4 py-1">Qty</td>
                              {activeSizes.map(([sz, v]) => (
                                <td
                                  key={sz}
                                  className="text-center font-bold text-slate-900 px-3 py-1"
                                >
                                  {v}
                                </td>
                              ))}
                              <td className="text-center font-bold text-slate-900 px-3 py-1">
                                {qty}
                              </td>
                            </tr>
                            <tr>
                              <td className="text-slate-500 pr-4 py-1">Price/ea</td>
                              {activeSizes.map(([sz]) => {
                                const isBig = BIG_SIZES.includes(sz);
                                return (
                                  <td
                                    key={sz}
                                    className="text-center text-slate-500 px-3 py-1"
                                  >
                                    {fmtMoney(perPiece)}
                                  </td>
                                );
                              })}
                              <td className="text-center font-bold text-teal-700 px-3 py-1">
                                {fmtMoney(lineTotal)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {(li.imprints || [])
                      .filter((imp) => imp.colors > 0 || imp.location)
                      .map((imp, iIdx) => (
                        <div
                          key={imp.id || iIdx}
                          className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs border-t border-slate-50 pt-2 text-slate-500"
                        >
                          <span className="flex items-center gap-1 text-teal-600 font-semibold">
                            <MapPin className="w-3 h-3" />
                            {imp.title
                              ? `${imp.title} · ${imp.location || "Location"}`
                              : imp.location || "Location"}
                          </span>
                          {/* Embroidery imp.colors is a stitch-tier index, not a
                              color count — render "5K-10K stitches" for embroidery,
                              "N colors" otherwise. Customer has no shop config, so
                              default stitch tiers are used. */}
                          {imprintCountText(imp) && (
                            <span>{imprintCountText(imp)}</span>
                          )}
                          {imp.technique && <span>· {imp.technique}</span>}
                          {imp.pantones && (
                            <span className="text-teal-600">· {imp.pantones}</span>
                          )}
                          {(imp.width || imp.height) && (
                            <span className="text-slate-500">
                              ·{" "}
                              {[
                                imp.width && `${imp.width}"W`,
                                imp.height && `${imp.height}"H`,
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            </span>
                          )}
                          {imp.details && (
                            <span className="italic text-slate-500">
                              · {imp.details}
                            </span>
                          )}
                        </div>
                      ))}
                    {Array.isArray(li._addon_labels) && li._addon_labels.filter(Boolean).length > 0 && (
                      <div className="text-xs text-slate-500 border-t border-slate-50 pt-2">
                        <span className="font-semibold text-slate-600">Add-ons: </span>
                        {li._addon_labels.filter(Boolean).join(", ")}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 sm:px-8 py-6">
          <div className="space-y-2 mb-5">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Subtotal</span>
              <span className="font-semibold text-slate-800">
                {fmtMoney(totals.sub)}
              </span>
            </div>

            {(parseFloat(quote.discount) || 0) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">
                  Discount {(quote.discount_type === "flat" || (parseFloat(quote.discount) > 100 && quote.discount_type !== "percent")) ? `($${parseFloat(quote.discount).toFixed(2)})` : `(${quote.discount}%)`}
                </span>
                <span className="font-semibold text-emerald-600">
                  −{fmtMoney(totals.sub - totals.afterDisc)}
                </span>
              </div>
            )}

            {/* Setup / screen fees — itemized so the jump from subtotal to
                total isn't a mystery charge. Reads the saved setup_total
                (snapshot invariant). */}
            {(parseFloat(displayQuote.setup_total) || 0) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Setup &amp; Screen Fees</span>
                <span className="font-semibold text-slate-800">
                  {fmtMoney(Number(displayQuote.setup_total))}
                </span>
              </div>
            )}

            {/* Additional fees — each one-off charge as its own labeled line.
                Lines (subtotal − disc + setup + these + tax) sum to the total. */}
            {normalizeAdditionalCharges(displayQuote.additional_charges).map((c) => (
              <div key={c.id || c.label} className="flex justify-between text-sm">
                <span className="text-slate-500">{c.label || "Additional fee"}</span>
                <span className="font-semibold text-slate-800">{fmtMoney(c.amount)}</span>
              </div>
            ))}

            {(() => {
              // Stale QB total (quote edited after invoice created) → fall back
              // to the quote's real saved total so the customer sees the right
              // amount; payment is also gated off above until regenerated.
              // Broker quotes never use the shop-side qb_total (wholesale) —
              // customerFacingTotals returns the client totals for them.
              const cft = customerFacingTotals(quote, {
                qbStale: qbStaleFlag,
                fallbackTax: totals.tax,
                fallbackTotal: totals.total,
              });
              const hasQb = cft.isQbAuthoritative;
              const taxLabel = hasQb ? "Tax" : `Est. Tax (${displayQuote.tax_rate}%)`;
              const totalLabel = hasQb ? "Total Due" : "Est. Total";
              const taxValue = hasQb ? cft.tax : totals.tax;
              const totalValue = hasQb ? cft.total : totals.total;
              return (
                <>
                  {(hasQb ? taxValue > 0 : (parseFloat(displayQuote.tax_rate) || 0) > 0) && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">{taxLabel}</span>
                      <span className="font-semibold text-slate-800">{fmtMoney(taxValue)}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-3 border-t border-slate-200">
                    <span className="font-bold text-slate-900 text-base">{totalLabel}</span>
                    <span className="text-2xl font-black text-teal-700">{fmtMoney(totalValue)}</span>
                  </div>
                  {!hasQb && (
                    <div className="text-[11px] text-slate-500 text-right -mt-1">
                      {/* TAX-02: this branch only renders for non-QB quotes, whose
                          tax is the shop's flat rate — there is no ship-to-based
                          recalculation at checkout (Stripe charges the saved total
                          as-is), so don't claim one. */}
                      Estimated using the shop&rsquo;s sales-tax rate.
                    </div>
                  )}
                </>
              );
            })()}
            <div className="text-[10px] text-slate-500 italic leading-snug pt-2 border-t border-slate-100 mt-1 space-y-2">
              <p>
                Sales tax shown reflects jurisdictions where we are registered to collect.
                Buyer is responsible for any use tax owed to their home jurisdiction.
              </p>
              <p>
                Production tolerance: industry-standard spoilage applies. Orders short up to 3%
                will receive a credit to your account. Defect rates above 3% will be reprinted
                at no charge within 7–10 business days. Claims must be submitted with photos
                within 72 hours of delivery. Misprinted garments do not need to be returned.
                Approved proofs are final.
              </p>
            </div>
          </div>

          {quote.notes && (
            <div className="mb-4 bg-slate-50 rounded-xl px-4 py-3 text-sm text-slate-600 border border-slate-100">
              <span className="font-semibold text-slate-700">Notes: </span>
              {quote.notes}
            </div>
          )}

          {approveSuccess && !alreadyPaid && (
            <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-800 font-medium">
              Quote approved successfully.
            </div>
          )}

          {approveError && (
            <div role="alert" className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <span className="text-sm text-red-700">{approveError}</span>
            </div>
          )}

          {isExpired ? (
            <div className="w-full bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-5 py-4 text-center">
              <div className="font-bold text-base mb-1">This quote has expired</div>
              <div className="text-sm text-amber-700">
                The quote expiration date was {fmtDate(quote.expires_date)}. Please contact{" "}
                {customerFacingShopName({ quote, shopName: shop?.shop_name, fallback: "the shop" })} to request an updated quote.
              </div>
            </div>
          ) : alreadyPaid ? (
            <div className="w-full bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold py-4 rounded-xl flex items-center justify-center gap-2 text-base">
              <CheckCircle2 className="w-5 h-5" />
              Paid — Thank You!
            </div>
          ) : !canCollectPayment ? (
            /* Shop has neither QB nor an active Stripe Connect account.
               Show Approve-only — the customer signals consent here and
               the shop handles payment out-of-band. */
            alreadyApproved ? (
              /* Already approved (or converted to an order) — a re-opened
                 email link shows the settled state, not a live button.
                 approveSuccess already renders its own banner above, so
                 skip this one right after a fresh click. */
              !approveSuccess && (
                <div className="w-full bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-5 py-4 text-center">
                  <div className="font-bold text-base mb-1 flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-5 h-5" />
                    Quote approved
                  </div>
                  <div className="text-sm text-emerald-700">
                    {customerFacingShopName({ quote, shopName: shop?.shop_name, fallback: "The shop" })} will be in touch about payment.
                  </div>
                </div>
              )
            ) : (
            <>
              {approveError && (
                <div role="alert" className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <span className="text-sm text-red-700">{approveError}</span>
                </div>
              )}
              <button
                onClick={handleApprove}
                disabled={approveLoading}
                className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white font-bold py-4 rounded-xl transition flex items-center justify-center gap-2 text-base"
              >
                {approveLoading ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Approving…</>
                ) : (
                  <><CheckCircle2 className="w-5 h-5" /> Approve Quote</>
                )}
              </button>
              <p className="mt-3 text-center text-xs text-slate-500">
                {customerFacingShopName({ quote, shopName: shop?.shop_name, fallback: "The shop" })} will be in touch about payment after you approve.
              </p>
            </>
            )
          ) : (() => {
            // Broker quotes charge the client total, never the shop-side qb_total.
            // Coerce to a finite number — a missing/NaN total would render
            // "$NaN" on the pay CTA (FE-10).
            const effectiveTotal = Number(customerFacingTotals(quote, {
              qbStale: qbStaleFlag,
              fallbackTotal: totals.total,
            }).total) || 0;
            const depositPct = customer?.default_deposit_pct != null
              ? Number(customer.default_deposit_pct) || 0
              : parseFloat(quote?.deposit_pct) || 0;
            const depositAmount = Math.round(effectiveTotal * (depositPct / 100) * 100) / 100;
            const depositPaid = quote?.deposit_paid;

            let buttonLabel = `Approve & Pay ${fmtMoney(effectiveTotal)}`;
            let subLabel = null;
            if (depositPct > 0 && !depositPaid) {
              buttonLabel = `Approve & Pay Deposit ${fmtMoney(depositAmount)}`;
              subLabel = `${depositPct}% deposit · full total ${fmtMoney(effectiveTotal)}`;
            } else if (depositPct > 0 && depositPaid) {
              const balance = Math.round((effectiveTotal - depositAmount) * 100) / 100;
              buttonLabel = `Pay Remaining Balance ${fmtMoney(balance)}`;
              subLabel = `Deposit of ${fmtMoney(depositAmount)} already paid`;
            }

            const securityLabel = qbAvailable
              ? "Secure payment powered by QuickBooks"
              : "Secure payment powered by Stripe";

            return (
              <>
                {depositPct > 0 && depositPaid && (
                  <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-800 font-medium flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    Deposit of {fmtMoney(depositAmount)} received. Remaining balance due below.
                  </div>
                )}

                {checkoutError && (
                  <div role="alert" className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <span className="text-sm text-red-700">{checkoutError}</span>
                  </div>
                )}

                <p className="mb-3 text-center text-[11px] text-slate-500 leading-relaxed">
                  By submitting payment, you approve the items, sizes, and decoration details on this quote and authorize production to begin.
                </p>

                {/* Hide the pay CTA when there's no positive total — avoids a
                    "$0.00"/"$NaN" pay button if totals didn't resolve (FE-10). */}
                {effectiveTotal > 0 ? (
                  <button
                    onClick={handleCheckout}
                    disabled={checkoutLoading || approveLoading}
                    className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white font-bold py-4 rounded-xl transition flex items-center justify-center gap-2 text-base"
                  >
                    {checkoutLoading || approveLoading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        {approveLoading ? "Approving…" : "Processing…"}
                      </>
                    ) : (
                      <>
                        <CreditCard className="w-5 h-5" />
                        {buttonLabel}
                      </>
                    )}
                  </button>
                ) : (
                  <div className="w-full bg-slate-50 border border-slate-200 rounded-xl py-4 text-center text-sm text-slate-600">
                    This quote's total isn't available right now — please contact the shop.
                  </div>
                )}

                {effectiveTotal > 0 && subLabel && (
                  <div className="mt-2 text-center text-xs text-slate-500">{subLabel}</div>
                )}

                <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-500">
                  <Lock className="w-3 h-3" />
                  {securityLabel}
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {previewArt && (
        <ArtworkPreviewOverlay
          art={previewArt}
          onClose={() => setPreviewArt(null)}
          backLabel="Back to quote"
        />
      )}
    </div>
  );
}