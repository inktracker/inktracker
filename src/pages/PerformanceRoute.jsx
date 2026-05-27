// Role dispatcher for /Performance — shared route. Brokers see their
// dashboard pinned to the Performance section (a broker-specific view
// scoped to their own jobs); shop-side users see the standard
// Performance page with shop-wide metrics.
// See QuotesRoute for the architecture rationale.

import { useAuth } from "@/lib/AuthContext";
import Performance from "./Performance";
import BrokerDashboard from "./BrokerDashboard";

export default function PerformanceRoute() {
  const { user, isLoadingAuth } = useAuth();
  if (isLoadingAuth) return null;
  if (user?.role === "broker") {
    return <BrokerDashboard initialTab="performance" />;
  }
  return <Performance />;
}
