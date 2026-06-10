import { Skeleton } from "@/components/ui/skeleton";

// Shared skeleton compositions for page-level loading states. Each one
// approximates the loaded layout of its page archetype so content doesn't
// jump when data lands. Keep these dumb — no data, no fetching, just shape.

/** Rows for a <tbody> while table data loads. Renders real <tr>/<td> so
 *  column widths match the loaded table. */
export function TableRowsSkeleton({ rows = 6, cols = 5 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-5 py-4">
              <Skeleton className={`h-4 ${c === 0 ? "w-28" : "w-16"}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Stacked row cards — mobile list views and admin user lists. */
export function ListCardsSkeleton({ rows = 5 }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-2"
        >
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

/** Card grid matching the Customers page layout. */
export function CardGridSkeleton({ cards = 6 }) {
  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: cards }).map((_, i) => (
        <div
          key={i}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm p-5 space-y-3"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

/** Month-grid calendar — 7 day headers + 5 weeks of cells. */
export function CalendarGridSkeleton() {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm">
      <div className="grid grid-cols-7 border-b border-slate-100 dark:border-slate-700">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="py-2 flex justify-center">
            <Skeleton className="h-3 w-8" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: 35 }).map((_, i) => (
          <div
            key={i}
            className="min-h-[96px] border-b border-r border-slate-100 dark:border-slate-700 p-2 space-y-2"
          >
            <Skeleton className="h-3 w-5" />
            {i % 3 === 0 && <Skeleton className="h-5 w-full rounded-md" />}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Row of stat cards — Dashboard / Performance headers. */
export function StatCardsSkeleton({ count = 4 }) {
  return (
    <div className={`grid gap-4 grid-cols-2 ${{ 2: "lg:grid-cols-2", 3: "lg:grid-cols-3" }[count] || "lg:grid-cols-4"}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm p-5 space-y-3"
        >
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-24" />
        </div>
      ))}
    </div>
  );
}

/** Large chart / content block. */
export function ChartCardSkeleton({ className = "h-72" }) {
  return (
    <div
      className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm p-5 ${className}`}
    >
      <Skeleton className="h-4 w-32 mb-4" />
      <Skeleton className="h-[calc(100%-2.5rem)] w-full" />
    </div>
  );
}

/** Full-page skeleton for the Dashboard: stats + two content blocks. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      <Skeleton className="h-7 w-48" />
      <StatCardsSkeleton count={4} />
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        <ChartCardSkeleton />
        <ChartCardSkeleton />
      </div>
    </div>
  );
}

/** Centered single-card page — public customer-facing screens
 *  (quote payment, art approval, order status). */
export function CenteredCardSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-start justify-center px-4 py-12">
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-2xl shadow-sm p-8 space-y-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <Skeleton className="h-4 w-64" />
        <div className="space-y-3 pt-4">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-2/3 rounded-xl" />
        </div>
        <div className="flex justify-end pt-4">
          <Skeleton className="h-11 w-36 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

/** Label + input pairs — onboarding flows and settings sections. */
export function FormSkeleton({ fields = 4 }) {
  return (
    <div className="space-y-5">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}

/** Small inline placeholder for sub-sections that load independently. */
export function InlineLinesSkeleton({ lines = 3 }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-4 ${i === lines - 1 ? "w-1/2" : "w-full"}`} />
      ))}
    </div>
  );
}
