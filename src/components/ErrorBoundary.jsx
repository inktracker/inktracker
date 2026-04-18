import { Component } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

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

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl border border-red-200 shadow-sm p-8 max-w-md w-full text-center space-y-4">
          <div className="flex items-center justify-center w-14 h-14 bg-red-100 rounded-full mx-auto">
            <AlertTriangle className="w-7 h-7 text-red-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Something went wrong</h2>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">
              An unexpected error occurred on this page. Your data is safe — try refreshing to continue.
            </p>
          </div>
          {this.state.error?.message && (
            <pre className="text-left text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-500 overflow-auto max-h-28">
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-5 py-2.5 rounded-xl transition text-sm"
          >
            <RefreshCw className="w-4 h-4" /> Reload Page
          </button>
        </div>
      </div>
    );
  }
}
