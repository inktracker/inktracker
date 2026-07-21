import { Component } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

// Public (anonymous, customer-facing) routes. A crash on one of these is read
// by a SHOP'S CUSTOMER — someone who never signed up for anything — so the raw
// exception text must never appear. Shop staff still get the technical detail
// on their own pages, where it's genuinely useful in a support email.
// Lower-cased; matched by prefix so query strings and casing don't matter.
const CUSTOMER_FACING_PREFIXES = [
  "/quotepayment",
  "/quoterequest",
  "/artapproval",
  "/orderstatus",
  "/embed",
];

export function isCustomerFacingPath(pathname) {
  const p = String(pathname || "").toLowerCase();
  return CUSTOMER_FACING_PREFIXES.some((prefix) => p.startsWith(prefix));
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const inline = this.props.mode === "inline";
    const onReset = this.props.onReset;
    // `customerFacing` is passed by RouteErrorBoundary (which knows the route);
    // the fallback re-checks window.location so the top-level app boundary —
    // which wraps the router and has no route context — is covered too.
    const customerFacing = this.props.customerFacing ??
      (typeof window !== "undefined" && isCustomerFacingPath(window.location?.pathname));

    return (
      <div className={inline ? "py-12 px-4 flex items-center justify-center" : "min-h-screen bg-slate-50 flex items-center justify-center px-4"}>
        <div className="bg-white rounded-2xl border border-red-200 shadow-sm p-8 max-w-md w-full text-center space-y-4">
          <div className="flex items-center justify-center w-14 h-14 bg-red-100 rounded-full mx-auto">
            <AlertTriangle className="w-7 h-7 text-red-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {inline ? "This page hit a snag" : "Something went wrong"}
            </h2>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">
              {customerFacing
                ? "This page didn't load properly. Please refresh to try again — if it keeps happening, contact the shop and they'll get you sorted."
                : inline
                  ? "Your data is safe. Reload to try again, or head back to the dashboard."
                  : "An unexpected error occurred. Your data is safe — reload to continue. If this keeps happening, email support@inktracker.app."}
            </p>
          </div>
          {/* Raw exception text is for SHOP STAFF only — never for a shop's
              customer, who can't act on it and reads it as broken. */}
          {!customerFacing && this.state.error?.message && (
            <pre className="text-left text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-500 overflow-auto max-h-28">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {/* A shop's customer has no dashboard to go back to. */}
            {inline && onReset && !customerFacing && (
              <button
                onClick={onReset}
                className="inline-flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold px-4 py-2 rounded-xl transition text-sm"
              >
                <Home className="w-4 h-4" /> Go to Dashboard
              </button>
            )}
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold px-5 py-2.5 rounded-xl transition text-sm"
            >
              <RefreshCw className="w-4 h-4" /> Reload Page
            </button>
          </div>
          {/* Route a shop's customer to THEIR shop, not to our support inbox —
              we can't help them with their order, and there's no technical
              detail shown for them to quote anyway. */}
          {!inline && !customerFacing && (
            <p className="text-xs text-slate-500">
              Persistent issue? Email <a href="mailto:support@inktracker.app" className="text-teal-600 hover:text-teal-700 font-semibold">support@inktracker.app</a> with the message above.
            </p>
          )}
        </div>
      </div>
    );
  }
}

// Route-level wrapper — keyed by pathname so navigating away automatically
// resets the boundary without a full reload. Use around individual <Route>
// elements so a crash in one page doesn't black-screen the rest of the app.
export function RouteErrorBoundary({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <ErrorBoundary
      key={location.pathname}
      mode="inline"
      customerFacing={isCustomerFacingPath(location.pathname)}
      onReset={() => navigate("/")}
    >
      {children}
    </ErrorBoundary>
  );
}
