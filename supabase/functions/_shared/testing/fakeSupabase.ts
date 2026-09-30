// In-memory stand-in for the service-role client, for *.deno.test.ts handler
// tests (run via `npm run test:edge`). Table-keyed rows; the chain filters on
// .eq/.neq/.in/.is/.not/.gte/.lte/.gt/.lt and resolves { data, error } like
// supabase-js. Awaiting the builder itself yields the row array (the
// `.limit(1)` → `rows?.[0]` pattern); .single() errors on 0 or >1 rows like
// PostgREST; .maybeSingle() never errors.
//
// WRITES (2026-09-28): .insert / .update / .upsert / .delete are applied to
// the in-memory table when the chain settles and RECORDED on `fake.writes`
// as { op, table, patch|rows, filters } so a handler test can assert exactly
// what was written where — the wiring layer that unit tests on pure helpers
// never see. `.select("*", { count: "exact", head: true })` resolves { count }.
// `.rpc()` resolves { data: true } unless `rpcs[name]` is provided.

type Row = Record<string, unknown>;
type Rows = Row[];
type Filter = { op: string; col: string; val: unknown };
export type RecordedWrite = { op: "insert" | "update" | "upsert" | "delete"; table: string; patch?: Row; rows?: Rows; filters: Filter[]; onConflict?: string };

// opts.unique: per-table unique key columns. An insert that collides returns
// PostgREST's { error: { code: "23505" } } (e.g. processed_webhook_events on
// ["source","event_id"]) so dedupe paths can be exercised.
export function fakeSupabase(tables: Record<string, Rows>, opts: { rpcs?: Record<string, (args: unknown) => unknown>; unique?: Record<string, string[]> } = {}) {
  const store: Record<string, Rows> = {};
  for (const [t, rows] of Object.entries(tables)) store[t] = rows.map((r) => ({ ...r }));
  const writes: RecordedWrite[] = [];
  const fake = {
    tables: store,
    writes,
    // deno-lint-ignore no-explicit-any
    from(table: string): any {
      if (!store[table]) store[table] = [];
      return builder(table, store, writes, opts.unique?.[table] ?? null);
    },
    rpc(name: string, args?: unknown) {
      const fn = opts.rpcs?.[name];
      return Promise.resolve(fn ? { data: fn(args), error: null } : { data: true, error: null });
    },
  };
  return fake;
}

function matches(r: Row, f: Filter): boolean {
  const v = r?.[f.col];
  switch (f.op) {
    case "eq": return v === f.val;
    case "neq": return v !== f.val;
    case "in": return (f.val as unknown[]).includes(v);
    case "is": return f.val === null ? v == null : v === f.val;
    case "not-is": return f.val === null ? v != null : v !== f.val;
    case "gte": return (v as number) >= (f.val as number);
    case "lte": return (v as number) <= (f.val as number);
    case "gt": return (v as number) > (f.val as number);
    case "lt": return (v as number) < (f.val as number);
    case "or": return (f.val as Filter[]).some((c) => matches(r, c));
    default: return true;
  }
}

// deno-lint-ignore no-explicit-any
function builder(table: string, store: Record<string, Rows>, writes: RecordedWrite[], uniqueKey: string[] | null = null): any {
  const filters: Filter[] = [];
  let limitN: number | null = null;
  let countOnly = false;
  let pending: RecordedWrite | null = null;
  let returning = false;
  let insertCount = false;
  let conflict = false;

  const current = () => {
    let rows = store[table].filter((r) => filters.every((f) => matches(r, f)));
    if (limitN != null) rows = rows.slice(0, limitN);
    return rows;
  };

  // Apply the pending write once the chain settles (filters come AFTER
  // .update()/.delete() in supabase-js, so we can't apply eagerly).
  const settle = (): Rows => {
    if (!pending) return current();
    pending.filters = [...filters];
    writes.push(pending);
    let affected: Rows = [];
    if (pending.op === "update") {
      affected = store[table].filter((r) => filters.every((f) => matches(r, f)));
      for (const r of affected) Object.assign(r, pending.patch);
    } else if (pending.op === "delete") {
      affected = store[table].filter((r) => filters.every((f) => matches(r, f)));
      store[table] = store[table].filter((r) => !affected.includes(r));
    } else if (pending.op === "insert") {
      affected = pending.rows ?? [];
      if (uniqueKey && affected.some((row) => store[table].some((r) => uniqueKey.every((k) => r[k] === row[k])))) {
        conflict = true;
        affected = [];
      } else {
        store[table].push(...affected);
      }
    } else if (pending.op === "upsert") {
      affected = pending.rows ?? [];
      // Conflict target: the onConflict columns when given (like PostgREST),
      // else the primary key `id`.
      const keys = pending.onConflict ? pending.onConflict.split(",").map((k) => k.trim()) : ["id"];
      for (const row of affected) {
        const idx = keys.every((k) => row[k] != null)
          ? store[table].findIndex((r) => keys.every((k) => r[k] === row[k]))
          : -1;
        if (idx >= 0) Object.assign(store[table][idx], row); else store[table].push(row);
      }
    }
    pending = null;
    return affected;
  };

  // deno-lint-ignore no-explicit-any
  const api: any = {
    select(_cols?: string, o?: { count?: string; head?: boolean }) {
      if (o?.count) countOnly = true;
      if (pending) returning = true;
      return api;
    },
    order() { return api; },
    range(from: number, to: number) { limitN = to - from + 1; return api; },
    eq(col: string, val: unknown) { filters.push({ op: "eq", col, val }); return api; },
    neq(col: string, val: unknown) { filters.push({ op: "neq", col, val }); return api; },
    in(col: string, vals: unknown[]) { filters.push({ op: "in", col, val: vals }); return api; },
    is(col: string, val: unknown) { filters.push({ op: "is", col, val }); return api; },
    not(col: string, op: string, val: unknown) { filters.push({ op: op === "is" ? "not-is" : "not-" + op, col, val }); return api; },
    gte(col: string, val: unknown) { filters.push({ op: "gte", col, val }); return api; },
    lte(col: string, val: unknown) { filters.push({ op: "lte", col, val }); return api; },
    gt(col: string, val: unknown) { filters.push({ op: "gt", col, val }); return api; },
    lt(col: string, val: unknown) { filters.push({ op: "lt", col, val }); return api; },
    // PostgREST or-filter, simple form only: "col.op.val,col.op.val" with
    // op in eq/neq/is/lt/gt/lte/gte ("is.null" → null). A row passes when ANY
    // condition matches.
    or(expr: string) {
      const conds = String(expr).split(",").map((c) => {
        const [col, op, ...rest] = c.split(".");
        const raw = rest.join(".").replace(/^"(.*)"$/, "$1");
        return { op, col, val: raw === "null" ? null : raw } as Filter;
      });
      filters.push({ op: "or", col: "", val: conds });
      return api;
    },
    ilike() { return api; },
    contains() { return api; },
    limit(n: number) { limitN = n; return api; },
    insert(rows: Row | Rows, o?: { count?: string }) { if (o?.count) insertCount = true; pending = { op: "insert", table, rows: Array.isArray(rows) ? rows.map((r) => ({ ...r })) : [{ ...rows }], filters: [] }; return api; },
    upsert(rows: Row | Rows, o?: { onConflict?: string }) { pending = { op: "upsert", table, rows: Array.isArray(rows) ? rows.map((r) => ({ ...r })) : [{ ...rows }], filters: [], onConflict: o?.onConflict }; return api; },
    update(patch: Row) { pending = { op: "update", table, patch: { ...patch }, filters: [] }; return api; },
    delete() { pending = { op: "delete", table, filters: [] }; return api; },
    single() {
      const rows = settle();
      return Promise.resolve(
        rows.length === 1
          ? { data: rows[0], error: null }
          : { data: null, error: { message: rows.length === 0 ? "no rows" : "multiple rows" } },
      );
    },
    maybeSingle() {
      const rows = settle();
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
      const wasWrite = Boolean(pending);
      const rows = settle();
      const out = conflict
        ? { data: null, count: 0, error: { code: "23505", message: "duplicate key value violates unique constraint" } }
        : countOnly
        ? { data: null, count: rows.length, error: null }
        : { data: wasWrite && !returning ? null : rows, error: null, ...(insertCount ? { count: rows.length } : {}) };
      return Promise.resolve(out).then(resolve, reject);
    },
  };
  return api;
}
