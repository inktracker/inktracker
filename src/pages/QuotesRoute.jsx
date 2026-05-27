// Role dispatcher for /Quotes — the shop route is shared with the
// broker portal as of 2026-05-27. When the signed-in user is a
// broker, render their dashboard pinned to the Quotes section; for
// everyone else, render the standard shop Quotes page.
//
// Brokers were previously locked to /BrokerDashboard with the section
// tracked in a ?tab= query string. Moving to a shared top-level URL
// means /Quotes works for both audiences (deep links, browser
// back/forward, "Quotes" feels like its own page).
//
// initialTab is passed to BrokerDashboard so it skips the ?tab= parse
// and opens directly on the section. See BrokerDashboard.jsx for the
// precedence rules (initialTab > ?tab= > "overview" default).

import { useAuth } from "@/lib/AuthContext";
import Quotes from "./Quotes";
import BrokerDashboard from "./BrokerDashboard";

export default function QuotesRoute() {
  const { user, isLoadingAuth } = useAuth();

  // Avoid a flash of the shop page while auth is resolving — Layout
  // already shows its own loading shell, but this guard prevents a
  // broker from briefly seeing the shop Quotes UI before the
  // dispatcher kicks in.
  if (isLoadingAuth) return null;

  if (user?.role === "broker") {
    return <BrokerDashboard initialTab="quotes" />;
  }
  return <Quotes />;
}
