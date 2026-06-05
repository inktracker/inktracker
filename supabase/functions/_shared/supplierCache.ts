// Read-through cache for anonymous public-wizard supplier style lookups.
//
// Used by ssLookupStyle and acLookupStyle to avoid repeating expensive live
// supplier calls for the same style. Backed by the supplier_style_cache table
// (see migration 20260621000100_supplier_style_cache.sql).
//
// Design rules (deliberately conservative — this sits in the deploy-gated
// wizard path):
//   - PER-SHOP keying. Pricing/inventory in the payload come from the shop's
//     own supplier credentials, so the cache key includes shop_owner. One
//     shop is never served another shop's payload.
//   - FAIL-OPEN. Any cache error (table missing, DB unreachable, bad row) is
//     swallowed and treated as a miss, so the live lookup proceeds exactly as
//     before. The cache can never take the wizard down.
//   - KILL SWITCH. SUPPLIER_CACHE_TTL_SECONDS=0 disables reads and writes
//     entirely; behavior reverts to pre-cache live lookups.
//   - WRITE ONLY GOOD DATA. Callers only write successful, non-empty payloads.

const DEFAULT_TTL_SECONDS = 3600; // 1 hour

// Resolve the TTL from env. Invalid / missing → default. Negative → default.
// Zero → cache disabled.
export function supplierCacheTtlSeconds(): number {
  const raw = Deno.env.get("SUPPLIER_CACHE_TTL_SECONDS");
  if (raw == null || raw.trim() === "") return DEFAULT_TTL_SECONDS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_TTL_SECONDS;
  return Math.floor(n);
}

export function supplierCacheEnabled(): boolean {
  return supplierCacheTtlSeconds() > 0;
}

// Build a stable, normalized cache key from the request's distinguishing
// params. Keys are sorted so param order can't change the key; values are
// trimmed + upper-cased so "1717" / " 1717 " / "1717" collapse to one entry.
export function buildSupplierCacheKey(parts: Record<string, unknown>): string {
  const norm: Record<string, string> = {};
  for (const k of Object.keys(parts).sort()) {
    norm[k] = String(parts[k] ?? "").trim().toUpperCase();
  }
  return JSON.stringify(norm);
}

interface CacheRef {
  supplier: string;     // 'ss' | 'ac'
  shopOwner: string;
  cacheKey: string;
}

// Returns the cached payload (any JSON) if a fresh entry exists, else null.
// Never throws — returns null on any error (fail-open → live lookup).
// deno-lint-ignore no-explicit-any
export async function readSupplierCache(admin: any, ref: CacheRef): Promise<any | null> {
  if (!supplierCacheEnabled()) return null;
  try {
    const cutoffIso = new Date(Date.now() - supplierCacheTtlSeconds() * 1000).toISOString();
    const { data, error } = await admin
      .from("supplier_style_cache")
      .select("payload")
      .eq("supplier", ref.supplier)
      .eq("shop_owner", ref.shopOwner)
      .eq("cache_key", ref.cacheKey)
      .gte("created_at", cutoffIso) // ignore stale rows
      .maybeSingle();
    if (error) {
      console.warn(`[supplierCache] read failed (treating as miss): ${error.message}`);
      return null;
    }
    return data?.payload ?? null;
  } catch (err) {
    console.warn(`[supplierCache] read exception (treating as miss): ${(err as Error).message}`);
    return null;
  }
}

// Upserts the payload, refreshing created_at (and thus the TTL window).
// Never throws — a failed write just means the next request re-fetches live.
// deno-lint-ignore no-explicit-any
export async function writeSupplierCache(admin: any, ref: CacheRef, payload: unknown): Promise<void> {
  if (!supplierCacheEnabled()) return;
  try {
    const { error } = await admin
      .from("supplier_style_cache")
      .upsert(
        {
          supplier: ref.supplier,
          shop_owner: ref.shopOwner,
          cache_key: ref.cacheKey,
          payload,
          created_at: new Date().toISOString(),
        },
        { onConflict: "supplier,shop_owner,cache_key" },
      );
    if (error) {
      console.warn(`[supplierCache] write failed (non-fatal): ${error.message}`);
    }
  } catch (err) {
    console.warn(`[supplierCache] write exception (non-fatal): ${(err as Error).message}`);
  }
}
