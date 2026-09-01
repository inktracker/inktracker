// Keep-vs-send economics for a partner handoff. Pure — tested in
// __tests__/partnerHandoffMath.test.js.
//
// The nuance that matters: on a decoration-only trade (the default) the
// SENDER still buys the blanks, so the send margin is
//   revenue − blanks − trade price.
// When the receiver supplies garments, blanks drop out of the send side:
//   revenue − trade price.
// Keeping in house is always revenue − blanks, BEFORE the sender's own
// labor/ink — we label it gross, not profit, so the comparison is honest.

export function lineQty(li) {
  const fromSizes = Object.values(li?.sizes || {}).reduce((s, v) => s + (parseInt(v) || 0), 0);
  if (fromSizes > 0) return fromSizes;
  return parseInt(li?.quantity) || 0;
}

export function lineRevenue(li) {
  const direct = Number(li?._lineTotal ?? li?.lineTotal);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const ppp = Number(li?.clientPpp ?? li?._ppp);
  if (Number.isFinite(ppp) && ppp > 0) return ppp * lineQty(li);
  return 0;
}

export function lineBlanksCost(li) {
  const cost = Number(li?.garmentCost);
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  return cost * lineQty(li);
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @returns {{revenue, blanks, keepGross, sendMargin, delta, valid}}
 *   delta = sendMargin − keepGross (negative: sending gives up that much
 *   gross in exchange for freeing your press).
 */
export function computeHandoffComparison(lines, tradePrice, { receiverSuppliesGarments = false } = {}) {
  const arr = Array.isArray(lines) ? lines : [];
  const trade = Number(tradePrice);
  const revenue = round2(arr.reduce((s, li) => s + lineRevenue(li), 0));
  const blanks = round2(arr.reduce((s, li) => s + lineBlanksCost(li), 0));
  const keepGross = round2(revenue - blanks);
  if (!Number.isFinite(trade) || trade <= 0 || revenue <= 0) {
    return { revenue, blanks, keepGross, sendMargin: null, delta: null, valid: false };
  }
  const sendMargin = round2(receiverSuppliesGarments ? revenue - trade : revenue - blanks - trade);
  return { revenue, blanks, keepGross, sendMargin, delta: round2(sendMargin - keepGross), valid: true };
}
