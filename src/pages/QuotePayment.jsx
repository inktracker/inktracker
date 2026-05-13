import { useState, useEffect } from "react";
import { base44 } from "@/api/supabaseClient";
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
  fmtMoney,
  fmtDate,
  getQty,
  BIG_SIZES,
  sortSizeEntries,
} from "../components/shared/pricing";
import { resolveCheckoutTarget } from "@/lib/payment/resolveCheckoutTarget";

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
  const pricing = calcLinkedLinePrice(li, quote.rush_rate, quote.extras, undefined, linkedQtyMap);
  const lineTotal = pricing ? pricing.lineTotal : 0;
  const perPiece = qty > 0 ? lineTotal / qty : 0;

  return { qty, pricing, lineTotal, perPiece };
}

function buildCheckoutLineItems(quote, amount, label) {
  return [
    {
      name: `Quote ${quote?.quote_id || ""}`.trim(),
      description: label || "Approved quote payment",
      quantity: 1,
      unit_amount: Math.max(1, Math.round(Number(amount || 0) * 100)),
    },
  ];
}

export default function QuotePayment() {
  const [quote, setQuote] = useState(null);
  const [shop, setShop] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [recaptchaReady, setRecaptchaReady] = useState(false);
  const [approveLoading, setApproveLoading] = useState(false);
  const [approveError, setApproveError] = useState("");
  const [approveSuccess, setApproveSuccess] = useState(false);

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

  const alreadyPaid =
    quote?.status === "Approved and Paid" ||
    quote?.status === "Paid" ||
    (quote?.status === "Approved" && quote?.deposit_paid);

  const alreadyApproved =
    quote?.status === "Approved" ||
    quote?.status === "Approved and Paid" ||
    quote?.status === "Paid";

  const isExpired = (() => {
    if (!quote?.expires_date) return false;
    if (alreadyApproved || alreadyPaid) return false;
    return new Date(quote.expires_date) < new Date();
  })();

  // ── Payment-provider availability ──────────────────────────────────
  // A shop must have at least one set up before we surface an "Approve
  // & Pay" button. Otherwise the customer sees an Approve-only button
  // and pays out-of-band.
  //   QB available     — shop has a usable customer-facing payment link
  //                       (the heuristic in resolveCheckoutTarget already
  //                       rejects the legacy login-required Intuit URLs).
  //   Stripe available — shop's stripe_account_status is "active"
  //                       (Stripe Connect is set up + verified).
  const stripeAvailable = shop?.stripe_account_status === "active";
  const qbCheckoutTarget = resolveCheckoutTarget(quote);
  const qbAvailable = qbCheckoutTarget.provider === "qb" && Boolean(qbCheckoutTarget.url);
  const canCollectPayment = qbAvailable || stripeAvailable;

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
        const verifyRes = await fetch(`${SUPABASE_URL}/functions/v1/verifyRecaptcha`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const verifyData = await verifyRes.json();
        if (!verifyData.success) {
          console.warn("[QuotePayment] reCAPTCHA score too low:", verifyData.score);
          // Don't block — Stripe Checkout has its own fraud prevention
        }
      } catch {
        // If reCAPTCHA itself errors (blocked, network), allow through
      }
    }

    const isAlreadyApproved =
      quote?.status === "Approved" ||
      quote?.status === "Approved and Paid" ||
      quote?.status === "Paid";

    if (!isAlreadyApproved) {
      const approved = await handleApprove();
      if (!approved) return;
    }

    if (window.self !== window.top) {
      alert("Payment checkout requires opening in a new window. Please open this page directly in your browser.");
      window.open(window.location.href, "_blank");
      return;
    }

    // Prefer QB payment page when the link is a real customer-facing payment
    // URL (not the legacy login-required fallback). resolveCheckoutTarget
    // filters out URLs that would dump the customer at an Intuit login screen.
    const qbTarget = resolveCheckoutTarget(quote);
    if (qbTarget.provider === "qb" && qbTarget.url) {
      window.location.href = qbTarget.url;
      return;
    }

    // Try a fresh fetch in case the QB link was issued after page load.
    try {
      const response = await base44.functions.invoke("createCheckoutSession", {
        action: "getQuote",
        quoteId: quote.id,
        token: publicToken,
      });
      const refreshed = response?.data?.quote;
      const refreshedTarget = resolveCheckoutTarget(refreshed);
      if (refreshedTarget.provider === "qb" && refreshedTarget.url) {
        window.location.href = refreshedTarget.url;
        return;
      }
    } catch {}

    // No usable QB link — fall through to Stripe checkout
    setCheckoutLoading(true);

    try {
      // Prefer QB total > saved total > live calc (in that order)
      const liveTotals = calcQuoteTotals(quote);
      const effectiveTotal = quote.qb_total != null ? Number(quote.qb_total)
        : (Number.isFinite(quote.total) && quote.total > 0) ? quote.total
        : liveTotals.total;
      // Customer's default payment terms override the quote's own deposit_pct —
      // lets the shop flip "pay in full" on a client without re-editing old quotes.
      const depositPct = customer?.default_deposit_pct != null
        ? Number(customer.default_deposit_pct) || 0
        : parseFloat(quote.deposit_pct) || 0;
      const depositAmount = Math.round(effectiveTotal * (depositPct / 100) * 100) / 100;
      const depositPaid = quote.deposit_paid;

      // Auto-determine what to charge: deposit → remaining balance → full
      let chargeAmount = effectiveTotal;
      let isDeposit = false;
      let paymentLabel = `Quote ${quote.quote_id}`;

      if (depositPct > 0 && !depositPaid) {
        chargeAmount = depositAmount;
        isDeposit = true;
        paymentLabel = `Deposit (${depositPct}%) — Quote ${quote.quote_id}`;
      } else if (depositPct > 0 && depositPaid) {
        chargeAmount = Math.round((effectiveTotal - depositAmount) * 100) / 100;
        paymentLabel = `Remaining Balance — Quote ${quote.quote_id}`;
      }

      const checkoutLineItems = buildCheckoutLineItems(quote, chargeAmount, paymentLabel);

      const response = await base44.functions.invoke("createCheckoutSession", {
        action: "createSession",
        quoteId: quote.id,
        token: publicToken,
        quoteTotal: effectiveTotal,
        amountPaid: chargeAmount,
        isDeposit,
        shopOwnerEmail: quote.shop_owner || "",
        customerEmail: quote.customer_email || quote.sent_to || "",
        customerName: quote.customer_name || "Customer",
        shopName: shop?.shop_name || "Shop",
        lineItems: checkoutLineItems,
      });

      if (response.data?.url) {
        window.location.href = response.data.url;
      } else {
        setCheckoutError(response.data?.error || "Failed to create checkout session.");
      }
    } catch (err) {
      setCheckoutError(err.message || "An error occurred. Please try again.");
    } finally {
      setCheckoutLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
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

  // Use saved totals when available (calculate-once principle)
  const totals = (quote.total != null && quote.subtotal != null)
    ? {
        sub: Number(quote.subtotal),
        subtotal: Number(quote.subtotal),
        rushTotal: 0,
        afterDisc: Number(quote.total) - Number(quote.tax || 0),
        tax: Number(quote.tax || 0),
        total: Number(quote.total),
      }
    : calcQuoteTotals(quote);

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
            <div className="w-12 h-12 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-black text-xl">
              {(shop?.shop_name || "S")[0]}
            </div>
          )}
          <div className="flex-1">
            <div className="text-white font-bold text-lg leading-tight">
              {shop?.shop_name || "Shop"}
            </div>
            <div className="text-slate-400 text-sm">
              Quote #{quote.quote_id}
            </div>
          </div>
          <div className="text-right">
            <div className="text-slate-400 text-xs uppercase tracking-wide mb-0.5">
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
                <div className="text-sm text-slate-400 mt-0.5">
                  {quote.customer_email || quote.sent_to}
                </div>
              )}
            </div>
            <div className="text-right text-sm space-y-1">
              {quote.date && (
                <div>
                  <span className="text-slate-400">Date: </span>
                  <span className="font-semibold text-slate-700">
                    {fmtDate(quote.date)}
                  </span>
                </div>
              )}
              {quote.due_date && (
                <div>
                  <span className="text-slate-400">In-Hands: </span>
                  <span className="font-semibold text-indigo-700">
                    {fmtDate(quote.due_date)}
                  </span>
                </div>
              )}
              {quote.status && (
                <div>
                  <span className="text-slate-400">Status: </span>
                  <span className="font-semibold text-slate-700">
                    {quote.status}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {(quote.line_items || []).length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 sm:px-8 py-6 space-y-5">
            <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
              Quote Details
            </h3>

            {quote.line_items.map((li, idx) => {
              const activeSizes = sortSizeEntries(Object.entries(li.sizes || {})).filter(
                ([, v]) => parseInt(v, 10) > 0
              );
              const { qty, lineTotal, perPiece } = getLineItemPricing(li, quote);
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
                      <div className="font-bold text-indigo-700">
                        {fmtMoney(lineTotal)}
                      </div>
                      {qty > 0 && (
                        <div className="text-xs text-slate-400">
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
                              <th className="text-left text-slate-400 font-semibold pr-4 py-1 w-16"></th>
                              {activeSizes.map(([sz]) => (
                                <th
                                  key={sz}
                                  className="text-center text-slate-400 font-semibold px-3 py-1"
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
                              <td className="text-slate-400 pr-4 py-1">Qty</td>
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
                              <td className="text-slate-400 pr-4 py-1">Price/ea</td>
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
                              <td className="text-center font-bold text-indigo-700 px-3 py-1">
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
                          <span className="flex items-center gap-1 text-indigo-600 font-semibold">
                            <MapPin className="w-3 h-3" />
                            {imp.title
                              ? `${imp.title} · ${imp.location || "Location"}`
                              : imp.location || "Location"}
                          </span>
                          {imp.colors > 0 && (
                            <span>
                              {imp.colors} color{imp.colors !== 1 ? "s" : ""}
                            </span>
                          )}
                          {imp.technique && <span>· {imp.technique}</span>}
                          {imp.pantones && (
                            <span className="text-purple-600">· {imp.pantones}</span>
                          )}
                          {(imp.width || imp.height) && (
                            <span className="text-slate-400">
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
                            <span className="italic text-slate-400">
                              · {imp.details}
                            </span>
                          )}
                        </div>
                      ))}
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

            {(() => {
              const hasQb = quote.qb_total != null;
              const taxLabel = hasQb ? "Tax" : `Est. Tax (${quote.tax_rate}%)`;
              const totalLabel = hasQb ? "Total Due" : "Est. Total";
              const taxValue = hasQb ? Number(quote.qb_tax_amount || 0) : totals.tax;
              const totalValue = hasQb ? Number(quote.qb_total || 0) : totals.total;
              return (
                <>
                  {(hasQb ? taxValue > 0 : (parseFloat(quote.tax_rate) || 0) > 0) && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">{taxLabel}</span>
                      <span className="font-semibold text-slate-800">{fmtMoney(taxValue)}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-3 border-t border-slate-200">
                    <span className="font-bold text-slate-900 text-base">{totalLabel}</span>
                    <span className="text-2xl font-black text-indigo-700">{fmtMoney(totalValue)}</span>
                  </div>
                  {!hasQb && (
                    <div className="text-[11px] text-slate-400 text-right -mt-1">
                      Final tax calculated based on ship-to address at checkout.
                    </div>
                  )}
                </>
              );
            })()}
            <div className="text-[10px] text-slate-400 italic leading-snug pt-2 border-t border-slate-100 mt-1 space-y-2">
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
            <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <span className="text-sm text-red-700">{approveError}</span>
            </div>
          )}

          {isExpired ? (
            <div className="w-full bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-5 py-4 text-center">
              <div className="font-bold text-base mb-1">This quote has expired</div>
              <div className="text-sm text-amber-700">
                The quote expiration date was {fmtDate(quote.expires_date)}. Please contact{" "}
                {shop?.shop_name || "the shop"} to request an updated quote.
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
            <>
              {approveError && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <span className="text-sm text-red-700">{approveError}</span>
                </div>
              )}
              <button
                onClick={handleApprove}
                disabled={approveLoading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold py-4 rounded-xl transition flex items-center justify-center gap-2 text-base"
              >
                {approveLoading ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Approving…</>
                ) : (
                  <><CheckCircle2 className="w-5 h-5" /> Approve Quote</>
                )}
              </button>
              <p className="mt-3 text-center text-xs text-slate-400">
                {shop?.shop_name || "The shop"} will be in touch about payment after you approve.
              </p>
            </>
          ) : (() => {
            const effectiveTotal = quote?.qb_total != null ? Number(quote.qb_total) : totals.total;
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
                  <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <span className="text-sm text-red-700">{checkoutError}</span>
                  </div>
                )}

                <button
                  onClick={handleCheckout}
                  disabled={checkoutLoading || approveLoading}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold py-4 rounded-xl transition flex items-center justify-center gap-2 text-base"
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

                {subLabel && (
                  <div className="mt-2 text-center text-xs text-slate-400">{subLabel}</div>
                )}

                <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-400">
                  <Lock className="w-3 h-3" />
                  {securityLabel}
                </div>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}