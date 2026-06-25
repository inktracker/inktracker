import { describe, it, expect, vi } from "vitest";
import { convertQuoteToOrder } from "../qbConvertQuote.js";

/**
 * Mock that simulates the quotes/orders tables with the
 * `converted_order_id IS NULL` claim-or-noop semantics.
 */
function makeSupabase(initialQuote) {
  const state = {
    quote: { ...initialQuote },
    orders: [],
    notifications: [],
  };
  const sb = {
    state,
    from(table) {
      if (table === "quotes") return quotesTable(state);
      if (table === "orders") return ordersTable(state);
      if (table === "notifications") return notificationsTable(state);
      throw new Error(`unexpected table: ${table}`);
    },
  };
  return sb;
}

function quotesTable(state) {
  return {
    update(patch) {
      let claimGate = false;
      const filters = { id: null, shop_owner: null };
      const chain = {
        eq(col, val) { filters[col] = val; return chain; },
        is(col, val) {
          // Mirror the .is("converted_order_id", null) atomic guard
          if (col === "converted_order_id" && val === null) claimGate = true;
          return chain;
        },
        select() {
          // Apply update only if filters match AND claim gate satisfied
          const q = state.quote;
          const matches =
            q.id === filters.id &&
            q.shop_owner === filters.shop_owner &&
            (!claimGate || q.converted_order_id == null);
          if (matches) {
            state.quote = { ...q, ...patch };
            return Promise.resolve({ data: [{ converted_order_id: state.quote.converted_order_id }], error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
      };
      return chain;
    },
    select() {
      const filters = { id: null, shop_owner: null };
      const chain = {
        eq(col, val) { filters[col] = val; return chain; },
        maybeSingle: vi.fn(() => Promise.resolve({
          data: (state.quote.id === filters.id && state.quote.shop_owner === filters.shop_owner)
            ? state.quote : null,
          error: null,
        })),
      };
      return chain;
    },
  };
}

function ordersTable(state) {
  return {
    insert(row) {
      state.orders.push(row);
      return Promise.resolve({ error: null });
    },
  };
}

function notificationsTable(state) {
  return {
    insert(row) {
      state.notifications.push(row);
      return Promise.resolve({ error: null });
    },
  };
}

const baseQuote = {
  id: "q-1",
  shop_owner: "shop@x.com",
  quote_id: "Q-1",
  customer_id: "c1",
  customer_name: "Cust",
  job_title: "Tee print",
  date: "2026-05-30",
  line_items: [],
  selected_artwork: [],
  rush_rate: 0, extras: 0, discount: 0, discount_type: "percent", tax_rate: 0,
  subtotal: 100, tax: 0, total: 100,
  converted_order_id: null,
};

describe("convertQuoteToOrder — claim-then-insert (CQO)", () => {
  it("CQO1 — unclaimed quote: claims it AND inserts one orders row", async () => {
    const sb = makeSupabase(baseQuote);
    const orderId = await convertQuoteToOrder(sb, baseQuote);

    expect(orderId).toBeTruthy();
    expect(sb.state.orders.length).toBe(1);
    expect(sb.state.orders[0].order_id).toBe(orderId);
    expect(sb.state.quote.status).toBe("Converted to Order");
    expect(sb.state.quote.converted_order_id).toBe(orderId);
    // Emits exactly one bell notification, linked to the new order.
    expect(sb.state.notifications.length).toBe(1);
    expect(sb.state.notifications[0]).toMatchObject({
      shop_owner: "shop@x.com",
      event_type: "quote_converted",
      related_entity: "order",
      related_id: orderId,
    });
  });

  it("CQO2 — already-converted quote: returns existing order_id, inserts NO new orders row", async () => {
    const sb = makeSupabase({ ...baseQuote, converted_order_id: "EXISTING-99" });
    const orderId = await convertQuoteToOrder(sb, sb.state.quote);

    expect(orderId).toBe("EXISTING-99");
    expect(sb.state.orders.length).toBe(0);
    expect(sb.state.quote.converted_order_id).toBe("EXISTING-99");
    expect(sb.state.notifications.length).toBe(0); // no re-notify on a no-op
  });

  it("CQO3 — concurrent callers: only one inserts an orders row, both return same id", async () => {
    // Single shared state — simulates two callers racing on the same quote.
    const sb = makeSupabase(baseQuote);
    // Fire both BEFORE either awaits; the claim is what serializes.
    const [a, b] = await Promise.all([
      convertQuoteToOrder(sb, baseQuote),
      convertQuoteToOrder(sb, baseQuote),
    ]);

    expect(a).toBe(b);                   // both callers see the same final order_id
    expect(sb.state.orders.length).toBe(1); // exactly one orders row written
    expect(sb.state.notifications.length).toBe(1); // and exactly one notification
  });

  it("CQO4 — claim error propagates (DB outage)", async () => {
    const sb = {
      from(table) {
        if (table === "quotes") {
          return {
            update() {
              return {
                eq() { return this; },
                is() { return this; },
                select: () => Promise.resolve({ data: null, error: { message: "DB down" } }),
              };
            },
          };
        }
        return { insert: vi.fn() };
      },
    };
    await expect(convertQuoteToOrder(sb, baseQuote)).rejects.toThrow(/DB down|claim failed/);
  });
});
