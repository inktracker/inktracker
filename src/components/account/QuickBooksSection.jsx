import { useState } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { CheckCircle2, AlertCircle, Link2, RefreshCw, DownloadCloud } from "lucide-react";
import { loadShopPricingConfig, GARMENT_CATEGORIES, getEnabledTechniques } from "@/components/shared/pricing";
import { shopScope } from "@/lib/shopScope";

// Account → QuickBooks Integration section (presentational). Extracted
// verbatim from Account.jsx as a pure decomposition — no behavior change.
// All QB connection state, effects, and handlers stay owned by the parent
// Account page (they must run on page load — e.g. the OAuth redirect toast —
// not when this collapsible section is first expanded). Everything the JSX
// needs is threaded in as props. QbItemMapEditor is self-contained and only
// renders when connected + expanded, exactly as before.
export default function QuickBooksSection({
  user,
  qbMessage,
  setQbMessage,
  qbConnected,
  qbRealmId,
  qbExpiresAt,
  qbRefreshExpiresAt,
  qbNeedsReconnect,
  qbConnecting,
  qbAccountsLoading,
  qbIncomeAccounts,
  qbIncomeAccountId,
  qbAutoAccountId,
  qbAccountSaving,
  saveIncomeAccount,
  qbSyncingAll,
  qbSyncAllError,
  qbMigrating,
  qbMigrateResult,
  qbMigratingInv,
  qbMigrateInvResult,
  qbDisconnecting,
  handleConnectQB,
  handleSyncAll,
  handleMigrateCustomers,
  handleMigrateInvoices,
  handleDisconnectQB,
}) {
  return (
    <>
      {qbMessage && (
        <div className={`flex items-center gap-2 text-sm font-semibold py-2.5 px-4 rounded-xl mb-4 ${
          qbMessage.type === "success"
            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
            : "bg-red-50 text-red-700 border border-red-200"
        }`}>
          {qbMessage.type === "success"
            ? <CheckCircle2 className="w-4 h-4 shrink-0" />
            : <AlertCircle className="w-4 h-4 shrink-0" />}
          {qbMessage.text}
          <button onClick={() => setQbMessage(null)} className="ml-auto text-current opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {qbConnected ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <span className="font-semibold text-emerald-800">Connected to QuickBooks</span>
          </div>
          {qbRealmId && (
            <div className="text-xs text-slate-500">
              Company ID: <span className="font-mono font-semibold">{qbRealmId}</span>
            </div>
          )}
          {qbExpiresAt && (
            <div className="text-xs text-slate-500">
              Access token: refreshes automatically every hour
            </div>
          )}
          {qbRefreshExpiresAt && (() => {
            const daysLeft = Math.floor((new Date(qbRefreshExpiresAt).getTime() - Date.now()) / 86400000);
            const soon = daysLeft <= 14;
            return (
              <div className={`text-xs ${soon ? "text-amber-700 font-semibold" : "text-slate-500"}`}>
                Reconnect by {new Date(qbRefreshExpiresAt).toLocaleDateString()}
                {daysLeft >= 0 ? ` (${daysLeft} day${daysLeft === 1 ? "" : "s"} left)` : " (expired)"}
              </div>
            );
          })()}
          {qbRefreshExpiresAt && Math.floor((new Date(qbRefreshExpiresAt).getTime() - Date.now()) / 86400000) <= 14 && (
            <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <span className="text-xs text-amber-800">
                Your QuickBooks connection expires soon. Reconnect now to avoid an interruption to invoicing.
              </span>
              <button
                onClick={handleConnectQB}
                disabled={qbConnecting}
                className="shrink-0 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg px-3 py-1.5 transition disabled:opacity-50"
              >
                {qbConnecting ? "…" : "Reconnect"}
              </button>
            </div>
          )}
          <div className="pt-1 border-t border-emerald-100">
            <label className="block text-xs font-semibold text-slate-600 mt-2 mb-1">
              Income account for InkTracker sales
            </label>
            {/* Onboarding nudge: while on Auto, name where revenue will
                land so connecting shops make a conscious choice on day
                one (instead of discovering a misposting later). Subtle
                teal — NOT a shouty amber banner. Disappears once they
                pick an account. */}
            {!qbAccountsLoading && Array.isArray(qbIncomeAccounts) && !qbIncomeAccountId && (() => {
              const auto = qbIncomeAccounts.find((a) => a.id === qbAutoAccountId);
              if (!auto) return null;
              return (
                <div className="text-xs bg-teal-50 border border-teal-100 rounded-lg px-2.5 py-2 mb-2 text-slate-600">
                  InkTracker will post your sales to{" "}
                  <span className="font-semibold text-slate-800">“{auto.name}”</span> in QuickBooks.
                  If that’s your sales account you’re all set — otherwise pick the right one below so
                  revenue lands in the right place on your P&amp;L.
                </div>
              );
            })()}
            {qbAccountsLoading ? (
              <div className="text-xs text-slate-500">Loading your QuickBooks accounts…</div>
            ) : qbIncomeAccounts === null ? (
              <div className="text-xs text-slate-500">Couldn’t load accounts — InkTracker will choose automatically.</div>
            ) : (
              <select
                value={qbIncomeAccountId}
                onChange={(e) => saveIncomeAccount(e.target.value)}
                disabled={qbAccountSaving}
                className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white disabled:opacity-60"
              >
                <option value="">
                  {(() => {
                    const auto = (qbIncomeAccounts || []).find((a) => a.id === qbAutoAccountId);
                    return auto ? `Auto — currently “${auto.name}”` : "Auto — let InkTracker choose";
                  })()}
                </option>
                {qbIncomeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            )}
            <p className="text-[11px] text-slate-500 mt-1">
              Where InkTracker invoices post revenue in QuickBooks. Pick your sales account so it lands in the right place on your P&amp;L; leave on Auto to let InkTracker choose.
            </p>
          </div>
          <p className="text-sm text-slate-600">
            Quotes can now be sent as QuickBooks invoices. Once your client pays via the QB payment link, InkTracker automatically converts the quote to an order.
          </p>
          <a href="/qb-setup" target="_blank" rel="noopener" className="inline-block text-sm text-teal-600 hover:underline font-semibold">
            QB setup checklist — make sure your QBO side is ready →
          </a>
          <div className="border-t border-emerald-200 pt-3 mt-3">
            {/* Renamed from "Data Migration" + "Import" — these
                actions dedupe on the QB id under the hood
                (pullCustomers checks customers.qb_customer_id;
                pullInvoices checks invoices.invoice_id) so they
                can be re-run safely without creating duplicates.
                "Sync" reflects that better than "Import", which
                sounds like a one-shot copy. */}
            <div className="text-sm font-semibold text-slate-700 mb-2">Data Sync</div>

            {/* One-click: customers then invoices, in the correct order. */}
            <button
              onClick={handleSyncAll}
              disabled={qbSyncingAll !== null || qbMigrating || qbMigratingInv}
              className="w-full flex items-center justify-center gap-2 text-sm font-bold text-white bg-emerald-600 px-3 py-2.5 rounded-xl hover:bg-emerald-700 transition disabled:opacity-50"
            >
              {qbSyncingAll ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  {qbSyncingAll === "customers" ? "Syncing customers…" : "Syncing invoices…"}
                </>
              ) : (
                <>
                  <DownloadCloud className="w-4 h-4" />
                  Sync everything from QuickBooks
                </>
              )}
            </button>
            <p className="text-xs text-slate-500 mt-1.5">
              Imports your QuickBooks customers, then your invoices (in that order so invoices link to the right customer). Safe to re-run anytime — it updates existing records, never duplicates.
            </p>
            {qbSyncAllError && (
              <div className="mt-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                Sync failed: {qbSyncAllError}
              </div>
            )}

            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mt-4 mb-2">Or sync individually</div>
            <button
              onClick={handleMigrateCustomers}
              disabled={qbMigrating || qbSyncingAll !== null}
              className="flex items-center gap-2 text-sm font-semibold text-emerald-700 border border-emerald-300 px-3 py-2 rounded-xl hover:bg-emerald-100 transition disabled:opacity-50"
            >
              {qbMigrating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Syncing Customers…
                </>
              ) : (
                <>
                  <DownloadCloud className="w-4 h-4" />
                  1. Sync Customers from QuickBooks
                </>
              )}
            </button>
            {qbMigrateResult && !qbMigrateResult.error && (
              <>
                <div className="mt-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  Added <strong>{qbMigrateResult.imported}</strong> new customer{qbMigrateResult.imported !== 1 ? "s" : ""},
                  updated <strong>{qbMigrateResult.updated}</strong>,
                  skipped <strong>{qbMigrateResult.skipped}</strong> already in sync.
                </div>
                {qbMigrateResult.truncatedAtCap && (
                  <div className="mt-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <strong>Warning:</strong> sync stopped at 10,000 customers. Your QuickBooks has more than that; not all were synced. Contact support to raise the cap.
                  </div>
                )}
              </>
            )}
            {qbMigrateResult?.error && (
              <div className="mt-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                Migration failed: {qbMigrateResult.error}
              </div>
            )}
            <button
              onClick={handleMigrateInvoices}
              disabled={qbMigratingInv || qbSyncingAll !== null}
              className="flex items-center gap-2 text-sm font-semibold text-emerald-700 border border-emerald-300 px-3 py-2 rounded-xl hover:bg-emerald-100 transition disabled:opacity-50 mt-2"
            >
              {qbMigratingInv ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Syncing Invoices…
                </>
              ) : (
                <>
                  <DownloadCloud className="w-4 h-4" />
                  2. Sync Invoices from QuickBooks
                </>
              )}
            </button>
            {qbMigrateInvResult && !qbMigrateInvResult.error && (
              <>
                <div className="mt-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  Added <strong>{qbMigrateInvResult.imported}</strong> invoice{qbMigrateInvResult.imported !== 1 ? "s" : ""},
                  updated <strong>{qbMigrateInvResult.updated}</strong>,
                  skipped <strong>{qbMigrateInvResult.skipped}</strong> already in sync.
                </div>
                {qbMigrateInvResult.truncatedAtCap && (
                  <div className="mt-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <strong>Warning:</strong> sync stopped at 10,000 invoices. Your QuickBooks has more than that; not all were synced. Contact support to raise the cap.
                  </div>
                )}
              </>
            )}
            {qbMigrateInvResult?.error && (
              <div className="mt-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                Invoice sync failed: {qbMigrateInvResult.error}
              </div>
            )}
          </div>
          <QbItemMapEditor user={user} />
          <button
            onClick={handleDisconnectQB}
            disabled={qbDisconnecting}
            className="text-sm font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
          >
            {qbDisconnecting ? "Disconnecting…" : "Disconnect QuickBooks"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {qbNeedsReconnect && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-sm text-amber-800">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Your QuickBooks connection has expired. Reconnect below to resume sending invoices and syncing payments — your settings are preserved.</span>
            </div>
          )}
          <p className="text-sm text-slate-500">
            Connect QuickBooks to automatically generate payment links when you send quotes. When a client pays, InkTracker converts the quote to an order automatically.
          </p>

          {/* Inline trust signals. Surfaced HERE rather than buried on
              the /security page because operators won't click through —
              the moment of trust is right when they're about to hand
              over QB write access. */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
            <div className="font-semibold text-slate-700 dark:text-slate-200 text-xs uppercase tracking-wider">Before you connect:</div>
            <ul className="space-y-1">
              <li className="flex gap-2"><span className="text-emerald-600">✓</span><span>Your QuickBooks tokens live server-side only — never visible in your browser.</span></li>
              <li className="flex gap-2"><span className="text-emerald-600">✓</span><span>Every action InkTracker takes on your books shows up in the Events tab of each quote.</span></li>
              <li className="flex gap-2"><span className="text-emerald-600">✓</span><span>Idempotency keys prevent double-billing from network retries or double-clicks.</span></li>
              <li className="flex gap-2"><span className="text-emerald-600">✓</span><span>Nightly reconciliation catches missed payment webhooks and re-syncs your books.</span></li>
              <li className="flex gap-2"><span className="text-emerald-600">✓</span><span>One-click disconnect, anytime. Revoke from QuickBooks side too for defense in depth.</span></li>
              <li className="flex gap-2"><span className="text-emerald-600">✓</span><span>Customer card and bank info stays inside QuickBooks Payments — we never see it.</span></li>
            </ul>
            <div className="pt-1 flex flex-wrap gap-x-4 gap-y-1">
              <a href="/qb-setup" target="_blank" rel="noopener" className="text-teal-600 hover:underline font-semibold">QB setup checklist →</a>
              <a href="/security" className="text-teal-600 hover:underline font-semibold">Full security details →</a>
            </div>
          </div>

          <button
            onClick={handleConnectQB}
            disabled={qbConnecting}
            className="flex items-center gap-2 bg-[#2CA01C] hover:bg-[#248A18] disabled:bg-slate-300 text-white font-semibold px-4 py-2.5 rounded-xl transition text-sm"
          >
            <img
              src="https://developer.intuit.com/content/dam/developer/global/en_US/site-redesign/images/quickbooks-online-logo-white.svg"
              alt=""
              className="h-4"
              onError={(e) => e.currentTarget.style.display = "none"}
            />
            {qbConnecting ? "Redirecting to QuickBooks…" : (qbNeedsReconnect ? "Reconnect to QuickBooks" : "Connect to QuickBooks")}
          </button>
          <p className="text-xs text-slate-500">
            You'll be redirected to Intuit to authorize InkTracker. QuickBooks Payments account required for payment links.
          </p>
        </div>
      )}
    </>
  );
}

// Map InkTracker garment categories → the shop's real QuickBooks items, so
// invoices land on the shop's existing items instead of creating duplicates
// (e.g. InkTracker's "Hoodies & Sweatshirts" vs the shop's "Sweatshirts").
// Saves to pricing_config.qb_item_map; buildQBInvoicePayload applies it. Only
// affects FUTURE invoices — existing duplicate items must be merged in QB.
function QbItemMapEditor({ user }) {
  const [open, setOpen] = useState(false);
  const [qbItems, setQbItems] = useState(null); // null = not loaded yet
  const [map, setMap] = useState({});
  const [split, setSplit] = useState(false);
  const [techniques, setTechniques] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  async function openEditor() {
    setOpen(true);
    if (qbItems !== null) return; // already loaded once
    setLoading(true);
    setError(null);
    try {
      const shops = await base44.entities.Shop.filter({ owner_email: shopScope(user) });
      const pc = shops?.[0]?.pricing_config || {};
      setMap(pc.qb_item_map || {});
      setSplit(!!pc.qb_split_lines);
      setTechniques(getEnabledTechniques(pc) || []);
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error: invErr } = await base44.functions.invoke("qbSync", {
        action: "listQbItems",
        accessToken: session?.access_token,
      });
      if (invErr) throw new Error(invErr.message || "Couldn't load QuickBooks items");
      if (data?.error) throw new Error(data.error);
      setQbItems(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setError(err.message);
      setQbItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const shops = await base44.entities.Shop.filter({ owner_email: shopScope(user) });
      // Drop empty selections so an unset row falls back to default behavior.
      const cleanMap = Object.fromEntries(
        Object.entries(map).filter(([, v]) => v && String(v).trim()),
      );
      const pc = { ...(shops?.[0]?.pricing_config || {}), qb_item_map: cleanMap, qb_split_lines: split };
      if (shops?.[0]) await base44.entities.Shop.update(shops[0].id, { pricing_config: pc });
      loadShopPricingConfig(pc);
      setMap(cleanMap);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const renderRow = (key, label) => (
    <div key={key} className="flex items-center gap-2">
      <div className="w-40 text-sm text-slate-700 shrink-0">{label}</div>
      <span className="text-slate-300">→</span>
      <select
        value={map[key] || ""}
        onChange={(e) => setMap((m) => ({ ...m, [key]: e.target.value }))}
        className="flex-1 text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-300"
      >
        <option value="">Default (InkTracker creates/uses &quot;{key}&quot;)</option>
        {qbItems.map((it) => (
          <option key={it.id} value={it.name}>{it.name}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="border-t border-emerald-200 pt-3 mt-3">
      {!open ? (
        <button
          onClick={openEditor}
          className="flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-900 transition"
        >
          <Link2 className="w-4 h-4" />
          Map sales to your QuickBooks items
        </button>
      ) : (
        <div>
          <div className="text-sm font-semibold text-slate-700 mb-1">Map sales to QuickBooks items</div>
          <p className="text-xs text-slate-500 mb-3">
            Point each InkTracker line at the QuickBooks product/service you want it booked under, so sales don&apos;t spread across duplicate items. Leave a row on &quot;Default&quot; to keep current behavior. Affects future invoices only.
          </p>
          {loading && <div className="text-sm text-slate-500">Loading your QuickBooks items…</div>}
          {error && (
            <div className="mb-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}
          {!loading && qbItems !== null && (
            <>
              {/* Opt-in per-technique split */}
              <label className="flex items-start gap-2 mb-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={split}
                  onChange={(e) => setSplit(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-xs text-slate-600">
                  <span className="font-semibold text-slate-700">Split invoice lines by garment + decoration</span>
                  <br />
                  Posts the garment portion and each decoration technique (screen print, embroidery…) as separate QuickBooks lines so you can report revenue by technique. The customer total is unchanged.
                </span>
              </label>

              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">Garment types</div>
              <div className="space-y-1.5">{GARMENT_CATEGORIES.map((cat) => renderRow(cat, cat))}</div>

              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mt-3 mb-1">Fees</div>
              <div className="space-y-1.5">{renderRow("Setup Fee", "Setup Fee")}</div>

              {split && (
                <>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mt-3 mb-1">Decoration techniques</div>
                  <div className="space-y-1.5">{techniques.map((t) => renderRow(t, t))}</div>
                </>
              )}

              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={save}
                  disabled={saving}
                  className="text-sm font-bold text-white bg-emerald-600 px-4 py-2 rounded-xl hover:bg-emerald-700 transition disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save mapping"}
                </button>
                <button onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:text-slate-700">Close</button>
                {saved && <span className="text-sm text-emerald-700 font-semibold">Saved ✓</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
