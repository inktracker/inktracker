// Per-broker billing timing. The shop's master switch
// (pricing_config.brokerBillingEnabled) decides IF brokers are auto-billed; this
// decides WHEN for a given broker: up front (at order creation) or at completion.
//
// Two triggers fire billBrokerForOrder, and both are safe together because
// billBrokerForOrder is idempotent (it skips an order that already carries a
// qb_broker_invoice_id):
//   - order creation  → bill now ONLY for up-front brokers
//   - order completion → bills (existing gate) if not already billed. This
//     doubles as the safety net: an up-front bill that failed (fail-open) is
//     picked up here, and on-completion brokers bill here as before.

// The per-broker setting lives on the broker_pricing row (bill_up_front column).
export function isBrokerBillUpFront(brokerPricingRow) {
  return brokerPricingRow?.bill_up_front === true;
}

/**
 * Should the order-CREATION trigger bill this broker now?
 * Up-front billing requires all three: it's a broker order, the shop's master
 * broker-billing switch is on, and this broker is set to bill up front.
 *
 * @param {object} args
 * @param {boolean} args.isBrokerOrder  the order carries a broker_id
 * @param {boolean} args.masterEnabled  pricing_config.brokerBillingEnabled
 * @param {boolean} args.billUpFront    this broker's bill_up_front setting
 * @returns {boolean}
 */
export function decideUpFrontBill({ isBrokerOrder, masterEnabled, billUpFront }) {
  return Boolean(isBrokerOrder) && Boolean(masterEnabled) && Boolean(billUpFront);
}
