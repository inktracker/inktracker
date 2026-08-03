import { useEffect, useMemo, useState } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { openSignedArtwork, uploadFile } from "@/lib/uploadFile";
import {
  calcQuoteTotals,
  calcLinkedLinePrice,
  buildLinkedQtyMap,
  getLineExtras,
  buildQBInvoicePayload,
  fmtDate,
  fmtMoney,
  getQty,
  SIZES,
  getDisplayName,
  getTier,
  BROKER_MARKUP,
  STANDARD_MARKUP,
  getShopPricingConfig,
} from "../shared/pricing";
import { exportQuoteToPDF, previewPdf } from "../shared/pdfExport";
import { normalizeAdditionalCharges } from "@/lib/pricing/additionalCharges";
import { isQbStale } from "@/lib/quotes/qbStale";
import { qbModifiedState, buildQuoteAdoptPatch } from "@/lib/quotes/qbAdopt";
import { savedAfterDiscount, savedRushTotal } from "@/lib/quotes/effectiveTotals";
import Badge from "../shared/Badge";
import SendQuoteModal from "./SendQuoteModal";
import ModalBackdrop from "../shared/ModalBackdrop";
import MessagesTab from "../shared/MessagesTab";
import CollapsibleSection from "../shared/CollapsibleSection";
import { quoteThreadId } from "@/lib/messageThreads";
import { isConvertedToOrder } from "@/lib/quotes/approvalState";
import { imprintColorLabel, imprintCountText } from "@/lib/quotes/imprintLabels";
import { taxProviderFor } from "@/lib/tax/factory";
import { MessageSquare, UserCheck, UserX, Paperclip } from "lucide-react";
import { notify } from "@/lib/notify";
import AttachmentGallery from "../shared/AttachmentGallery";
import { DEPOSITS_ENABLED } from "@/lib/deposits";
import ReactivateLink from "../shared/ReactivateLink";
import { customGarmentHeader } from "@/lib/quotes/garmentTitle";

// Shown on every disabled write affordance when the shop is read-only
// (subscription lapsed). Viewing stays fully intact — only DB-mutating
// actions are gated, never hidden without explanation.
const RO_TITLE = "Your subscription has ended — reactivate to create and edit";

const STATUS_ACTIONABLE = ["Draft", "Sent", "Pending"];

function isBrokerQuote(q) {
  return Boolean(q?.broker_id || q?.broker_email || q?.brokerId);
}

// Render qb_event_log timestamps as "5 min ago" / "2h ago" up to 24h,
// then switch to short absolute "May 28 12:14". Operators usually want
// a relative read on the recent rows, an absolute read on older ones.
function formatEventTime(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const deltaSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (deltaSec < 60)    return `${deltaSec}s ago`;
  if (deltaSec < 3600)  return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

// For broker quotes the SHOP's "customer" is the broker (they pay the
// shop); the end client is a reference. For non-broker quotes the
// customer is just the customer. Mirrors the PDF Shop Form logic.
function getShopFacingCustomer(quote, fallbackCustomer) {
  if (isBrokerQuote(quote)) {
    return (
      quote?.broker_company ||
      quote?.broker_name ||
      quote?.broker_email ||
      quote?.broker_id ||
      "—"
    );
  }
  return getDisplayName(fallbackCustomer || quote?.customer_name) || "—";
}

function getShopFacingReference(quote, fallbackCustomer) {
  if (!isBrokerQuote(quote)) return "";
  // getDisplayName returns the literal "Unknown" when the customer record
  // is empty/missing — which is the common case here, since the shop's
  // own customers list doesn't include the broker's end clients. Treat
  // "Unknown" as no-data and fall through to the broker-quote fields
  // that DO carry the end client name.
  const fromCustomer = fallbackCustomer ? getDisplayName(fallbackCustomer) : "";
  const usableFromCustomer = fromCustomer && fromCustomer !== "Unknown" ? fromCustomer : "";
  const clientName =
    usableFromCustomer ||
    quote?.customer_name ||
    quote?.broker_client_name;
  return clientName ? `Reference: ${clientName}` : "";
}

// Some suppliers (AS Colour) stuff the full marketing description into the
// title field. Trim to the first sentence + 80-char cap so quote views
// don't render a paragraph where a product name should be. Mirrors
// trimToShortTitle in BrokerPricePanel and trimToShortGarmentTitle in
// pdfExport.
function trimToShortTitle(text) {
  if (!text) return "";
  const firstSentence = String(text).split(/(?<=\.)\s+/)[0] || text;
  const trimmed = firstSentence.replace(/\.$/, "").trim();
  if (trimmed.length > 80) return trimmed.slice(0, 77).trimEnd() + "…";
  return trimmed;
}

function getQuoteTotalsForDisplay(q) {
  return calcQuoteTotals(q || {}, isBrokerQuote(q) ? BROKER_MARKUP : undefined);
}

function getLinePrice(li, quote) {
  const markup = isBrokerQuote(quote) ? BROKER_MARKUP : STANDARD_MARKUP;
  const qty = getQty(li);

  // Use saved pricing when stamped — true for both broker and non-broker
  // quotes now that BrokerQuoteEditor.runSave stamps _ppp with BROKER_MARKUP.
  // Recomputing live here would use the SHOP user's pricing config, which
  // can diverge from the broker's pricing config and give a different
  // broker price than what the broker quoted.
  if (li._ppp != null && li._lineTotal != null) {
    return { ppp: li._ppp, lineTotal: li._lineTotal, rushFee: li._rushFee || 0, qty, baseSubtotal: li._lineTotal, garment: 0, imprint: 0, gCost: 0, printCost: 0, extraCost: 0, tier: getTier(qty) };
  }

  // Legacy fallback — recalculate for old quotes without stamped pricing
  const linkedQtyMap = buildLinkedQtyMap(quote.line_items || []);

  const override = Number(li?.clientPpp);
  if (markup === STANDARD_MARKUP && Number.isFinite(override) && override > 0 && qty > 0) {
    return { sub: override * qty, ppp: override, gCost: 0, printCost: 0, rushFee: 0, tier: getTier(qty), garment: 0, imprint: 0, overridden: true };
  }

  const r = calcLinkedLinePrice(li, quote.rush_rate, getLineExtras(li, quote), markup, linkedQtyMap);
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
  // Shop's custom title wins over resolved/supplier fields — see
  // src/lib/quotes/garmentTitle.js.
  const custom = customGarmentHeader(li, number);
  if (custom) return custom;
  const storedName = cleanText(li?.productName || "");
  const rawDescription = (storedName && !looksLikeCode(storedName))
    ? storedName
    : getPreferredGarmentDescription(li);
  const description = trimToShortTitle(rawDescription);
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
  onDuplicate,
  // Called when the quote row is updated in-place (e.g. customer
  // re-linked from the possible-duplicate banner). Parent splices the
  // updated row into its quotes state so the modal re-renders.
  onUpdated,
  // Subscription-lapsed read-only mode. When true, every DB-mutating
  // action is disabled (not hidden) with a reactivate hint; all reads,
  // the PDF preview, and Close stay fully functional.
  readOnly = false,
  reactivateHref,
}) {
  const [shopName, setShopName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [showSendModal, setShowSendModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [qbSyncing, setQbSyncing] = useState(false);
  const [qbPaymentLink, setQbPaymentLink] = useState(quote?.qb_payment_link ?? null);
  const [qbInvoiceId, setQbInvoiceId] = useState(quote?.qb_invoice_id ?? null);
  const [qbDocNumber, setQbDocNumber] = useState(quote?.qb_doc_number ?? null);
  const [qbError, setQbError] = useState(null);
  const [showQBPanel, setShowQBPanel] = useState(false);
  const [qbConnected, setQbConnected] = useState(null); // null=unknown, true, false
  const [qbCheckingConn, setQbCheckingConn] = useState(false);
  const [qbCopied, setQbCopied] = useState(false);
  const [matchingQb, setMatchingQb] = useState(false);

  // "Modified in QuickBooks — Match?" — a QB-side edit left this quote's saved
  // total disagreeing with QB's mirror (and the quote itself wasn't edited, so
  // it's not the stale-regenerate case). Let the shop pull QB's authoritative
  // total/tax onto the quote. Explicit click only — the quote-snapshot invariant
  // never rewrites as-sold automatically. Mirrors the invoice adopt.
  async function handleMatchQb() {
    const patch = buildQuoteAdoptPatch(quote);
    if (!patch) return;
    if (!window.confirm(
      `Match this quote to QuickBooks (${fmtMoney(patch.total)})?\n\n` +
      `QuickBooks is the billing authority and your customer is already billed this ` +
      `amount — this updates the quote so it agrees. Line items aren't changed.`,
    )) return;
    setMatchingQb(true);
    try {
      const updated = await base44.entities.Quote.update(quote.id, patch);
      onUpdated?.(updated);
      notify.success("Matched to QuickBooks", "This quote now agrees with QuickBooks.");
    } catch (err) {
      notify.error("Couldn't match to QuickBooks", err?.message || "Please try again.");
    } finally {
      setMatchingQb(false);
    }
  }

  // ── QB Panel tabs (Status | Events | Link) ─────────────────────────
  // The Status tab is the historical view (connection + invoice +
  // payment link + actions). Events renders qb_event_log entries for
  // this quote — operators answer "what happened?" without opening
  // the database. Link is the orphan-recovery flow: paste a QB
  // invoice number that was created outside InkTracker and link it
  // to this quote.
  const [qbPanelTab, setQbPanelTab] = useState("status");
  const [qbEvents, setQbEvents] = useState([]);
  const [qbEventsLoading, setQbEventsLoading] = useState(false);
  const [qbEventsErr, setQbEventsErr] = useState("");
  const [qbRefreshing, setQbRefreshing] = useState(false);
  const [qbLinkInput, setQbLinkInput] = useState("");
  const [qbLinking, setQbLinking] = useState(false);
  const [qbLinkMsg, setQbLinkMsg] = useState("");

  const [localArtwork, setLocalArtwork] = useState(quote?.selected_artwork || []);

  // ── Possible-duplicate customer banner ───────────────────────────
  // Wizard submissions always create a fresh customer row, then flag
  // any same-email match under the same shop as
  // `possible_existing_customer_id`. The banner gives the shop two
  // shop-driven decisions (never automatic):
  //   "Link to existing"   → re-points quote.customer_id to the
  //                          match, additively fills blank fields on
  //                          the existing customer from the wizard
  //                          submission, and deletes the auto-created
  //                          row if it has no other refs.
  //   "Keep separate"      → clears the suggestion without changing
  //                          anything else.
  // Either choice clears `possible_existing_customer_id` so the
  // banner doesn't reappear. No data is ever erased — see the
  // beloved's-merge incident in feedback_customer_merge_safety.
  const [possibleMatch, setPossibleMatch] = useState(null);
  const [possibleMatchPriorCount, setPossibleMatchPriorCount] = useState(0);
  const [linkingCustomer, setLinkingCustomer] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function loadMatch() {
      const matchId = quote?.possible_existing_customer_id;
      if (!matchId) {
        setPossibleMatch(null);
        setPossibleMatchPriorCount(0);
        return;
      }
      try {
        const matchRow = await base44.entities.Customer.get(matchId);
        if (cancelled) return;
        setPossibleMatch(matchRow);
        const priorQuotes = await base44.entities.Quote
          .filter({ shop_owner: quote.shop_owner, customer_id: matchId }, "", 200);
        if (cancelled) return;
        setPossibleMatchPriorCount((priorQuotes || []).length);
      } catch {
        if (!cancelled) {
          setPossibleMatch(null);
          setPossibleMatchPriorCount(0);
        }
      }
    }
    loadMatch();
    return () => { cancelled = true; };
  }, [quote?.possible_existing_customer_id, quote?.shop_owner]);

  async function handleLinkToExisting() {
    if (!possibleMatch) return;
    setLinkingCustomer(true);
    try {
      const autoCustomerId = quote.customer_id;
      const targetId = possibleMatch.id;

      // Additive merge — fill blanks on the existing record from the
      // wizard-created one. Never overwrite a field that already has
      // a value on the existing customer.
      try {
        const autoCustomer = await base44.entities.Customer.get(autoCustomerId);
        const mergeUpdates = {};
        const fields = ["name", "email", "phone", "company", "address", "tax_id", "notes"];
        for (const f of fields) {
          const cur = (possibleMatch[f] ?? "").toString().trim();
          const incoming = (autoCustomer?.[f] ?? "").toString().trim();
          if (!cur && incoming) mergeUpdates[f] = incoming;
        }
        if (Object.keys(mergeUpdates).length > 0) {
          await base44.entities.Customer.update(targetId, mergeUpdates);
        }
      } catch {
        // Merge attempt is best-effort. Re-pointing still proceeds.
      }

      const updatedQuote = await base44.entities.Quote.update(quote.id, {
        customer_id: targetId,
        possible_existing_customer_id: null,
      });

      // Cleanup: delete the auto-created customer if nothing else
      // references it. Safe by definition — we just re-pointed the
      // only quote pointing at it.
      try {
        const [otherQ, ords, invs] = await Promise.all([
          base44.entities.Quote.filter({ customer_id: autoCustomerId }, "", 1),
          base44.entities.Order.filter({ customer_id: autoCustomerId }, "", 1),
          base44.entities.Invoice.filter({ customer_id: autoCustomerId }, "", 1),
        ]);
        if ((otherQ || []).length === 0 && (ords || []).length === 0 && (invs || []).length === 0) {
          await base44.entities.Customer.delete(autoCustomerId);
        }
      } catch {
        // Cleanup is best-effort. The quote is already correctly linked.
      }

      onUpdated?.(updatedQuote);
      notify.success(`Linked to ${possibleMatch.name || "existing customer"}.`);
    } catch (err) {
      notify.error("Couldn't link to existing customer", err);
    } finally {
      setLinkingCustomer(false);
    }
  }

  async function handleKeepSeparate() {
    setLinkingCustomer(true);
    try {
      const updated = await base44.entities.Quote.update(quote.id, {
        possible_existing_customer_id: null,
      });
      onUpdated?.(updated);
    } catch (err) {
      notify.error("Couldn't update quote", err);
    } finally {
      setLinkingCustomer(false);
    }
  }
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
        // Shared helper: validates (extension/size/scriptable-SVG — this
        // inline path skipped all of it) and writes the artwork_objects
        // ownership row the read policy resolves through. file_url is the
        // /artwork/ path-carrier; `path` stays the canonical reference.
        const { path, file_url } = await uploadFile(file);
        newArtwork.push({ id: path, name: file.name, path, url: file_url, note: "", source: "upload" });
      }
      await base44.entities.Quote.update(quote.id, { selected_artwork: newArtwork });
      setLocalArtwork(newArtwork);
      // Propagate to the parent list so reopening the modal doesn't re-seed
      // from a stale quote object (the "removed attachment comes back" bug).
      onUpdated?.({ ...quote, selected_artwork: newArtwork });
    } catch (err) {
      setUploadError(err?.message || "Upload failed.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function removeArtwork(artId) {
    // Match the same key collectAttachments/removableIds use (id, then url /
    // file_url / name) so items stored without an `id` still remove cleanly.
    const newArtwork = localArtwork.filter((a) => (a.id || a.url || a.file_url || a.name) !== artId);
    await base44.entities.Quote.update(quote.id, { selected_artwork: newArtwork });
    setLocalArtwork(newArtwork);
    // Keep the parent list in sync — otherwise reopening re-seeds localArtwork
    // from the stale quote and the removed attachment reappears.
    onUpdated?.({ ...quote, selected_artwork: newArtwork });
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
      const { data, error: invErr } = await base44.functions.invoke("qbSync", {
        action: "checkConnection",
        accessToken: session?.access_token,
      });
      setQbConnected(!invErr && !!data?.connected);
    } catch {
      setQbConnected(false);
    } finally {
      setQbCheckingConn(false);
    }
  }

  async function handleQBSync() {
    // Sync-only: creates the invoice in QuickBooks and mints the pay-now
    // link (used by the Send flow) WITHOUT QuickBooks emailing the customer
    // — noEmail:true below suppresses the /send fallback. No confirm needed:
    // this doesn't notify the customer, it just prepares the QB invoice.
    // The shop emails the customer deliberately via Send Quote.
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

      // QB-push call site, so tax_mode='quickbooks' by definition. The factory
      // exists so other call sites (UI tax display, internal-only shops) can
      // pull the right provider from the loaded shop.
      const provider = taxProviderFor(
        { tax_mode: "quickbooks" },
        {
          qbSyncUrl: `${supabaseUrl}/functions/v1/qbSync`,
          accessToken: session.access_token,
        }
      );
      const { raw: data } = await provider.pushInvoice(quote, {
        customer: customerPayload,
        invoicePayload,
        noEmail: true, // sync-only — QB must not email; Send delivers it
      });

      // UPDATE-on-existing-invoice failed in QB. Edge function refused
      // to silently create a duplicate (the Shana Krochmal class of
      // bug). Surface the structured guidance directly — operator's
      // next move is to hit Refresh, not retry Sync (which would just
      // fail the same way again until the underlying QB-side issue
      // resolves).
      if (data?.updateFailed) {
        setQbInvoiceId(data.qbInvoiceId);
        if (data.paymentLink) setQbPaymentLink(data.paymentLink);
        setQbError(data.message || "QuickBooks update failed; we refused to create a duplicate. Try Refresh.");
        return;
      }

      setQbPaymentLink(data.paymentLink);
      setQbInvoiceId(data.qbInvoiceId);
      if (data.qbDocNumber) setQbDocNumber(data.qbDocNumber);
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
    navigator.clipboard.writeText(qbPaymentLink).catch(() => {});
    setQbCopied(true);
    setTimeout(() => setQbCopied(false), 2000);
  }

  // ── Refresh from QB: re-pull invoice state, reconcile back, convert
  // if newly paid. Read-mostly write that uses the qb_event_log audit
  // wrapper on the edge function so every refresh leaves a trail.
  async function handleQBRefresh() {
    setQbRefreshing(true);
    setQbError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not signed in");
      const { data, error: invErr } = await base44.functions.invoke("qbSync", {
        action: "refreshInvoice",
        accessToken: session.access_token,
        quote_id: quote.id,
        qb_invoice_id: qbInvoiceId || null,
      });
      if (invErr) throw new Error(invErr.message || "Refresh failed.");
      if (data?.error) throw new Error(data.error);
      if (data?.refreshed === false) {
        setQbError(data.message || "Nothing to refresh.");
        return;
      }
      // Patch local state — the edge function already wrote back to
      // the quotes row, this just mirrors so the modal updates
      // without a full reload.
      if (data?.paymentLink) setQbPaymentLink(data.paymentLink);
      // If the refresh triggered a quote → order conversion, the
      // quote is no longer a quote. Surface that and let the parent
      // refetch (onSend triggers the same path).
      if (data?.conversion?.action === "convert" && data?.conversion?.orderId) {
        setQbError(
          `QuickBooks reports this invoice paid — converted to order ${data.conversion.orderId}. ` +
          `Refresh the page to see the new order.`,
        );
        onSend?.();
      }
      // Always re-load the events tab after a refresh, so the operator
      // sees the new audit row land.
      if (qbPanelTab === "events") loadQbEvents();
    } catch (err) {
      setQbError(err?.message || "Refresh failed.");
    } finally {
      setQbRefreshing(false);
    }
  }

  // ── Link an existing QB invoice (created outside InkTracker) ─────
  async function handleQBLink() {
    setQbLinking(true);
    setQbLinkMsg("");
    setQbError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not signed in");
      const { data, error: invErr } = await base44.functions.invoke("qbSync", {
        action: "linkQbInvoice",
        accessToken: session.access_token,
        quote_id: quote.id,
        qb_invoice_input: qbLinkInput,
      });
      if (invErr) throw new Error(invErr.message || "Link failed.");
      if (data?.error) throw new Error(data.error);
      if (data?.linked === false) {
        // Structured outcomes — invalid_input / not_found / ambiguous.
        // The edge function already shaped the message for display.
        setQbLinkMsg(data.message || "Couldn't link that invoice.");
        return;
      }
      setQbInvoiceId(data.qbInvoiceId);
      if (data.qbDocNumber) setQbDocNumber(data.qbDocNumber);
      if (data.paymentLink) setQbPaymentLink(data.paymentLink);
      setQbLinkInput("");
      setQbLinkMsg(
        `Linked QuickBooks invoice ${data.qbDocNumber || `#${data.qbInvoiceId}`}` +
        (data.paid ? " — already paid in QB." : "."),
      );
      // Jump back to the Status tab so the operator sees the new link.
      setQbPanelTab("status");
      onSend?.();
    } catch (err) {
      setQbLinkMsg(err?.message || "Link failed.");
    } finally {
      setQbLinking(false);
    }
  }

  // ── Load the qb_event_log timeline for this quote ────────────────
  async function loadQbEvents() {
    setQbEventsLoading(true);
    setQbEventsErr("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not signed in");
      const { data, error: invErr } = await base44.functions.invoke("qbSync", {
        action: "getQbEvents",
        accessToken: session.access_token,
        quote_id: quote.id,
        limit: 100,
      });
      if (invErr) throw new Error(invErr.message || "Couldn't load events.");
      if (data?.error) throw new Error(data.error);
      setQbEvents(Array.isArray(data?.events) ? data.events : []);
    } catch (err) {
      setQbEventsErr(err?.message || "Couldn't load events.");
    } finally {
      setQbEventsLoading(false);
    }
  }

  // Auto-load events when the user switches to the Events tab.
  useEffect(() => {
    if (showQBPanel && qbPanelTab === "events") loadQbEvents();
     
  }, [showQBPanel, qbPanelTab]);

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

  // Use saved totals when available; fall back to live recalc for legacy
  // quotes that pre-date the line-item stamping. Saved totals are the
  // single source of truth — both broker quotes (BROKER_MARKUP, stamped by
  // BrokerQuoteEditor.runSave) and non-broker quotes use this path so the
  // shop's view stays in lockstep with what the broker / shop quoted.
  const totals = useMemo(() => {
    if (quote?.total != null && quote?.subtotal != null) {
      // Rush from the saved per-line _rushFee stamps — quote.rushTotal was
      // never persisted, so the old read was always 0 and the rush row never
      // rendered on a saved quote. subtotal is shown ex-rush with a separate
      // rush row, footing to the saved total.
      const rush = savedRushTotal(quote);
      return {
        sub: Number(quote.subtotal),
        subtotal: Number(quote.subtotal) - rush,
        rushTotal: rush,
        afterDisc: savedAfterDiscount(quote),
        tax: Number(quote.tax || 0),
        total: Number(quote.total),
      };
    }
    return getQuoteTotalsForDisplay(quote || {});
  }, [quote]);

  if (!quote) return null;

  const lineItems = Array.isArray(quote.line_items) ? quote.line_items : [];
  const totalQty = lineItems.reduce((sum, li) => sum + getQty(li), 0);
  const activeExtras = Object.entries(quote.extras || {}).filter(([, enabled]) => enabled);

  return (
    <>
      <ModalBackdrop onClose={onClose} z="z-50">
        <div
          className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl my-4 max-h-[calc(100vh-2rem)] overflow-y-auto"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Sticky header so the title + status badges stay visible
              while user scrolls the long quote contents. Without this,
              tall quotes scrolled the header off and there was no way
              to recover the top short of closing + reopening. */}
          <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 flex justify-between items-start px-4 sm:px-6 py-5 border-b border-slate-200 dark:border-slate-700">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">
                {quote.quote_id}
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                {getShopFacingCustomer(quote, customer)}
              </h2>
              {quote.job_title && (
                <div className="text-xs sm:text-sm text-slate-500 mt-0.5 truncate">
                  Job: {quote.job_title}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 mt-1">
                {quote.date && (
                  <div className="text-xs sm:text-sm text-slate-500">
                    Quote Date: {fmtDate(quote.date)}
                  </div>
                )}
                {quote.due_date && (
                  <div className="text-xs sm:text-sm text-slate-500">
                    · In-Hands: {fmtDate(quote.due_date)}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <Badge s={quote.status} />
              {DEPOSITS_ENABLED && quote.deposit_paid ? (
                <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                  Paid
                </span>
              ) : null}
              <button
                onClick={onClose}
                className="text-slate-500 hover:text-slate-600 text-lg leading-none"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="p-4 sm:p-6 space-y-5">
            {possibleMatch && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <UserCheck className="w-5 h-5 text-amber-700 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-amber-900 leading-snug">
                    This wizard submission's email matches an existing customer{" "}
                    <span className="font-semibold">{possibleMatch.name || possibleMatch.email}</span>
                    {possibleMatchPriorCount > 0 && ` (${possibleMatchPriorCount} prior quote${possibleMatchPriorCount === 1 ? "" : "s"})`}
                    . Link this quote to that customer, or keep them separate?
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleLinkToExisting}
                    disabled={linkingCustomer}
                    className="text-xs font-semibold uppercase tracking-wider px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50 transition flex items-center gap-1.5"
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    Link to {possibleMatch.name || "existing"}
                  </button>
                  <button
                    onClick={handleKeepSeparate}
                    disabled={linkingCustomer}
                    className="text-xs font-semibold uppercase tracking-wider px-3 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 disabled:opacity-50 transition flex items-center gap-1.5"
                  >
                    <UserX className="w-3.5 h-3.5" />
                    Keep separate
                  </button>
                </div>
                <div className="text-[11px] text-amber-700/80 leading-snug">
                  Linking fills any blank fields on the existing customer from this submission, then removes the duplicate row. No data is overwritten.
                </div>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                  Customer
                </div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {getShopFacingCustomer(quote, customer)}
                </div>
                {isBrokerQuote(quote) && getShopFacingReference(quote, customer) && (
                  <div className="text-sm text-slate-500">
                    {getShopFacingReference(quote, customer)}
                  </div>
                )}
                <div className="text-sm text-slate-500">
                  {isBrokerQuote(quote)
                    ? (quote.broker_email || quote.broker_id || "—")
                    : (quote.customer_email || "—")}
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">
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
                {DEPOSITS_ENABLED && (
                  <div className="flex justify-between text-sm text-slate-500">
                    <span>Deposit</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {quote.deposit_pct || 50}%
                    </span>
                  </div>
                )}
              </div>
            </div>

            {activeExtras.length > 0 && (
              <div className="bg-teal-50 rounded-xl border border-teal-100 p-4">
                <div className="text-xs font-semibold uppercase tracking-widest text-teal-400 mb-2">
                  Add-ons
                </div>
                <div className="flex flex-wrap gap-2">
                  {activeExtras.map(([key]) => (
                    <span
                      key={key}
                      className="text-xs font-semibold text-teal-700 bg-white dark:bg-slate-900 border border-teal-200 px-2.5 py-1 rounded-full"
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
                  const pricing = getLinePrice(li, quote);
                  const twoXL = pricing?.twoXL || 0;
                  const activeSizes = SIZES.filter(
                    (sz) => (parseInt((li.sizes || {})[sz], 10) || 0) > 0
                  );

                  return (
                    <div
                      key={li.id}
                      className="border border-slate-200 dark:border-slate-700 border-l-4 border-l-teal-600 rounded-xl overflow-hidden shadow-sm"
                    >
                      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="text-base font-bold text-slate-900 dark:text-slate-100">
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
                              <div className="text-base font-bold text-teal-600">
                                {fmtMoney(pricing.ppp)}<span className="text-xs font-medium text-teal-400">/pc</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="p-4 space-y-4">
                        <div className="grid gap-4 grid-cols-1 lg:grid-cols-[1.2fr_0.8fr]">
                          <div className="space-y-3">
                            {activeSizes.length > 0 && (
                              <div>
                                <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-2">
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
                              <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-2">
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
                                            {/* Embroidery imp.colors is a stitch-tier index, not a
                                                color count — imprintCountText renders "5K-10K stitches"
                                                for embroidery, "N colors" otherwise. */}
                                            {imprintCountText(imp, getShopPricingConfig()?.embroidery?.stitchTiers) && (
                                              <span>{imprintCountText(imp, getShopPricingConfig()?.embroidery?.stitchTiers)}</span>
                                            )}
                                            {imp.pantones && (
                                              <span className="font-medium text-teal-600">
                                                {imprintColorLabel(imp)}: {imp.pantones}
                                              </span>
                                            )}
                                            {imp.details && (
                                              <span className="text-slate-500 italic">
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
                                          <div className="bg-teal-50 border border-teal-100 rounded-xl px-4 py-3">
                                            <div className="text-[11px] font-bold uppercase tracking-widest text-teal-400 mb-2">
                                              Attached Artwork
                                            </div>

                                            <div className="flex items-center justify-between gap-3">
                                              <div className="min-w-0">
                                                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                                                  {art.name}
                                                </div>

                                                {art.note && (
                                                  <div className="text-xs text-slate-500 truncate mt-0.5">
                                                    {art.note}
                                                  </div>
                                                )}

                                                {art.colors && (
                                                  <div className="text-xs text-teal-600 font-semibold mt-1">
                                                    Artwork colors: {art.colors}
                                                  </div>
                                                )}
                                              </div>

                                              {art.url ? (
                                                <a
                                                  href={art.url}
                                                  onClick={(e) => { e.preventDefault(); openSignedArtwork(art.path || art.url); }}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="shrink-0 text-xs font-semibold text-teal-600 border border-teal-200 px-3 py-1.5 rounded-lg hover:bg-teal-50 transition"
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
                              <div className="bg-teal-50 border border-teal-100 rounded-lg px-3 py-2">
                                <div className="flex justify-between text-xs text-slate-600">
                                  <span>Line Subtotal</span>
                                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                                    {fmtMoney(pricing.ppp * qty)}
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
                    <span>{fmtMoney(totals.subtotal)}</span>
                  </div>

                  {(totals.rushTotal || 0) > 0 && (
                    <div className="flex justify-between text-sm text-orange-600">
                      <span>Rush Fee ({Math.round((parseFloat(quote.rush_rate) || 0) * 100)}%)</span>
                      <span>{fmtMoney(totals.rushTotal)}</span>
                    </div>
                  )}

                  {parseFloat(quote.discount) > 0 && (() => {
                    const dv = parseFloat(quote.discount);
                    const flat = quote.discount_type === "flat" || (dv > 100 && quote.discount_type !== "percent");
                    return (
                      <div className="flex justify-between text-sm text-emerald-600">
                        <span>
                          Discount {flat ? `(${fmtMoney(dv)})` : `(${quote.discount}%)`}
                          {quote.discount_description ? ` — ${quote.discount_description}` : ""}
                        </span>
                        <span>−{fmtMoney(totals.sub - totals.afterDisc)}</span>
                      </div>
                    );
                  })()}

                  {/* Setup / screen fees + one-off additional fees, itemized so
                      the total isn't an unexplained jump. Read from the saved
                      snapshot fields. */}
                  {(parseFloat(quote.setup_total) || 0) > 0 && (
                    <div className="flex justify-between text-sm text-slate-500">
                      <span>Setup &amp; Screen Fees</span>
                      <span>{fmtMoney(Number(quote.setup_total))}</span>
                    </div>
                  )}
                  {normalizeAdditionalCharges(quote.additional_charges).map((c) => (
                    <div key={c.id || c.label} className="flex justify-between text-sm text-slate-500">
                      <span>{c.label || "Additional fee"}</span>
                      <span>{fmtMoney(c.amount)}</span>
                    </div>
                  ))}

                  {(() => {
                    // If the quote was edited after the QB invoice was created
                    // (e.g. a fee added), qb_total is stale — trust the quote's
                    // real saved total instead, and warn the shop to regenerate.
                    const stale = isQbStale(quote);
                    const hasQb = quote.qb_total != null && Number(quote.qb_tax_amount || 0) > 0 && !stale;
                    const savedTotal = quote.total != null ? Number(quote.total) : totals.total;
                    const savedTax = quote.tax != null ? Number(quote.tax) : totals.tax;
                    const taxVal = hasQb ? Number(quote.qb_tax_amount) : savedTax;
                    const totalVal = hasQb ? Number(quote.qb_total) : savedTotal;
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
                        {!hasQb && !stale && (
                          <div className="text-[11px] text-slate-500 -mt-1">
                            {/* TAX-02: non-QB quotes use the shop's flat rate; there's no
                                ship-to recalculation at checkout, so don't claim one. */}
                            Estimated using the shop&rsquo;s sales-tax rate.
                          </div>
                        )}
                        {stale && (
                          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-1">
                            This quote was edited after its QuickBooks invoice was created. The
                            customer total shown is the updated amount ({fmtMoney(savedTotal)}); the
                            QB invoice still has {fmtMoney(Number(quote.qb_total))}. Regenerate the QB
                            invoice so the customer is charged the correct amount.
                          </div>
                        )}
                        {!stale && (() => {
                          // QB was edited after this quote was sent (the quote
                          // itself is unchanged, so it's not the stale case).
                          // Offer the shop a one-click reconcile toward QB.
                          const mod = qbModifiedState(quote);
                          if (!mod.modified) return null;
                          const higher = mod.delta > 0; // delta = qb − local
                          return (
                            <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 mt-1 space-y-2">
                              <div>
                                <span className="font-semibold">Modified in QuickBooks.</span>{" "}
                                QuickBooks recorded {fmtMoney(mod.qbTotal)} for this quote —{" "}
                                {fmtMoney(Math.abs(mod.delta))} {higher ? "more" : "less"} than the{" "}
                                {fmtMoney(mod.localTotal)} it was sent at. Your customer is billed the
                                QuickBooks amount.
                              </div>
                              {!readOnly && (
                                <button
                                  onClick={handleMatchQb}
                                  disabled={matchingQb}
                                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 px-3 py-1.5 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {matchingQb ? "Matching…" : "Match to QuickBooks"}
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </>
                    );
                  })()}

                  {DEPOSITS_ENABLED && (
                    <div className="flex justify-between text-sm text-teal-700 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2">
                      <span className="font-semibold">Deposit Due</span>
                      <span className="font-bold">{fmtMoney(totals.deposit)}</span>
                    </div>
                  )}
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
                  QB Invoice {qbDocNumber || (qbInvoiceId ? `#${qbInvoiceId}` : "")} created
                  {qbPaymentLink ? " · Payment link ready" : ""}
                </span>
                <span className="text-xs text-emerald-600 font-semibold">View →</span>
              </button>
            </div>
          )}

          <CollapsibleSection
            title="Attachments & Mockups"
            icon={<Paperclip className="w-4 h-4 text-slate-500" />}
            storageKey="attachments-window-collapsed"
            className="px-4 sm:px-6 py-4 border-t border-slate-200 dark:border-slate-700"
          >
            <AttachmentGallery
              record={{ ...quote, selected_artwork: localArtwork }}
              title={null}
              backLabel="Back to quote"
              onUpload={handleArtworkUpload}
              onRemove={(art) => removeArtwork(art.id)}
              uploading={uploading}
              uploadError={uploadError}
            />
          </CollapsibleSection>

          {/* Messages — threaded conversation with reply box. Collapsible;
              persists per-user via shared localStorage key so it stays
              hidden across reloads / across all three detail modals. */}
          <CollapsibleSection
            title="Messages"
            icon={<MessageSquare className="w-4 h-4 text-slate-500" />}
            storageKey="messages-window-collapsed"
            className="px-4 sm:px-6 py-4 border-t border-slate-200 dark:border-slate-700"
          >
            <MessagesTab
              threadId={quoteThreadId(quote)}
              currentUserEmail={quote.shop_owner}
              replyContext={{
                customerEmail: quote.customer_email || customer?.email || "",
                shopName,
                shopLogoUrl: logoUrl,
                refId: quote.quote_id,
                defaultSubject: `Quote ${quote.quote_id}`,
              }}
            />
          </CollapsibleSection>

          <div className="flex flex-wrap gap-2 px-4 sm:px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-b-2xl">
            {/* Edit is hidden entirely when read-only — the user must not be
                able to open the editor at all. ReactivateLink below explains. */}
            {!quote?.broker_id && !readOnly && (
              <button
                onClick={onEdit}
                className="px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 transition"
              >
                Edit Quote
              </button>
            )}

            <button
              onClick={() => setShowSendModal(true)}
              disabled={readOnly}
              title={readOnly ? RO_TITLE : undefined}
              className="px-4 py-2 text-sm font-semibold text-teal-700 border border-teal-200 bg-teal-50 rounded-xl hover:bg-teal-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send Quote
            </button>

            {/* Standalone "Send via QuickBooks" button removed on 2026-05-12 —
                payment-provider selection (Stripe vs QB) is now picked inside
                SendQuoteModal. The QB Status Panel remains reachable via the
                existing "QB Invoice #… created" chip below once an invoice
                exists (which opens the same openQBPanel flow). */}
            {qbInvoiceId && (
              <button
                onClick={openQBPanel}
                className="px-4 py-2 text-sm font-semibold text-[#2CA01C] border border-[#2CA01C] bg-white dark:bg-slate-900 rounded-xl hover:bg-green-50 transition"
              >
                QB Invoice Status
              </button>
            )}

            <button
              onClick={() => previewPdf(exportQuoteToPDF(
                quote,
                { shopName, logoUrl, customerCompany: customer?.company || "", customerEmail: quote.customer_email || customer?.email || "", customerPhone: quote.customer_phone || customer?.phone || "", output: "blob" },
              ))}
              className="px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 transition"
            >
              Preview PDF
            </button>
            {STATUS_ACTIONABLE.includes(quote.status) && (
              <>
                <button
                  onClick={() => callAction(onApprove, quote.id)}
                  disabled={saving || readOnly}
                  title={readOnly ? RO_TITLE : undefined}
                  className="px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? "Saving…" : "Approve"}
                </button>

                <button
                  onClick={() => callAction(onDecline, quote.id)}
                  disabled={saving || readOnly}
                  title={readOnly ? RO_TITLE : undefined}
                  className="px-4 py-2 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? "Saving…" : "Decline"}
                </button>
              </>
            )}

            {/* isConvertedToOrder guard: a desynced row (converted_order_id
                set, status regressed) must not offer a Convert button that
                dead-ends in the "already converted" toast. */}
            {(quote.status === "Approved" || quote.status === "Approved and Paid" || quote.status === "Client Approved") && !isConvertedToOrder(quote) && (
              <button
                onClick={() => callAction(onConvert, quote)}
                disabled={saving || readOnly}
                title={readOnly ? RO_TITLE : undefined}
                className="px-4 py-2 text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? "Converting…" : "Convert to Order"}
              </button>
            )}

            {DEPOSITS_ENABLED && onTogglePaid && (
              <button
                onClick={() => callAction(onTogglePaid, quote)}
                disabled={saving || readOnly}
                title={readOnly ? RO_TITLE : undefined}
                className={`px-4 py-2 text-sm font-semibold rounded-xl border transition disabled:opacity-50 disabled:cursor-not-allowed ${
                  quote.deposit_paid
                    ? "text-slate-600 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                    : "text-emerald-700 border-emerald-300 bg-emerald-50 hover:bg-emerald-100"
                }`}
              >
                {saving ? "Saving…" : quote.deposit_paid ? "Mark as Unpaid" : "✓ Mark as Paid"}
              </button>
            )}

            {onDuplicate && (
              <button
                onClick={() => onDuplicate(quote)}
                disabled={readOnly}
                title={readOnly ? RO_TITLE : undefined}
                className="px-4 py-2 text-sm font-semibold text-slate-500 border border-slate-200 rounded-xl hover:bg-slate-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Duplicate
              </button>
            )}

            {onDelete && (
              <button
                onClick={() => callAction(onDelete, quote.id)}
                disabled={saving || readOnly}
                title={readOnly ? RO_TITLE : undefined}
                className="px-4 py-2 text-sm font-semibold text-red-400 border border-red-200 rounded-xl hover:bg-red-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? "Deleting…" : "Delete Quote"}
              </button>
            )}

            {/* Explains why the write actions above are disabled. Renders
                nothing when the shop can still write. */}
            <ReactivateLink show={readOnly} href={reactivateHref} className="self-center" />

            <button
              onClick={onClose}
              className="ml-auto px-4 py-2 text-sm font-semibold text-slate-500 rounded-xl hover:bg-slate-100 transition"
            >
              Close
            </button>
          </div>
        </div>
      </ModalBackdrop>

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
        <ModalBackdrop onClose={() => setShowQBPanel(false)} z="z-[60]">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#2CA01C] flex items-center justify-center text-white font-black text-xs">QB</div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-lg">QuickBooks</h3>
              </div>
              <button onClick={() => setShowQBPanel(false)} className="text-slate-500 hover:text-slate-600 text-xl leading-none">✕</button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
              {[
                { id: "status", label: "Status" },
                { id: "events", label: "Events" },
                { id: "link",   label: "Link Existing" },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setQbPanelTab(t.id)}
                  className={
                    "px-3 py-2 text-xs font-bold transition border-b-2 -mb-px " +
                    (qbPanelTab === t.id
                      ? "border-[#2CA01C] text-[#2CA01C]"
                      : "border-transparent text-slate-500 hover:text-slate-800")
                  }
                >{t.label}</button>
              ))}
            </div>

            {qbPanelTab === "status" && (<>

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
                  <a href="/account" className="ml-auto text-xs font-semibold text-teal-600 hover:underline">Connect →</a>
                </>
              )}
            </div>

            {/* Invoice status */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Invoice</div>
              {qbInvoiceId ? (
                <div className="flex items-center gap-2 p-3 rounded-xl border border-emerald-200 bg-emerald-50">
                  <span className="text-emerald-600 text-lg">✓</span>
                  <div>
                    <div className="text-sm font-bold text-emerald-800">Invoice {qbDocNumber || `#${qbInvoiceId}`}</div>
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
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Payment Link</div>
                <div className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                  <a
                    href={qbPaymentLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-teal-600 underline flex-1 truncate"
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
                <p className="text-xs text-slate-500">Send this link to your customer so they can pay the QB invoice directly.</p>
              </div>
            )}

            {/* Quote details */}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                <div className="text-xs text-slate-500 mb-0.5">Quote</div>
                <div className="font-bold text-slate-800 dark:text-slate-200">#{quote.quote_id}</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                <div className="text-xs text-slate-500 mb-0.5">Amount</div>
                {/* Saved total (what the QB invoice bills) — NOT a live recompute.
                    getQuoteTotalsForDisplay excludes setup/screen fees and reprices
                    under the viewer's config, so it showed e.g. $1,000 next to a
                    saved "Total $1,060" and the actual QB invoice of $1,060. */}
                <div className="font-bold text-teal-700">{fmtMoney(totals.total)}</div>
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
                  {qbSyncing ? "Syncing…" : qbInvoiceId ? "Re-sync Invoice" : "Create QB Invoice & Email Customer"}
                </button>
              )}
              {qbInvoiceId && qbConnected && (
                <button
                  onClick={handleQBRefresh}
                  disabled={qbRefreshing}
                  className="px-3 text-sm font-semibold border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition"
                  title="Re-pull this invoice's current state from QuickBooks. Use when a payment looks missed or totals look stale."
                >
                  {qbRefreshing ? "…" : "Refresh"}
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
                  className="flex-1 text-center bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 rounded-xl text-sm transition"
                >
                  Connect QuickBooks
                </a>
              )}
            </div>

            {qbInvoiceId && (
              <button
                onClick={() => { setShowQBPanel(false); setShowSendModal(true); }}
                className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-3 rounded-xl text-sm transition"
              >
                Send to Customer
              </button>
            )}
            </>)}

            {qbPanelTab === "events" && (
              <div className="space-y-2">
                {qbEventsLoading && (
                  <div className="text-sm text-slate-500 p-4 text-center">Loading…</div>
                )}
                {qbEventsErr && (
                  <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-semibold">
                    {qbEventsErr}
                  </div>
                )}
                {!qbEventsLoading && !qbEventsErr && qbEvents.length === 0 && (
                  <div className="p-6 text-center text-sm text-slate-500">
                    No QuickBooks events recorded for this quote yet.
                  </div>
                )}
                {!qbEventsLoading && qbEvents.length > 0 && (
                  <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                    {qbEvents.map((ev) => (
                      <li
                        key={ev.id}
                        className="p-3 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className={
                              "px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded " +
                              (ev.status === "success"   ? "bg-emerald-100 text-emerald-700" :
                               ev.status === "error"     ? "bg-red-100 text-red-700" :
                               ev.status === "skipped"   ? "bg-slate-200 text-slate-600" :
                               ev.status === "duplicate" ? "bg-amber-100 text-amber-700" :
                               ev.status === "started"   ? "bg-blue-100 text-blue-700" :
                               "bg-slate-100 text-slate-600")
                            }>{ev.status}</span>
                            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{ev.action}</span>
                            <span className="text-[10px] text-slate-500 uppercase">{ev.direction}</span>
                          </div>
                          <span className="text-[10px] text-slate-500">{formatEventTime(ev.created_at)}</span>
                        </div>
                        {ev.error_message && (
                          <div className="mt-1 text-xs text-red-700 font-mono break-words">{ev.error_message}</div>
                        )}
                        <div className="mt-1 text-[10px] text-slate-500 flex items-center gap-2 flex-wrap">
                          {ev.qb_invoice_id && <span>inv #{ev.qb_invoice_id}</span>}
                          {ev.duration_ms != null && <span>{ev.duration_ms}ms</span>}
                          {ev.idempotency_key && <span title={ev.idempotency_key}>idemp ✓</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {qbPanelTab === "link" && (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">
                  Already created the QuickBooks invoice manually? Paste its
                  Invoice # (e.g. <span className="font-mono">Q-2026-115</span>)
                  or numeric Id to link it to this quote. Payment status will
                  carry over.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={qbLinkInput}
                    onChange={(e) => setQbLinkInput(e.target.value)}
                    placeholder="QB invoice # or Id"
                    className="flex-1 px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900"
                  />
                  <button
                    onClick={handleQBLink}
                    disabled={qbLinking || !qbLinkInput.trim() || !qbConnected}
                    className="px-4 bg-[#2CA01C] hover:bg-[#238516] disabled:opacity-50 text-white font-bold rounded-xl text-sm transition"
                  >
                    {qbLinking ? "Linking…" : "Link"}
                  </button>
                </div>
                {qbLinkMsg && (
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300">
                    {qbLinkMsg}
                  </div>
                )}
                {!qbConnected && !qbCheckingConn && (
                  <div className="text-xs text-rose-600">
                    Connect QuickBooks first to link an existing invoice.
                  </div>
                )}
              </div>
            )}
          </div>
        </ModalBackdrop>
      )}
    </>
  );
}