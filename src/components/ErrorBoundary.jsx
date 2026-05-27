import { Component } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

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

    return (
      <div className={inline ? "py-12 px-4 flex items-center justify-center" : "min-h-screen bg-slate-50 flex items-center justify-center px-4"}>
        <div className="bg-white rounded-2xl border border-red-200 shadow-sm p-8 max-w-md w-full text-center space-y-4">
          <div className="flex items-center justify-center w-14 h-14 bg-red-100 rounded-full mx-auto">
            <AlertTriangle className="w-7 h-7 text-red-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {inline ? "This page hit an error" : "Something went wrong"}
            </h2>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">
              {inline
                ? "Your data is safe. Navigate to another page, or reload to try again."
                : "An unexpected error occurred on this page. Your data is safe — try refreshing to continue."}
            </p>
          </div>
          {this.state.error?.message && (
            <pre className="text-left text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-500 overflow-auto max-h-28">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {inline && onReset && (
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
      onReset={() => navigate("/")}
    >
      {children}
    </ErrorBoundary>
  );
}
