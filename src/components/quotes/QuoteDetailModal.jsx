import { useEffect, useMemo, useState } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import {
  calcQuoteTotals,
  calcLinkedLinePrice,
  buildLinkedQtyMap,
  buildQBInvoicePayload,
  fmtDate,
  fmtMoney,
  getQty,
  BIG_SIZES,
  SIZES,
  getDisplayName,
  getTier,
  BROKER_MARKUP,
  STANDARD_MARKUP,
} from "../shared/pricing";
import { exportQuoteToPDF } from "../shared/pdfExport";
import Badge from "../shared/Badge";
import SendQuoteModal from "./SendQuoteModal";

const STATUS_ACTIONABLE = ["Draft", "Sent", "Pending"];

function isBrokerQuote(q) {
  return Boolean(q?.broker_id || q?.broker_email || q?.brokerId);
}

function getQuoteTotalsForDisplay(q) {
  return calcQuoteTotals(q || {}, isBrokerQuote(q) ? BROKER_MARKUP : undefined);
}

function getLinePrice(li, quote) {
  const markup = isBrokerQuote(quote) ? BROKER_MARKUP : STANDARD_MARKUP;
  const linkedQtyMap = buildLinkedQtyMap(quote.line_items || []);
  const qty = getQty(li);
  const twoXL = BIG_SIZES.reduce((sum, sz) => sum + (parseInt((li.sizes || {})[sz], 10) || 0), 0);

  // Respect clientPpp override
  const override = Number(li?.clientPpp);
  if (markup === STANDARD_MARKUP && Number.isFinite(override) && override > 0 && qty > 0) {
    return { sub: override * qty, ppp: override, gCost: 0, printCost: 0, rushFee: 0, tier: getTier(qty), garment: 0, imprint: 0, overridden: true };
  }

  const r = calcLinkedLinePrice(li, quote.rush_rate, quote.extras, markup, linkedQtyMap);
  if (!r) return null;
  return { ...r, garment: r.gCost, imprint: r.printCost };
}

function getImprintArtwork(imp) {
  if (!imp) return null;
  if (!imp.artwork_id && !imp.artwork_name && !imp.artwork_url) return null;

  return {
    id: imp.artwork_id || "",
    name: imp.artwork_name || "Attached Artwork",
    url: imp.artwork_url || "",
    note: imp.artwork_note || "",
    colors: imp.artwork_colors || "",
  };
}

function cleanText(value) {
  return String(value || "").trim();
}

function extractTrailingCode(title) {
  const txt = cleanText(title);
  if (!txt) return "";
  const match = txt.match(/-\s*([A-Z0-9-]{2,20})$/i);
  return match ? cleanText(match[1]) : "";
}

function stripTrailingCode(title) {
  const txt = cleanText(title);
  if (!txt) return "";
  return txt.replace(/\s*-\s*[A-Z0-9-]{2,20}\s*$/i, "").trim();
}

function looksLikeCode(value) {
  const txt = cleanText(value);
  if (!txt) return false;
  return /^[A-Z0-9-]{2,20}$/i.test(txt) && /\d/.test(txt) && !txt.includes(" ");
}

function isWarehouseSku(value) {
  const txt = cleanText(value);
  if (!txt) return false;
  return /^0\d{3,}$/.test(txt);
}

function getPreferredGarmentNumber(li) {
  const candidates = [
    li?.supplierStyleNumber,
    li?.resolvedStyleNumber,
    li?.styleNumber,
    li?.garmentNumber,
    li?.productNumber,
    li?.style,
  ];

  for (const candidate of candidates) {
    const value = cleanText(candidate).toUpperCase();
    if (!value) continue;
    if (isWarehouseSku(value)) continue;
    if (!looksLikeCode(value)) continue;
    return value;
  }

  const productTitleTail = extractTrailingCode(li?.productTitle).toUpperCase();
  if (productTitleTail && !isWarehouseSku(productTitleTail)) {
    return productTitleTail;
  }

  const resolvedTitleTail = extractTrailingCode(li?.resolvedTitle).toUpperCase();
  if (resolvedTitleTail && !isWarehouseSku(resolvedTitleTail)) {
    return resolvedTitleTail;
  }

  return cleanText(li?.style).toUpperCase() || "GARMENT";
}

const DASH = "[-\u2013\u2014]"; // hyphen, en-dash, em-dash

function scrubDescription(raw, garmentNumber, brand) {
  if (!raw) return "";
  let t = cleanText(raw);
  // Strip leading "CODE - " / "CODE — "
  t = t.replace(new RegExp(`^[A-Z0-9-]{2,20}\\s*${DASH}\\s*`, "i"), "");
  // Strip trailing " - CODE" / " — CODE"
  t = t.replace(new RegExp(`\\s*${DASH}\\s*[A-Z0-9-]{2,20}\\s*$`, "i"), "");
  // Remove garment number appearing as a standalone token
  if (garmentNumber) {
    const escaped = garmentNumber.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
    t = t.replace(new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, "gi"), " ");
  }
  // Clean up stray leading/trailing dashes and spaces
  t = t.replace(new RegExp(`^[\\s${DASH}]+|[\\s${DASH}]+$`, "g"), "").replace(/\s{2,}/g, " ").trim();
  // If all that's left is just the brand name, it's not useful as a description
  if (brand && t.toLowerCase() === brand.toLowerCase()) return "";
  return t;
}

function getPreferredGarmentDescription(li) {
  const garmentNumber = getPreferredGarmentNumber(li).toLowerCase();

  const rawCandidates = [
    li?.styleName,
    li?.resolvedDescription,
    li?.productDescription,
    li?.product_description,
    li?.garmentName,
    li?.productTitle,
    li?.resolvedTitle,
    li?.description,
    li?.displayName,
    li?.title,
  ];

  const brand = cleanText(li?.brand).toLowerCase();

  for (const raw of rawCandidates) {
    const candidate = scrubDescription(raw, garmentNumber, brand);
    if (!candidate) continue;
    const normalized = candidate.toLowerCase();
    if (normalized === garmentNumber) continue;
    if (looksLikeCode(candidate)) continue;
    if (["shirt", "garment", "tee"].includes(normalized)) continue;
    return candidate;
  }

  return "";
}

function getGarmentHeader(li) {
  const number = getPreferredGarmentNumber(li);
  const storedName = cleanText(li?.productName || "");
  const description = (storedName && !looksLikeCode(storedName))
    ? storedName
    : getPreferredGarmentDescription(li);
  return description ? `${number} - ${description}` : number;
}

function getGarmentMeta(li) {
  const parts = [];
  if (li?.brand) parts.push(`Brand: ${li.brand}`);
  if (li?.garmentColor) parts.push(`Color: ${li.garmentColor}`);
  return parts.join(" • ");
}

export default function QuoteDetailModal({
  quote,
  customer,
  onClose,
  onEdit,
  onApprove,
  onDecline,
  onConvert,
  onDelete,
  onSend,
  onTogglePaid,
}) {
  const [shopName, setShopName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [showSendModal, setShowSendModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [qbSyncing, setQbSyncing] = useState(false);
  const [qbPaymentLink, setQbPaymentLink] = useState(quote?.qb_payment_link ?? null);
  const [qbInvoiceId, setQbInvoiceId] = useState(quote?.qb_invoice_id ?? null);
  const [qbError, setQbError] = useState(null);
  const [showQBPanel, setShowQBPanel] = useState(false);
  const [qbConnected, setQbConnected] = useState(null); // null=unknown, true, false
  const [qbCheckingConn, setQbCheckingConn] = useState(false);
  const [qbCopied, setQbCopied] = useState(false);

  const [localArtwork, setLocalArtwork] = useState(quote?.selected_artwork || []);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  async function handleArtworkUpload(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    setUploadError("");
    try {
      const newArtwork = [...localArtwork];
      for (const file of files) {
        const ext = file.name.split(".").pop();
        const path = `quote_${quote.id}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from("artwork").upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        const { data: { publicUrl } } = supabase.storage.from("artwork").getPublicUrl(path);
        newArtwork.push({ id: path, name: file.name, url: publicUrl, note: "", source: "upload" });
      }
      await base44.entities.Quote.update(quote.id, { selected_artwork: newArtwork });
      setLocalArtwork(newArtwork);
    } catch (err) {
      setUploadError(err?.message || "Upload failed.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function removeArtwork(artId) {
    const newArtwork = localArtwork.filter((a) => a.id !== artId);
    await base44.entities.Quote.update(quote.id, { selected_artwork: newArtwork });
    setLocalArtwork(newArtwork);
  }

  async function callAction(fn, ...args) {
    if (!fn) return;
    setSaving(true);
    try {
      await fn(...args);
    } finally {
      setSaving(false);
    }
  }

  async function openQBPanel() {
    setShowQBPanel(true);
    setQbError(null);
    setQbCheckingConn(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/qbSync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "checkConnection", accessToken: session?.access_token }),
      });
      const data = await res.json();
      setQbConnected(!!data.connected);
    } catch {
      setQbConnected(false);
    } finally {
      setQbCheckingConn(false);
    }
  }

  async function handleQBSync() {
    setQbSyncing(true);
    setQbError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not signed in");

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const customerPayload = customer ?? {
        name: quote.customer_name || quote.broker_client_name || "Unknown Customer",
        email: quote.customer_email || "",
        phone: "",
        company: "",
      };

      const invoicePayload = buildQBInvoicePayload(
        quote,
        isBrokerQuote(quote) ? BROKER_MARKUP : undefined
      );
      const res = await fetch(`${supabaseUrl}/functions/v1/qbSync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createInvoice",
          accessToken: session.access_token,
          quote,
          customer: customerPayload,
          invoicePayload,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "QB sync failed");

      setQbPaymentLink(data.paymentLink);
      setQbInvoiceId(data.qbInvoiceId);
      setQbConnected(true);
      onSend?.();
    } catch (err) {
      console.error("QB sync error:", err);
      setQbError(err.message);
    } finally {
      setQbSyncing(false);
    }
  }

  function copyQBLink() {
    navigator.clipboard.writeText(qbPaymentLink);
    setQbCopied(true);
    setTimeout(() => setQbCopied(false), 2000);
  }

  useEffect(() => {
    base44.auth
      .me()
      .then((u) => {
        if (u) {
          setShopName(u.shop_name || "");
          setLogoUrl(u.logo_url || "");
        }
      })
      .catch(() => {});
  }, []);

  const totals = useMemo(() => getQuoteTotalsForDisplay(quote || {}), [quote]);

  if (!quote) return null;

  const lineItems = Array.isArray(quote.line_items) ? quote.line_items : [];
  const totalQty = lineItems.reduce((sum, li) => sum + getQty(li), 0);
  const activeExtras = Object.entries(quote.extras || {}).filter(([, enabled]) => enabled);

  return (
    <>
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-auto"
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div
          className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl my-4"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-start px-4 sm:px-6 py-5 border-b border-slate-200 dark:border-slate-700">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">
                {quote.quote_id}
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                {getDisplayName(quote.customer_name)}
              </h2>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                {quote.date && (
                  <div className="text-xs sm:text-sm text-slate-400">
                    Quote Date: {fmtDate(quote.date)}
                  </div>
                )}
                {quote.due_date && (
                  <div className="text-xs sm:text-sm text-slate-400">
                    · In-Hands: {fmtDate(quote.due_date)}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <Badge s={quote.status} />
              {quote.deposit_paid ? (
                <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                  Paid
                </span>
              ) : null}
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="p-4 sm:p-6 space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Customer
                </div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {getDisplayName(quote.customer_name) || "—"}
                </div>
                <div className="text-sm text-slate-500">
                  {quote.customer_email || "—"}
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Quote Summary
                </div>
                <div className="flex justify-between text-sm text-slate-500">
                  <span>Quantity</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{totalQty} pcs</span>
                </div>
                <div className="flex justify-between text-sm text-slate-500">
                  <span>Tier</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {totalQty > 0 ? getTier(totalQty) : "—"}
                  </span>
                </div>
                <div className="flex justify-between text-sm text-slate-500">
                  <span>Rush</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {Number(quote.rush_rate) > 0 ? "Yes" : "No"}
                  </span>
                </div>
                <div className="flex justify-between text-sm text-slate-500">
                  <span>Deposit</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {quote.deposit_pct || 50}%
                  </span>
                </div>
              </div>
            </div>

            {activeExtras.length > 0 && (
              <div className="bg-indigo-50 rounded-xl border border-indigo-100 p-4">
                <div className="text-xs font-semibold uppercase tracking-widest text-indigo-400 mb-2">
                  Add-ons
                </div>
                <div className="flex flex-wrap gap-2">
                  {activeExtras.map(([key]) => (
                    <span
                      key={key}
                      className="text-xs font-semibold text-indigo-700 bg-white dark:bg-slate-900 border border-indigo-200 px-2.5 py-1 rounded-full"
                    >
                      {key}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {lineItems.length > 0 ? (
              <>
                {lineItems.map((li) => {
                  const qty = getQty(li);
                  const twoXL = BIG_SIZES.reduce(
                    (s, sz) => s + (parseInt((li.sizes || {})[sz], 10) || 0),
                    0
                  );
                  const pricing = getLinePrice(li, quote);
                  const activeSizes = SIZES.filter(
                    (sz) => (parseInt((li.sizes || {})[sz], 10) || 0) > 0
                  );

                  return (
                    <div
                      key={li.id}
                      className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden"
                    >
                      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                            {getGarmentHeader(li)}
                          </div>
                          {getGarmentMeta(li) && (
                            <div className="text-xs text-slate-500 mt-1">
                              {getGarmentMeta(li)}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-0">
                          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{qty} pcs</div>
                          <div className="text-xs text-slate-500">
                            Tier {qty > 0 ? getTier(qty) : "—"}
                          </div>
                          {pricing && qty > 0 && (
                            <div className="sm:mt-1.5 text-right space-y-0.5">
                              <div className="text-base font-bold text-indigo-600">
                                {fmtMoney(pricing.ppp)}<span className="text-xs font-medium text-indigo-400">/pc</span>
                              </div>
                              {twoXL > 0 && (
                                <div className="text-xs font-semibold text-amber-600">
                                  {fmtMoney(pricing.ppp + 2)}<span className="text-[10px] font-medium text-amber-400">/pc 2XL+</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="p-4 space-y-4">
                        <div className="grid gap-4 grid-cols-1 lg:grid-cols-[1.2fr_0.8fr]">
                          <div className="space-y-3">
                            {activeSizes.length > 0 && (
                              <div>
                                <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                                  Sizes
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {activeSizes.map((sz) => (
                                    <div
                                      key={sz}
                                      className="text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1"
                                    >
                                      {sz}: {li.sizes[sz]}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div>
                              <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                                Imprints
                              </div>

                              <div className="space-y-3">
                                {(li.imprints || []).map((imp, idx) => {
                                  const art = getImprintArtwork(imp);

                                  return (
                                    <div
                                      key={imp.id || idx}
                                      className="border border-slate-200 dark:border-slate-700 rounded-xl p-3 space-y-3"
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="space-y-1">
                                          <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                                            {imp.location || "Imprint"}{imp.title ? ` — ${imp.title}` : ""}
                                          </div>

                                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                                            {imp.method && <span>Method: {imp.method}</span>}
                                            {imp.colors && <span>Colors: {imp.colors}</span>}
                                            {imp.pantones && (
                                              <span className="font-medium text-indigo-600">
                                                Pantones: {imp.pantones}
                                              </span>
                                            )}
                                            {imp.details && (
                                              <span className="text-slate-400 italic">
                                                {imp.details}
                                              </span>
                                            )}
                                          </div>

                                          {(imp.width || imp.height) && (
                                            <div className="flex gap-2 text-xs text-slate-500">
                                              {imp.width && <span>Width: {imp.width}</span>}
                                              {imp.height && <span>Height: {imp.height}</span>}
                                            </div>
                                          )}
                                        </div>

                                        {art && (
                                          <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
                                            <div className="text-[11px] font-bold uppercase tracking-widest text-indigo-400 mb-2">
                                              Attached Artwork
                                            </div>

                                            <div className="flex items-center justify-between gap-3">
                                              <div className="min-w-0">
                                                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                                                  {art.name}
                                                </div>

                                                {art.note && (
                                                  <div className="text-xs text-slate-400 truncate mt-0.5">
                                                    {art.note}
                                                  </div>
                                                )}

                                                {art.colors && (
                                                  <div className="text-xs text-indigo-600 font-semibold mt-1">
                                                    Artwork colors: {art.colors}
                                                  </div>
                                                )}
                                              </div>

                                              {art.url ? (
                                                <a
                                                  href={art.url}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="shrink-0 text-xs font-semibold text-indigo-600 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition"
                                                >
                                                  Open
                                                </a>
                                              ) : null}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>

                          <div className="space-y-3">
                            {pricing && (
                              <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 space-y-1">
                                <div className="flex justify-between text-xs text-slate-600">
                                  <span>Garment Cost</span>
                                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                                    {fmtMoney(pricing.garment)}
                                  </span>
                                </div>

                                <div className="flex justify-between text-xs text-slate-600">
                                  <span>Imprint Cost</span>
                                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                                    {fmtMoney(pricing.imprint)}
                                  </span>
                                </div>

                                {twoXL > 0 && (
                                  <div className="flex justify-between text-xs text-slate-600">
                                    <span>2XL+ Upcharge</span>
                                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                                      {fmtMoney(twoXL * 2)}
                                    </span>
                                  </div>
                                )}

                                <div className="flex justify-between text-xs text-slate-600 border-t border-indigo-200 pt-1">
                                  <span>Line Subtotal</span>
                                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                                    {fmtMoney(pricing.sub + twoXL * 2)}
                                  </span>
                                </div>

                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                <div className="bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
                  <div className="flex justify-between text-sm text-slate-500">
                    <span>Subtotal</span>
                    <span>{fmtMoney(totals.sub)}</span>
                  </div>

                  {parseFloat(quote.discount) > 0 && (() => {
                    const dv = parseFloat(quote.discount);
                    const flat = quote.discount_type === "flat" || (dv > 100 && quote.discount_type !== "percent");
                    return (
                      <div className="flex justify-between text-sm text-emerald-600">
                        <span>Discount {flat ? `(${fmtMoney(dv)})` : `(${quote.discount}%)`}</span>
                        <span>−{fmtMoney(totals.sub - totals.afterDisc)}</span>
                      </div>
                    );
                  })()}

                  {(() => {
                    const hasQb = quote.qb_total != null;
                    const taxVal = hasQb ? Number(quote.qb_tax_amount || 0) : totals.tax;
                    const totalVal = hasQb ? Number(quote.qb_total || 0) : totals.total;
                    return (
                      <>
                        <div className="flex justify-between text-sm text-slate-500">
                          <span>{hasQb ? "Tax" : `Est. Tax (${isBrokerQuote(quote) ? 0 : quote.tax_rate}%)`}</span>
                          <span>{fmtMoney(taxVal)}</span>
                        </div>
                        <div className="flex justify-between font-bold text-slate-900 dark:text-slate-100 border-t border-slate-200 dark:border-slate-700 pt-2">
                          <span>{hasQb ? "Total" : "Est. Total"}</span>
                          <span className="text-xl">{fmtMoney(totalVal)}</span>
                        </div>
                        {!hasQb && (
                          <div className="text-[11px] text-slate-400 -mt-1">
                            Final tax calculated based on ship-to address at checkout.
                          </div>
                        )}
                      </>
                    );
                  })()}

                  <div className="flex justify-between text-sm text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                    <span className="font-semibold">Deposit Due</span>
                    <span className="font-bold">{fmtMoney(totals.deposit)}</span>
                  </div>
                </div>

                {quote.notes && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                    <span className="font-semibold">Notes: </span>
                    {quote.notes}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8 text-slate-300 text-sm">
                No line items in this quote.
              </div>
            )}
          </div>

          {/* QB status chip */}
          {(qbPaymentLink || qbInvoiceId) && (
            <div className="mx-6 mb-2">
              <button
                onClick={openQBPanel}
                className="w-full flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 transition text-left"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                <span className="text-xs font-semibold text-emerald-800 flex-1">
                  QB Invoice {qbInvoiceId ? `#${qbInvoiceId}` : ""} created
                  {qbPaymentLink ? " · Payment link ready" : ""}
                </span>
                <span className="text-xs text-emerald-600 font-semibold">View →</span>
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-2 px-4 sm:px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-b-2xl">
            <button
              onClick={onEdit}
              className="px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 transition"
            >
              Edit Quote
            </button>

            <button
              onClick={() => setShowSendModal(true)}
              className="px-4 py-2 text-sm font-semibold text-indigo-700 border border-indigo-200 bg-indigo-50 rounded-xl hover:bg-indigo-100 transition"
            >
              Send Quote
            </button>

            <button
              onClick={openQBPanel}
              className="px-4 py-2 text-sm font-semibold text-[#2CA01C] border border-[#2CA01C] bg-white dark:bg-slate-900 rounded-xl hover:bg-green-50 transition"
            >
              {qbInvoiceId ? "QB Invoice Status" : "Send via QuickBooks"}
            </button>

            <button
              onClick={() =>
                exportQuoteToPDF(
                  quote,
                  shopName,
                  logoUrl,
                  customer?.company || "",
                  quote.customer_email || customer?.email || "",
                  quote.customer_phone || customer?.phone || ""
                )
              }
              className="px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 transition"
            >
              📥 Download PDF
            </button>

            {STATUS_ACTIONABLE.includes(quote.status) && (
              <>
                <button
                  onClick={() => callAction(onApprove, quote.id)}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Approve"}
                </button>

                <button
                  onClick={() => callAction(onDecline, quote.id)}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-xl transition disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Decline"}
                </button>
              </>
            )}

            {(quote.status === "Approved" || quote.status === "Approved and Paid" || quote.status === "Client Approved") && (
              <button
                onClick={() => callAction(onConvert, quote)}
                disabled={saving}
                className="px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition disabled:opacity-50"
              >
                {saving ? "Converting…" : "Convert to Order"}
              </button>
            )}

            {onTogglePaid && (
              <button
                onClick={() => callAction(onTogglePaid, quote)}
                disabled={saving}
                className={`px-4 py-2 text-sm font-semibold rounded-xl border transition disabled:opacity-50 ${
                  quote.deposit_paid
                    ? "text-slate-600 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                    : "text-emerald-700 border-emerald-300 bg-emerald-50 hover:bg-emerald-100"
                }`}
              >
                {saving ? "Saving…" : quote.deposit_paid ? "Mark as Unpaid" : "✓ Mark as Paid"}
              </button>
            )}

            {onDelete && (
              <button
                onClick={() => callAction(onDelete, quote.id)}
                disabled={saving}
                className="px-4 py-2 text-sm font-semibold text-red-400 border border-red-200 rounded-xl hover:bg-red-50 transition disabled:opacity-50"
              >
                {saving ? "Deleting…" : "Delete Quote"}
              </button>
            )}

            <button
              onClick={onClose}
              className="ml-auto px-4 py-2 text-sm font-semibold text-slate-400 rounded-xl hover:bg-slate-100 transition"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {showSendModal && (
        <SendQuoteModal
          quote={quote}
          customer={customer}
          onClose={() => setShowSendModal(false)}
          onSuccess={() => {
            setShowSendModal(false);
            onSend?.();
          }}
        />
      )}

      {/* ── QuickBooks Status Panel ─────────────────────────────────────── */}
      {showQBPanel && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setShowQBPanel(false); }}
          />
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#2CA01C] flex items-center justify-center text-white font-black text-xs">QB</div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-lg">QuickBooks Status</h3>
              </div>
              <button onClick={() => setShowQBPanel(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
            </div>

            {/* Connection status */}
            <div className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              {qbCheckingConn ? (
                <>
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-300 animate-pulse" />
                  <span className="text-sm text-slate-500">Checking connection…</span>
                </>
              ) : qbConnected ? (
                <>
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                  <span className="text-sm font-semibold text-emerald-700">Connected to QuickBooks</span>
                </>
              ) : (
                <>
                  <div className="w-2.5 h-2.5 rounded-full bg-rose-400 shrink-0" />
                  <span className="text-sm font-semibold text-rose-700">Not connected</span>
                  <a href="/account" className="ml-auto text-xs font-semibold text-indigo-600 hover:underline">Connect →</a>
                </>
              )}
            </div>

            {/* Invoice status */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Invoice</div>
              {qbInvoiceId ? (
                <div className="flex items-center gap-2 p-3 rounded-xl border border-emerald-200 bg-emerald-50">
                  <span className="text-emerald-600 text-lg">✓</span>
                  <div>
                    <div className="text-sm font-bold text-emerald-800">Invoice #{qbInvoiceId}</div>
                    <div className="text-xs text-emerald-600">Created in QuickBooks</div>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-500">
                  No invoice created yet
                </div>
              )}
            </div>

            {/* Payment link */}
            {qbPaymentLink && (
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Payment Link</div>
                <div className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                  <a
                    href={qbPaymentLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-indigo-600 underline flex-1 truncate"
                  >
                    {qbPaymentLink}
                  </a>
                  <button
                    onClick={copyQBLink}
                    className="shrink-0 text-xs font-semibold text-slate-600 border border-slate-200 dark:border-slate-700 px-2.5 py-1 rounded-lg hover:bg-slate-50 dark:bg-slate-800 transition"
                  >
                    {qbCopied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <p className="text-xs text-slate-400">Send this link to your customer so they can pay the QB invoice directly.</p>
              </div>
            )}

            {/* Quote details */}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                <div className="text-xs text-slate-400 mb-0.5">Quote</div>
                <div className="font-bold text-slate-800 dark:text-slate-200">#{quote.quote_id}</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                <div className="text-xs text-slate-400 mb-0.5">Amount</div>
                <div className="font-bold text-indigo-700">{fmtMoney(getQuoteTotalsForDisplay(quote).total)}</div>
              </div>
            </div>

            {/* Error */}
            {qbError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-semibold">
                {qbError}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              {qbConnected && (
                <button
                  onClick={handleQBSync}
                  disabled={qbSyncing}
                  className="flex-1 bg-[#2CA01C] hover:bg-[#238516] disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-sm transition"
                >
                  {qbSyncing ? "Syncing…" : qbInvoiceId ? "Re-sync Invoice" : "Create QB Invoice"}
                </button>
              )}
              {qbPaymentLink && (
                <a
                  href={qbPaymentLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-center border border-[#2CA01C] text-[#2CA01C] font-bold py-2.5 rounded-xl text-sm hover:bg-green-50 transition"
                >
                  Open in QB →
                </a>
              )}
              {!qbConnected && !qbCheckingConn && (
                <a
                  href="/account"
                  className="flex-1 text-center bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-sm transition"
                >
                  Connect QuickBooks
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}