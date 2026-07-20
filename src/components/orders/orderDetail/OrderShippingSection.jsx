import { Truck, CheckCircle2, ExternalLink, Download, Loader2 } from "lucide-react";
import ReactivateLink from "../../shared/ReactivateLink";

// Shipping section for the Order Detail modal: collapsible FedEx panel
// with ship-to address, package dims, rate lookup, label creation, and
// tracking. All state + FedEx handlers stay owned by the parent and are
// threaded in. Pure decomposition — moved verbatim from OrderDetailModal.jsx.
export default function OrderShippingSection({
  showShipping,
  setShowShipping,
  shipError,
  shipTracking,
  shipStatus,
  shipLabelUrl,
  shipStreet,
  setShipStreet,
  shipCity,
  setShipCity,
  shipState,
  setShipState,
  shipZip,
  setShipZip,
  shipCountry,
  setShipCountry,
  shipWeight,
  setShipWeight,
  shipLength,
  setShipLength,
  shipWidth,
  setShipWidth,
  shipHeight,
  setShipHeight,
  shipService,
  setShipService,
  shipRates,
  loadingRates,
  creatingLabel,
  savingShipping,
  shippingSaved,
  handleGetRates,
  handleSaveShipping,
  handleCreateLabel,
  handleTrackShipment,
  // Read-only (lapsed subscription): disable shipping writes (rate lookup,
  // save address, create label, refresh tracking). Address/dims inputs +
  // existing tracking display stay readable.
  readOnly = false,
  reactivateHref,
}) {
  const roTitle = "Your subscription has ended — reactivate to make changes.";
  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      <button onClick={() => setShowShipping(!showShipping)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition text-left">
        <div className="flex items-center gap-2">
          <Truck className="w-4 h-4 text-slate-500" />
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Shipping</span>
        </div>
        <div className="flex items-center gap-3">
          {shipTracking && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-blue-700 bg-blue-50">{shipTracking}</span>
          )}
          <span className="text-xs text-slate-500">{showShipping ? "▲" : "▼"}</span>
        </div>
      </button>
      {showShipping && (
        <div className="p-4 space-y-4">
          {shipError && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{shipError}</div>
          )}

          {/* Already shipped — show tracking info */}
          {shipTracking ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-800">Shipment Created</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Tracking: <span className="font-mono font-semibold text-slate-700">{shipTracking}</span>
                  </div>
                  {shipStatus && <div className="text-xs text-slate-500 mt-0.5">Status: {shipStatus}</div>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <a
                    href={`https://www.fedex.com/fedextrack/?trknbr=${shipTracking}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                  >
                    Track <ExternalLink className="w-3 h-3" />
                  </a>
                  {shipLabelUrl && (
                    <a href={shipLabelUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs font-semibold text-teal-600 hover:text-teal-700 flex items-center gap-1">
                      Label <Download className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleTrackShipment}
                  disabled={readOnly}
                  title={readOnly ? roTitle : undefined}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-700 transition disabled:opacity-50 disabled:cursor-not-allowed">
                  Refresh tracking status
                </button>
                <ReactivateLink show={readOnly} href={reactivateHref} />
              </div>
            </div>
          ) : (
            <>
              {/* Ship-to Address */}
              <div>
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">Ship To</div>
                <div className="space-y-2">
                  <input type="text" placeholder="Street address" value={shipStreet} onChange={e => setShipStreet(e.target.value)}
                    className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <input type="text" placeholder="City" value={shipCity} onChange={e => setShipCity(e.target.value)}
                      className="text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                    <input type="text" placeholder="State" value={shipState} onChange={e => setShipState(e.target.value)} maxLength={2}
                      className="text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-300 uppercase" />
                    <input type="text" placeholder="ZIP" value={shipZip} onChange={e => setShipZip(e.target.value)}
                      className="text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                    <select value={shipCountry} onChange={e => setShipCountry(e.target.value)}
                      className="text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-300">
                      <option value="US">US</option>
                      <option value="CA">CA</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Package Dimensions */}
              <div>
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">Package</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500">Weight (lbs)</label>
                    <input type="number" min="0" step="0.1" value={shipWeight} onChange={e => setShipWeight(e.target.value)}
                      className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-300 mt-0.5" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500">Length (in)</label>
                    <input type="number" min="0" step="1" value={shipLength} onChange={e => setShipLength(e.target.value)}
                      className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-300 mt-0.5" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500">Width (in)</label>
                    <input type="number" min="0" step="1" value={shipWidth} onChange={e => setShipWidth(e.target.value)}
                      className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-300 mt-0.5" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500">Height (in)</label>
                    <input type="number" min="0" step="1" value={shipHeight} onChange={e => setShipHeight(e.target.value)}
                      className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-300 mt-0.5" />
                  </div>
                </div>
              </div>

              {/* Get Rates */}
              <div className="flex items-center gap-3">
                <button onClick={handleGetRates} disabled={readOnly || loadingRates || !shipStreet || !shipCity || !shipState || !shipZip || !shipWeight}
                  title={readOnly ? roTitle : undefined}
                  className="text-xs font-bold text-white bg-slate-700 hover:bg-slate-800 px-4 py-2 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed">
                  {loadingRates ? <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Getting rates...</span> : "Get Rates"}
                </button>
                <button onClick={handleSaveShipping} disabled={savingShipping || readOnly}
                  title={readOnly ? roTitle : undefined}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-700 transition disabled:opacity-50 disabled:cursor-not-allowed">
                  {savingShipping ? "Saving..." : shippingSaved ? "Saved" : "Save address"}
                </button>
                <ReactivateLink show={readOnly} href={reactivateHref} />
              </div>

              {/* Rate Results */}
              {shipRates.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">Select Service</div>
                  <div className="space-y-1.5">
                    {shipRates.map(r => (
                      <button key={r.serviceType} onClick={() => setShipService(r.serviceType)}
                        className={`w-full text-left flex items-center justify-between px-3 py-2.5 rounded-lg border transition text-sm ${
                          shipService === r.serviceType
                            ? "border-teal-400 bg-teal-50 text-teal-700"
                            : "border-slate-200 hover:border-slate-300 text-slate-700"
                        }`}>
                        <div>
                          <span className="font-semibold">{r.serviceName}</span>
                          {r.transitDays && <span className="text-xs text-slate-500 ml-2">{r.transitDays}</span>}
                        </div>
                        <span className="font-bold">${(Number(r.totalCharge) || 0).toFixed(2)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Create Label */}
              {shipService && (
                <button onClick={handleCreateLabel} disabled={creatingLabel || readOnly}
                  title={readOnly ? roTitle : undefined}
                  className="text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 px-5 py-2.5 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto">
                  {creatingLabel
                    ? <span className="flex items-center justify-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin" /> Creating label...</span>
                    : "Create Shipping Label"}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
