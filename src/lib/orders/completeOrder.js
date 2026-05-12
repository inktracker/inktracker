// Order completion: pure logic, no I/O.
//
// Builds the side-effect plan for marking an order Completed and
// generating its invoice + performance log entries. The pure helper
// makes the contract unit-testable, especially the invariant that
// completion NEVER deletes the order — the bug Joe hit on
// 2026-05-12 where Production.jsx's handleComplete called
// Order.delete() and orphaned every invoice.
//
// Consumers (Production.jsx, Orders.jsx) apply the returned plan
// using their respective entity-wrapper calls. The DB trigger
// added in 20260516_preserve_completed_orders.sql is the second
// layer of defense: even if a future caller skips this helper and
// calls Order.delete() directly, the trigger refuses.

const COMPLETED_STATUS = "Completed";

/**
 * Build the side-effect plan to mark an order Completed.
 *
 * Returns an object whose keys describe each side effect. There is
 * deliberately NO `delete` key — see the test in __tests__ that
 * asserts this invariant.
 *
 * @param {object} order        the order row being completed
 * @param {object} args
 * @param {string} args.today   ISO date string (YYYY-MM-DD)
 * @param {string} args.shopOwner  the authenticated user's email
 * @param {string} [args.invoiceId]  override id for tests; otherwise generated
 *
 * @returns {{
 *   orderUpdate: { id, patch: { status, completed_date } },
 *   invoiceCreate: object,
 *   brokerPerformanceCreate: object | null,
 *   shopPerformanceCreate: object,
 * }}
 */
export function buildOrderCompletionPlan(order, { today, shopOwner, invoiceId } = {}) {
  if (!order || typeof order !== "object") {
    throw new Error("buildOrderCompletionPlan: order required");
  }
  if (!order.id) {
    throw new Error("buildOrderCompletionPlan: order.id required");
  }
  if (!order.order_id) {
    throw new Error("buildOrderCompletionPlan: order.order_id required");
  }
  if (!today) {
    throw new Error("buildOrderCompletionPlan: today required (YYYY-MM-DD)");
  }
  if (!shopOwner) {
    throw new Error("buildOrderCompletionPlan: shopOwner required");
  }

  const inv_id =
    invoiceId ??
    `INV-${new Date(today).getUTCFullYear() || new Date().getFullYear()}-${Date.now()
      .toString(36)
      .toUpperCase()
      .slice(-5)}`;

  // Due date: 30 days from `today`.
  const dueMs = new Date(today).getTime() + 30 * 24 * 60 * 60 * 1000;
  const due = Number.isFinite(dueMs)
    ? new Date(dueMs).toISOString().split("T")[0]
    : null;

  const invoiceCreate = {
    invoice_id: inv_id,
    shop_owner: shopOwner,
    order_id: order.order_id,
    customer_id: order.customer_id,
    customer_name: order.customer_name,
    date: today,
    due,
    subtotal: order.subtotal || 0,
    tax: order.tax || 0,
    total: order.total || 0,
    paid: false,
    status: "Sent",
    line_items: order.line_items || [],
    notes: order.notes || "",
    rush_rate: order.rush_rate || 0,
    extras: order.extras || {},
    discount: order.discount || 0,
    tax_rate: order.tax_rate || 0,
  };

  const brokerPerformanceCreate = order.broker_id
    ? {
        broker_id: order.broker_id,
        shop_owner: shopOwner,
        order_id: order.order_id,
        customer_name: order.customer_name,
        date: today,
        total: order.total || 0,
      }
    : null;

  const shopPerformanceCreate = {
    shop_owner: shopOwner,
    order_id: order.order_id,
    customer_name: order.customer_name,
    customer_id: order.customer_id || "",
    broker_id: order.broker_id || "",
    date: today,
    total: order.total || 0,
    status: COMPLETED_STATUS,
  };

  return {
    orderUpdate: {
      id: order.id,
      patch: { status: COMPLETED_STATUS, completed_date: today },
    },
    invoiceCreate,
    brokerPerformanceCreate,
    shopPerformanceCreate,
    // No `orderDelete`, no `delete` of any kind. The contract is:
    // completion is a transition, not a destruction. Enforced by
    // the test suite below AND by the DB trigger
    // refuse_completed_order_delete in 20260516_preserve_completed_orders.sql.
  };
}

// Public so tests can refer to the exact string.
export const COMPLETED_ORDER_STATUS = COMPLETED_STATUS;
