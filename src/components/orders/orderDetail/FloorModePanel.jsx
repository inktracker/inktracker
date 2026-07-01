import { Hammer, CheckCircle2, ChevronDown } from "lucide-react";
import {
  countGoodsProgress,
  autoCheckOrderGoodsTask,
} from "@/lib/orderGoodsProgress";
import { sortSizeEntries } from "../../shared/pricing";
import { getStageTasks } from "@/lib/productionTasks";

// Floor Mode Panel — stage-aware per-size tracking.
//   Order Goods: ordered/received cycle (goods_progress).
//   Printing:    per-imprint print tracking (print_progress).
//   Other stages: read-only quantity (no leaked dots).
// The teal bar IS the collapsible header (clickable); panel body only
// renders when expanded. Per-order localStorage collapsed state is owned
// by the parent and threaded in. Pure decomposition — moved verbatim from
// OrderDetailModal.jsx.
export default function FloorModePanel({
  liveOrder,
  floorCollapsed,
  setFloorCollapsed,
  floorToggleTask,
  floorTogglePrint,
  floorToggleGoods,
  bulkOrderGoodsStep,
  saveShortfall,
}) {
  const step = liveOrder.status || "Pre-Press";
  const tasks = getStageTasks(step);
  const checklist = liveOrder.checklist || {};
  const stepChecks = checklist[step] || {};
  const printProgress = checklist.print_progress || {};
  const goodsProgress = checklist.goods_progress || {};

  const { total: goodsTotal, ordered: goodsOrdered, received: goodsReceived } = countGoodsProgress(liveOrder);

  return (
    <div className="border-2 border-teal-400 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setFloorCollapsed(c => !c)}
        aria-expanded={!floorCollapsed}
        className="w-full px-4 py-3 bg-teal-600 text-white flex items-center justify-between hover:bg-teal-700 transition text-left"
      >
        <div className="flex items-center gap-2">
          <Hammer className="w-4 h-4" />
          <span className="text-sm font-bold">Floor Mode — {step}</span>
        </div>
        <div className="flex items-center gap-3">
          {step === "Order Goods" && goodsTotal > 0 && (
            <span className="text-xs font-semibold text-teal-100">
              <span className="text-white">{goodsReceived}</span> received
              {goodsOrdered > 0 && <> · <span className="text-white">{goodsOrdered}</span> ordered</>}
              {" · "}{goodsTotal} total
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-teal-100 transition-transform duration-200 ${floorCollapsed ? "-rotate-90" : "rotate-0"}`}
            aria-hidden="true"
          />
        </div>
      </button>
      {!floorCollapsed && (
      <div className="p-4 space-y-4">
        {/* Checklist — Order Goods has two auto-derived
            tasks (Place blank order / Receive goods) so
            operators don't double-confirm what the
            per-size buttons already capture. */}
        {tasks.length > 0 && (() => {
          const counts = { total: goodsTotal, ordered: goodsOrdered, received: goodsReceived, marked: goodsOrdered + goodsReceived };
          const autoDone = (task) => autoCheckOrderGoodsTask(step, task, counts);
          const isDone = (task) => {
            const a = autoDone(task);
            return a === null ? !!stepChecks[task] : a;
          };
          const doneCount = tasks.filter(isDone).length;
          return (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Checklist</span>
                <span className="text-xs font-bold text-teal-600">{doneCount}/{tasks.length}</span>
              </div>
              <div className="space-y-1">
                {tasks.map(task => {
                  const auto = autoDone(task);
                  const done = isDone(task);
                  // Auto-derived tasks (Place blank order / Receive
                  // goods) get a bulk-action click handler — sets
                  // every size to the corresponding status. Lets
                  // shops whose blanks don't come through the AS
                  // Colour PO integration check these off without
                  // tapping each size individually.
                  const bulkTarget =
                    task === "Place blank order" ? "ordered" :
                    task === "Receive goods"     ? "received" :
                    null;
                  const handleClick = bulkTarget
                    ? () => bulkOrderGoodsStep(bulkTarget)
                    : () => floorToggleTask(task);
                  return (
                    <button key={task}
                      onClick={handleClick}
                      title={bulkTarget
                        ? `Marks every size as ${bulkTarget}. Or tap individual sizes below for partial.`
                        : undefined}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition ${done ? "bg-emerald-50 border border-emerald-200" : "bg-slate-50 hover:bg-slate-100 border border-transparent"}`}>
                      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${done ? "bg-emerald-500 border-emerald-500" : "border-slate-300"}`}>
                        {done && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                      </div>
                      <span className={`text-sm ${done ? "text-emerald-700 line-through" : "text-slate-700"}`}>{task}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Per-line-item per-size tracking */}
        {(liveOrder.line_items || []).map((li, liIdx) => {
          const imprints = (li.imprints || []).filter(imp => (imp.colors || 0) > 0);
          // For non-Printing stages we still show the line item
          // (so Order Goods sees the garment list); only Printing
          // requires imprints to render.
          if (step === "Printing" && imprints.length === 0) return null;
          return (
            <div key={liIdx}>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                {li.brand ? `${li.brand} ` : ""}{li.style || "Item"}{li.garmentColor ? ` — ${li.garmentColor}` : ""}
              </div>
              {/* What's being printed on THIS garment — one row per
                  imprint so the operator sees the design, where it
                  goes, its ink colors, and size. Answers "which
                  design goes on which shirt" for multi-design jobs. */}
              {imprints.length > 0 && (
                <div className="mb-2 space-y-1">
                  {imprints.map((imp, ii) => {
                    const dim = imp.width && imp.height
                      ? `${imp.width}" × ${imp.height}"`
                      : imp.width ? `${imp.width}" wide`
                      : imp.height ? `${imp.height}" tall` : "";
                    const nColors = Number(imp.colors) || 0;
                    return (
                      <div key={ii} className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-slate-600 bg-slate-50 rounded-lg px-2.5 py-1.5">
                        {imp.title && <span className="font-bold text-slate-800">{imp.title}</span>}
                        <span className="font-semibold text-teal-700">{imp.location || "Print"}</span>
                        <span className="text-slate-300">·</span>
                        <span>{nColors} color{nColors === 1 ? "" : "s"}</span>
                        {imp.technique && (<><span className="text-slate-300">·</span><span>{imp.technique}</span></>)}
                        {imp.pantones && (<><span className="text-slate-300">·</span><span className="text-slate-500">{imp.pantones}</span></>)}
                        {dim && (<><span className="text-slate-300">·</span><span className="text-slate-500">{dim}</span></>)}
                        {imp.details && (<><span className="text-slate-300">·</span><span className="text-slate-500 italic">{imp.details}</span></>)}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {sortSizeEntries(Object.entries(li.sizes || {})).filter(([, v]) => parseInt(v) > 0).map(([size, count]) => {
                  // ── Order Goods: blank → ordered → received → blank ──
                  // All three states are tap-able now (cycle), so
                  // an accidental tap is always recoverable.
                  if (step === "Order Goods") {
                    const status = goodsProgress[`${liIdx}-${size}`]?.status;
                    const label =
                      status === "received" ? "Received"
                      : status === "ordered" ? "Ordered"
                      : null;
                    const tooltip =
                      status === "received" ? "Tap to clear back to blank"
                      : status === "ordered" ? "Tap to mark received"
                      : "Tap to mark ordered";
                    return (
                      <button key={size}
                        onClick={() => floorToggleGoods(liIdx, size)}
                        title={tooltip}
                        className={`text-sm rounded-xl px-3 py-2 font-bold border-2 transition flex flex-col items-center min-w-[64px] ${
                          status === "received"
                            ? "bg-emerald-100 border-emerald-400 text-emerald-700 hover:bg-emerald-50"
                            : status === "ordered"
                              ? "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100"
                              : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
                        }`}>
                        <span>{size}: {count}</span>
                        {label && (
                          <span className={`text-[10px] font-semibold uppercase tracking-wide mt-0.5 ${
                            status === "received" ? "text-emerald-600" : "text-amber-600"
                          }`}>
                            {label}
                          </span>
                        )}
                      </button>
                    );
                  }

                  // ── Printing: per-imprint progress ──
                  if (step === "Printing") {
                    const donePrints = imprints.filter((_, ii) => !!printProgress[`${liIdx}-${size}-${ii}`]).length;
                    const allDone = imprints.length > 0 && donePrints === imprints.length;
                    const partial = donePrints > 0 && !allDone;
                    return (
                      <div key={size} className="flex flex-col items-center">
                        <button onClick={() => {
                          if (allDone) {
                            imprints.forEach((_, ii) => floorTogglePrint(liIdx, size, ii));
                          } else {
                            const next = imprints.findIndex((_, ii) => !printProgress[`${liIdx}-${size}-${ii}`]);
                            if (next !== -1) floorTogglePrint(liIdx, size, next);
                          }
                        }}
                          className={`text-sm rounded-xl px-3 py-2 font-bold border-2 transition ${allDone ? "bg-emerald-100 border-emerald-400 text-emerald-700" : partial ? "bg-amber-50 border-amber-300 text-amber-700" : "bg-white border-slate-200 text-slate-700 hover:border-teal-300"}`}>
                          {size}: {count}{allDone && " ✓"}
                        </button>
                        {imprints.length > 1 && (
                          <div className="flex gap-0.5 mt-1">
                            {imprints.map((imp, ii) => (
                              <button key={ii} onClick={() => floorTogglePrint(liIdx, size, ii)}
                                title={imp.location}
                                className={`w-2.5 h-2.5 rounded-full transition ${printProgress[`${liIdx}-${size}-${ii}`] ? "bg-emerald-400" : "bg-slate-300 hover:bg-slate-400"}`} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }

                  // ── Other stages: read-only quantity ──
                  return (
                    <span key={size}
                      className="text-sm rounded-xl px-3 py-2 font-bold border-2 bg-white border-slate-200 text-slate-700">
                      {size}: {count}
                    </span>
                  );
                })}
              </div>

              {/* Misprints (shortfall) entry — only relevant
                  during Printing, only fires for sizes that
                  have a positive qty. Capped at the original
                  qty per size so an operator can't log more
                  misprints than were printed. Stored on the
                  line item under _shortfall so the pricing
                  table's "Completed" line picks it up. */}
              {step === "Printing" && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-amber-700 mr-1">Misprints</span>
                  {sortSizeEntries(Object.entries(li.sizes || {}))
                    .filter(([, v]) => parseInt(v) > 0)
                    .map(([size]) => (
                      <label key={size} className="inline-flex items-center gap-1.5">
                        <span className="text-xs text-slate-500 font-semibold">{size}</span>
                        <input
                          type="number"
                          min="0"
                          max={(li.sizes || {})[size] || 0}
                          defaultValue={(li._shortfall || {})[size] || 0}
                          onBlur={(e) => {
                            const v = e.target.value;
                            const cur = (li._shortfall || {})[size] || 0;
                            if (String(cur) !== String(v)) {
                              saveShortfall(li.id, size, v);
                            }
                          }}
                          className="w-12 text-center text-xs font-semibold text-amber-800 bg-white border border-amber-200 rounded px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-amber-400"
                          title={`Misprints for ${size}`}
                        />
                      </label>
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
