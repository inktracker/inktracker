import { fmtMoney, getDisplayName } from "@/components/shared/pricing";
import Icon from "@/components/shared/Icon";
import { normalizeShipTo, parseUsAddress } from "@/lib/tax/address";
import { exemptionStatus } from "@/lib/tax/exemption";

// The responsive grid of customer cards. Pure move of the JSX out of
// Customers.jsx — parent owns the filtered list, stats, artwork map, and
// the setters wired to the Edit button.
export default function CustomerCardGrid({
  filtered,
  invoiceStats,
  artworkByCustomer,
  navigate,
  setEditing,
  setConfirmDelete,
  setArtworkNote,
  setArtworkColorCount,
}) {
  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      {filtered.map((c) => {
        const custStats = invoiceStats[c.id] || null;
        const orderCount = custStats?.count || 0;
        const spent = custStats?.collected || 0;

        const artCount = (artworkByCustomer[c.id] || []).length;

        return (
          <div
            key={c.id}
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm p-5 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-teal-100 to-teal-200 text-teal-700 font-bold text-sm flex items-center justify-center flex-shrink-0">
                {(c.company || c.name || "").split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("")}
              </div>
              <div>
                <div className="font-bold text-slate-800 dark:text-slate-200 text-sm">{getDisplayName(c)}</div>
                {c.company && c.name && <div className="text-xs text-slate-500">{c.name}</div>}
              </div>
            </div>

            <div className="text-xs text-slate-500 space-y-1.5 mb-4">
              {c.email && (
                <div className="flex items-center gap-2">
                  <Icon name="mail" className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                  {c.email}
                </div>
              )}
              {c.phone && (
                <div className="flex items-center gap-2">
                  <Icon name="phone" className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                  {c.phone}
                </div>
              )}
              {c.address && (
                <div className="flex items-center gap-2">
                  <Icon
                    name="location"
                    className="w-3.5 h-3.5 text-slate-500 flex-shrink-0"
                  />
                  {c.address}
                </div>
              )}
            </div>

            {c.notes && (
              <div className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5 border border-amber-100 mb-3">
                {c.notes}
              </div>
            )}

            <div className="mb-3 text-xs text-slate-500 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2">
              Artwork files: <span className="font-bold text-slate-700">{artCount}</span>
            </div>

            <div className="flex gap-3 border-t border-slate-100 dark:border-slate-700 pt-3 items-center">
              <div className={`text-center flex-1 ${orderCount > 0 ? "cursor-pointer hover:bg-teal-50 dark:hover:bg-slate-800 rounded-lg py-1 transition" : ""}`}
                onClick={() => {
                  if (orderCount > 0) navigate(`/Invoices?customer=${encodeURIComponent(c.company || c.name)}`);
                }}>
                <div className={`text-lg font-bold ${orderCount > 0 ? "text-teal-600" : "text-slate-800 dark:text-slate-200"}`}>{orderCount}</div>
                <div className="text-xs text-slate-500">invoices</div>
              </div>

              <div className="text-center flex-1">
                <div className="text-lg font-bold text-emerald-600">{fmtMoney(spent)}</div>
                <div className="text-xs text-slate-500">collected</div>
              </div>

              {c.tax_exempt && (() => {
                const status = exemptionStatus(c);
                const style = status === "expired"
                  ? "text-rose-600 bg-rose-50 border-rose-100"
                  : status === "expiring"
                    ? "text-amber-600 bg-amber-50 border-amber-100"
                    : "text-teal-600 bg-teal-50 border-teal-100";
                const label = status === "expired"
                  ? "Exempt — cert expired"
                  : status === "expiring"
                    ? "Exempt — cert expiring"
                    : "Tax Exempt";
                return (
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${style}`}>
                    {label}
                  </span>
                );
              })()}

              <button
                onClick={() => {
                  // Seed structured Billing from the legacy free-text `address`
                  // for customers created before billing went structured, so
                  // their existing address shows in the new fields.
                  const seededBilling = c.bill_to_address
                    || (c.address ? (parseUsAddress(c.address) || normalizeShipTo({ street: c.address })) : null);
                  setEditing({ ...c, bill_to_address: seededBilling });
                  setConfirmDelete(false);
                  setArtworkNote("");
                  setArtworkColorCount("");
                }}
                className="text-xs text-slate-500 hover:text-slate-600 border border-slate-200 dark:border-slate-700 hover:border-slate-300 px-2.5 py-1 rounded-lg transition"
              >
                Edit
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
