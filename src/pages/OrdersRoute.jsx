// Role dispatcher for /Orders — shared route. Brokers see their
// dashboard pinned to the Orders section; shop-side users see the
// standard Orders page. See QuotesRoute for the architecture rationale
// (added 2026-05-27 broker portal mirrors-shop-layout refactor).

import { useAuth } from "@/lib/AuthContext";
import Orders from "./Orders";
import BrokerDashboard from "./BrokerDashboard";

export default function OrdersRoute() {
  const { user, isLoadingAuth } = useAuth();
  if (isLoadingAuth) return null;
  if (user?.role === "broker") {
    return <BrokerDashboard initialTab="orders" />;
  }
  return <Orders />;
}
