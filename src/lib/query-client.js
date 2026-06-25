import { QueryClient } from '@tanstack/react-query';

// Shared QueryClient. Used both by <QueryClientProvider> (for any hook-based
// useQuery) and imperatively via src/lib/queries/cachedEntity.js (fetchQuery)
// so existing useEffect/Promise.all pages get caching without a hook rewrite.
//
// staleTime 30s: a cached entity list is served instantly on remount within
// the window (kills refetch-on-every-navigation) and revalidates after.
// gcTime 5m: keep unused lists around long enough to benefit back-nav, then
// drop them. Mutations (create/update/delete in supabaseClient) invalidate the
// affected table, so a freshly written row never hides behind a stale cache.
export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			staleTime: 30_000,
			gcTime: 5 * 60_000,
			retry: 1,
		},
	},
});
