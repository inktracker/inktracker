import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import UpdateAvailableBanner from '@/components/UpdateAvailableBanner'
import '@/index.css'

// Root error boundary with NO eager Sentry — it lazy-loads @sentry only if an
// error actually fires, so the ~31 KB sentry chunk stays off the critical path.
// The in-app ErrorBoundary (nicer "snag" UI) still wraps each route inside App.
class RootErrorBoundary extends React.Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error) {
    import('@/lib/sentry')
      .then((m) => { m.initSentry?.(); m.captureException?.(error) })
      .catch(() => {})
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 560, margin: '64px auto' }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: '#475569', marginBottom: 16 }}>
            The error has been reported. Try refreshing the page. If this keeps happening, email{' '}
            <a href="mailto:support@inktracker.app" style={{ color: '#3a7050' }}>support@inktracker.app</a>.
          </p>
          {import.meta.env.DEV && this.state.error?.message && (
            <pre style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre>
          )}
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <RootErrorBoundary>
    <App />
    <UpdateAvailableBanner />
  </RootErrorBoundary>
)

// Initialize Sentry AFTER first paint, on idle — keeps the sentry chunk out of
// the initial load. Errors before this fires are still captured (the boundaries
// lazy-init Sentry on demand). No-op without a DSN. See src/lib/sentry.js.
const initSentryDeferred = () => import('@/lib/sentry').then((m) => m.initSentry()).catch(() => {})
if (typeof window !== 'undefined') {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(initSentryDeferred, { timeout: 3000 })
  } else {
    window.addEventListener('load', () => setTimeout(initSentryDeferred, 1200))
  }
}
