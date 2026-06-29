// Imperative read-through cache for entity lists, backed by the shared
// react-query QueryClient. Lets existing useEffect/Promise.all pages get
// caching + in-flight de-duplication without being rewritten into useQuery
// hooks — drop-in replacements for base44.entities.X.filter()/.list().
//
//   import { cachedFilter, cachedList } from "@/lib/queries/cachedEntity";
//   const orders = await cachedFilter("Order", { filters: { shop_owner }, sort: "-created_date", limit: 50 });
//
// Within staleTime (30s, see query-client) a remount returns the cached list
// instantly — no network — which kills refetch-on-every-navigation. Writes go
// through base44.entities.*.create/update/delete, which invalidate ["entity",
// <table>]; the keys here share that prefix, so a freshly written row is never
// served stale.
//
// IMPORTANT: do NOT use this for realtime-subscribed lists (Production,
// ShopFloor, BrokerDashboard order lists). Those call .filter() directly and
// must hit the network on every realtime tick — caching would mask live
// updates. This is for load-once-per-view data (e.g. the Dashboard).

import { queryClientInstance } from "@/lib/query-client";
import { base44, resolveTable } from "@/api/supabaseClient";

// Stable, order-independent serialization of the key params so two calls with
// the same logical filters produce the same cache key regardless of object
// key order.
function stable(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, k) => {
        if (value[k] !== undefined) acc[k] = stable(value[k]);
        return acc;
      }, {});
  }
  return value;
}

// Active tenant for cache scoping (CACHE-03). Set by AuthContext on login and
// cleared on logout. Keys include it so two shops in the same browser session
// (e.g. a broker switching accounts) can never read each other's cached rows —
// defense-in-depth on top of RLS + clear-on-signout.
let _activeShop = "_";
export function setCacheShop(shop) {
  _activeShop = shop || "_";
}

// Cache key for a read. Segment 1 is the resolved TABLE name so it matches the
// ["entity", <table>] prefix that mutations invalidate; the active shop is a
// later segment so prefix-invalidation still works across shops.
export function entityKey(entity, params) {
  return ["entity", resolveTable(entity), _activeShop, JSON.stringify(stable(params ?? {}))];
}

/** Cached equivalent of base44.entities[entity].filter(filters, sort, limit, columns). */
export function cachedFilter(entity, { filters, sort, limit, columns, staleTime } = {}) {
  return queryClientInstance.fetchQuery({
    queryKey: entityKey(entity, { kind: "filter", filters, sort, limit, columns }),
    queryFn: () => base44.entities[entity].filter(filters, sort, limit, columns),
    ...(staleTime !== undefined ? { staleTime } : {}),
  });
}

/** Cached equivalent of base44.entities[entity].list(sort, limit, columns). */
export function cachedList(entity, { sort, limit, columns, staleTime } = {}) {
  return queryClientInstance.fetchQuery({
    queryKey: entityKey(entity, { kind: "list", sort, limit, columns }),
    queryFn: () => base44.entities[entity].list(sort, limit, columns),
    ...(staleTime !== undefined ? { staleTime } : {}),
  });
}

/** Manually invalidate every cached read for an entity (rarely needed — writes
 *  via base44.entities.* already invalidate). */
export function invalidateEntity(entity) {
  return queryClientInstance.invalidateQueries({ queryKey: ["entity", resolveTable(entity)] });
}
