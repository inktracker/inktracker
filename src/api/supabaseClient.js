import { createClient } from "@supabase/supabase-js";
import { queryClientInstance } from "@/lib/query-client";
import { describeEdgeError } from "@/lib/edgeErrors";
import { enrichEntityError } from "@/lib/entityErrors";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Global edge-error translation. EVERY edge call — the ~37 direct
// supabase.functions.invoke sites AND base44.functions.invoke — flows through
// this one patch, so no call site (present or future) can surface supabase-js's
// opaque "Edge Function returned a non-2xx status code". describeEdgeError
// clones the Response before reading, and the returned error preserves
// `.context`/`.status`/`.raw`, so the money-flow callers that unwrap `.context`
// themselves (QB invoice create, quote/invoice send) keep working.
const _rawFunctionsInvoke = supabase.functions.invoke.bind(supabase.functions);
supabase.functions.invoke = async (name, options) => {
  const res = await _rawFunctionsInvoke(name, options);
  if (!res || !res.error) return res;
  const friendly = new Error(await describeEdgeError(res.error));
  friendly.name = res.error?.name || "FunctionsError";
  friendly.status = res.error?.context?.status ?? res.error?.status ?? 0;
  friendly.context = res.error?.context;
  friendly.raw = res.error;
  return { data: res.data, error: friendly };
};

// Bust any cached reads (cachedFilter/cachedList in lib/queries/cachedEntity)
// for a table after a write, so a freshly created/updated/deleted row never
// hides behind a stale cache entry. Keyed by ["entity", <table>] — the same
// prefix cachedEntity builds. Wrapped so a cache hiccup never fails a mutation.
function invalidateTable(tableName) {
  try {
    queryClientInstance.invalidateQueries({ queryKey: ["entity", tableName] });
    // A profiles write can change the current user's own row (role, settings),
    // so also bust the deduped auth.me() cache below.
    if (tableName === "profiles") {
      queryClientInstance.invalidateQueries({ queryKey: ["auth", "me"] });
    }
  } catch {
    /* cache invalidation is best-effort; the write already succeeded */
  }
}

// Any auth-state change (sign-in, sign-out, token refresh, user update) makes a
// previously cached auth.me() result obsolete — a stale negative cache would
// otherwise make a just-logged-in user look signed-out. Registered at module
// load (before AuthContext mounts) so it runs first and the cache is fresh by
// the time AuthContext's own listener calls me().
supabase.auth.onAuthStateChange(() => {
  try {
    queryClientInstance.invalidateQueries({ queryKey: ["auth", "me"] });
  } catch {
    /* best-effort */
  }
});

// ─── Entity name → Supabase table name ──────────────────────────────────────
const TABLE_MAP = {
  Quote: "quotes",
  Order: "orders",
  Customer: "customers",
  User: "profiles",
  Shop: "shops",
  Invoice: "invoices",
  InventoryItem: "inventory_items",
  // The "commissions" table is actually broker pricing reference, not
  // a commission payout — preserved both names so legacy callers work
  // while new code uses the clearer name. See memory:
  // reference_broker_pricing.md.
  Commission: "commissions",
  BrokerPricing: "commissions",
  BrokerNotification: "broker_notifications",
  BrokerPerformance: "broker_performance",
  ShopPerformance: "shop_performance",
  TaxCategory: "tax_categories",
  Payee: "payees",
  PaymentAccount: "payment_accounts",
  Message: "messages",
  BrokerDocument: "broker_documents",
  BrokerFile: "broker_files",
  PurchaseOrder: "purchase_orders",
};

// Base44 used "created_date" as the auto-timestamp column name; Supabase uses "created_at"
function parseSort(sort) {
  if (!sort || sort === "") return null;
  const descending = sort.startsWith("-");
  let column = descending ? sort.slice(1) : sort;
  if (column === "created_date") column = "created_at";
  return { column, ascending: !descending };
}

function createEntityProxy(tableName) {
  return {
    /**
     * List all rows, optional sort + limit.
     * `columns` (optional) projects a column subset, e.g. "id,total,paid" —
     * defaults to "*" so existing callers are unchanged. Project columns on
     * hot/wide reads to avoid detoasting jsonb you don't render.
     */
    async list(sort, limit, columns) {
      let q = supabase.from(tableName).select(columns || "*");
      const s = parseSort(sort);
      if (s) q = q.order(s.column, { ascending: s.ascending });
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw enrichEntityError(error);
      return data ?? [];
    },

    /**
     * Filter rows by equality on every key in `filters`.
     * `columns` (optional) projects a column subset; defaults to "*".
     */
    async filter(filters, sort, limit, columns) {
      let q = supabase.from(tableName).select(columns || "*");
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (value != null) q = q.eq(key, value);
        }
      }
      const s = parseSort(sort);
      if (s) q = q.order(s.column, { ascending: s.ascending });
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw enrichEntityError(error);
      return data ?? [];
    },

    /** Fetch a single row by id */
    async get(id) {
      const { data, error } = await supabase
        .from(tableName)
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw enrichEntityError(error);
      return data;
    },

    /** Insert a row and return it */
    async create(payload) {
      const { data, error } = await supabase
        .from(tableName)
        .insert(payload)
        .select()
        .single();
      if (error) throw enrichEntityError(error);
      invalidateTable(tableName);
      return data;
    },

    /** Update a row by id and return the updated row */
    async update(id, payload) {
      const { data, error } = await supabase
        .from(tableName)
        .update(payload)
        .eq("id", id)
        .select()
        .single();
      if (error) throw enrichEntityError(error);
      invalidateTable(tableName);
      return data;
    },

    /** Delete a row by id */
    async delete(id) {
      const { error } = await supabase.from(tableName).delete().eq("id", id);
      if (error) throw enrichEntityError(error);
      invalidateTable(tableName);
    },

    /** Subscribe to realtime changes. Returns an unsubscribe function. */
    subscribe(callback) {
      const channel = supabase
        .channel(`realtime:${tableName}:${Date.now()}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: tableName },
          callback
        )
        .subscribe();
      return () => supabase.removeChannel(channel);
    },
  };
}

// ─── Auth compatibility layer ────────────────────────────────────────────────
const auth = {
  /** Returns the current user merged with their profile, or null.
   *  Deduped through the shared query cache: the burst of me() calls on a page
   *  mount (the Dashboard fired ~4 across its effects) collapses to a single
   *  getUser()+profiles round-trip within staleTime. Kept fresh by the
   *  onAuthStateChange invalidation above, by updateMe(), and by any profiles
   *  write, so role/subscription changes are never served stale. */
  async me() {
    return queryClientInstance.fetchQuery({
      queryKey: ["auth", "me"],
      staleTime: 10_000,
      queryFn: async () => {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();
        if (error || !user) return null;

        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("auth_id", user.id)
          .maybeSingle();

        if (!profile) return null;
        return { ...profile, email: user.email };
      },
    });
  },

  /** Update the current user's profile */
  async updateMe(updates) {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Not authenticated");

    const { data, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("auth_id", user.id)
      .select()
      .single();
    if (error) throw enrichEntityError(error);
    // This updates the caller's own profile row directly (bypassing the entity
    // proxy), so bust the deduped auth.me() cache explicitly.
    try { queryClientInstance.invalidateQueries({ queryKey: ["auth", "me"] }); } catch { /* best-effort */ }
    return { ...data, email: user.email };
  },

  /** Sign out and optionally redirect */
  async logout(redirectUrl) {
    await supabase.auth.signOut();
    // Drop every cached query so the next user on a shared device can't see the
    // previous user's cached profile or entity lists.
    try { queryClientInstance.clear(); } catch { /* best-effort */ }
    if (redirectUrl) window.location.href = redirectUrl;
  },

  /**
   * In Base44, this redirected to an external login page.
   * In Supabase mode the app handles auth entirely via LoginModal,
   * so this is a no-op (AuthContext/App.jsx renders the modal instead).
   */
  redirectToLogin(_redirectUrl) {},
};

// Entity name → table name. Exported so the cache layer
// (lib/queries/cachedEntity) keys reads by the same table the proxy and the
// mutation-invalidation use, keeping cache keys and invalidation in lockstep.
export function resolveTable(prop) {
  return TABLE_MAP[prop] ?? prop.toLowerCase() + "s";
}

// ─── Dynamic entity proxy ────────────────────────────────────────────────────
// base44.entities.Quote  →  createEntityProxy("quotes")
const entities = new Proxy(
  {},
  {
    get(_, prop) {
      return createEntityProxy(resolveTable(prop));
    },
  }
);

// ─── Functions compatibility layer ───────────────────────────────────────────
// Thin passthrough — supabase.functions.invoke is globally patched above to
// translate errors, so both this wrapper and the ~37 direct-invoke sites get a
// friendly `error.message` (real reason, never the opaque generic) with
// `.status`/`.context`/`.raw` preserved.
const functions = {
  async invoke(name, params) {
    return supabase.functions.invoke(name, { body: params });
  },
};

/**
 * Drop-in replacement for the Base44 client.
 * Import as:  import { base44 } from "@/api/supabaseClient";
 */
export const base44 = { auth, entities, functions };
