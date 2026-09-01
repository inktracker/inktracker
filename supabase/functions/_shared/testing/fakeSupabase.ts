// In-memory stand-in for the service-role client, for *.deno.test.ts handler
// tests (run via `npm run test:edge`). Table-keyed rows; the chain filters on
// .eq/.in and resolves { data, error } like supabase-js. Awaiting the builder
// itself yields the row array (the `.limit(1)` → `rows?.[0]` pattern); .single()
// errors on 0 or >1 rows like PostgREST; .maybeSingle() never errors. Extend
// per-handler as coverage grows — writes can be added as recording stubs.

type Rows = Record<string, unknown>[];

export function fakeSupabase(tables: Record<string, Rows>) {
  return {
    from(table: string) {
      return builder([...(tables[table] ?? [])]);
    },
    rpc(_name: string, _args?: unknown) {
      return Promise.resolve({ data: true, error: null });
    },
  };
}

function builder(rows: Rows) {
  let filtered = rows;
  const api: Record<string, unknown> = {
    select() { return api; },
    order() { return api; },
    eq(col: string, val: unknown) {
      filtered = filtered.filter((r) => r?.[col] === val);
      return api;
    },
    in(col: string, vals: unknown[]) {
      filtered = filtered.filter((r) => vals.includes(r?.[col]));
      return api;
    },
    limit(n: number) {
      filtered = filtered.slice(0, n);
      return api;
    },
    single() {
      return Promise.resolve(
        filtered.length === 1
          ? { data: filtered[0], error: null }
          : { data: null, error: { message: filtered.length === 0 ? "no rows" : "multiple rows" } },
      );
    },
    maybeSingle() {
      return Promise.resolve({ data: filtered[0] ?? null, error: null });
    },
    then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
      return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
    },
  };
  return api;
}
