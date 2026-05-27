// Role dispatcher for /Customers — shared route. The shop calls these
// "customers"; the broker portal calls them "clients" — same concept,
// just different audience naming. For brokers we map /Customers →
// BrokerDashboard's "clients" section. For shop-side users the
// standard Customers page renders unchanged.
// See QuotesRoute for the architecture rationale.

import { useAuth } from "@/lib/AuthContext";
import Customers from "./Customers";
import BrokerDashboard from "./BrokerDashboard";

export default function CustomersRoute() {
  const { user, isLoadingAuth } = useAuth();
  if (isLoadingAuth) return null;
  if (user?.role === "broker") {
    return <BrokerDashboard initialTab="clients" />;
  }
  return <Customers />;
}
