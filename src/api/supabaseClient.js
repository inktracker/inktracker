import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
    /** List all rows, optional sort + limit */
    async list(sort, limit) {
      let q = supabase.from(tableName).select("*");
      const s = parseSort(sort);
      if (s) q = q.order(s.column, { ascending: s.ascending });
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },

    /** Filter rows by equality on every key in `filters` */
    async filter(filters, sort, limit) {
      let q = supabase.from(tableName).select("*");
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (value != null) q = q.eq(key, value);
        }
      }
      const s = parseSort(sort);
      if (s) q = q.order(s.column, { ascending: s.ascending });
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },

    /** Fetch a single row by id */
    async get(id) {
      const { data, error } = await supabase
        .from(tableName)
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },

    /** Insert a row and return it */
    async create(payload) {
      const { data, error } = await supabase
        .from(tableName)
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
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
      if (error) throw error;
      return data;
    },

    /** Delete a row by id */
    async delete(id) {
      const { error } = await supabase.from(tableName).delete().eq("id", id);
      if (error) throw error;
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
  /** Returns the current user merged with their profile, or null */
  async me() {
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
    if (error) throw error;
    return { ...data, email: user.email };
  },

  /** Sign out and optionally redirect */
  async logout(redirectUrl) {
    await supabase.auth.signOut();
    if (redirectUrl) window.location.href = redirectUrl;
  },

  /**
   * In Base44, this redirected to an external login page.
   * In Supabase mode the app handles auth entirely via LoginModal,
   * so this is a no-op (AuthContext/App.jsx renders the modal instead).
   */
  redirectToLogin(_redirectUrl) {},
};

// ─── Dynamic entity proxy ────────────────────────────────────────────────────
// base44.entities.Quote  →  createEntityProxy("quotes")
const entities = new Proxy(
  {},
  {
    get(_, prop) {
      const tableName = TABLE_MAP[prop] ?? prop.toLowerCase() + "s";
      return createEntityProxy(tableName);
    },
  }
);

// ─── Functions compatibility layer ───────────────────────────────────────────
const functions = {
  async invoke(name, params) {
    const { data, error } = await supabase.functions.invoke(name, { body: params });
    return { data, error };
  },
};

/**
 * Drop-in replacement for the Base44 client.
 * Import as:  import { base44 } from "@/api/supabaseClient";
 */
export const base44 = { auth, entities, functions };
