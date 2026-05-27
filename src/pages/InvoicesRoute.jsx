// Role dispatcher for /Invoices — shared route. Brokers see their
// dashboard pinned to the Invoices section (the broker version is
// "Invoices & Job History" with the shop / client preview buttons);
// shop-side users see the standard Invoices page.
// See QuotesRoute for the architecture rationale.

import { useAuth } from "@/lib/AuthContext";
import Invoices from "./Invoices";
import BrokerDashboard from "./BrokerDashboard";

export default function InvoicesRoute() {
  const { user, isLoadingAuth } = useAuth();
  if (isLoadingAuth) return null;
  if (user?.role === "broker") {
    return <BrokerDashboard initialTab="invoices" />;
  }
  return <Invoices />;
}
