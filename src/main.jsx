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

// Boot reached — clear the stale-asset reload guards (set by the self-heal
// script in index.html and the vite:preloadError handler below) so a future
// redeploy can heal again.
try {
  sessionStorage.removeItem('assetReloaded')
  sessionStorage.removeItem('chunkReloaded')
} catch { /* storage unavailable */ }

// A tab opened before a redeploy requests lazy chunks that no longer exist
// (hashed filenames changed). One guarded reload picks up the fresh
// index.html instead of stranding the visitor on a broken route.
window.addEventListener('vite:preloadError', (e) => {
  try {
    if (sessionStorage.getItem('chunkReloaded')) return
    sessionStorage.setItem('chunkReloaded', '1')
  } catch { return }
  e.preventDefault()
  window.location.reload()
})

// First-touch attribution (referrer/utm/landing) — must run before any
// client-side routing rewrites the URL. Read back at signup (LoginModal).
import('@/lib/attribution').then((m) => m.captureAttribution()).catch(() => {})

ReactDOM.createRoot(document.getElementById('root')).render(
  <RootErrorBoundary>
    <App />
    <UpdateAvailableBanner />
  </RootErrorBoundary>
)

// Native (Capacitor iOS) setup — status bar, safe-area hook, deep-link auth
// return. No-op on web, so nothing changes in the browser build.
import('@/lib/mobile/native').then((m) => m.initNativeApp()).catch(() => {})

// Initialize Sentry + analytics AFTER first paint, on idle — keeps both chunks
// out of the initial load. Errors before Sentry fires are still captured (the
// boundaries lazy-init Sentry on demand). Both no-op without their env key;
// analytics additionally no-ops until the visitor accepts cookies. See
// src/lib/sentry.js and src/lib/analytics.js.
const initDeferred = () => {
  import('@/lib/sentry').then((m) => m.initSentry()).catch(() => {})
  import('@/lib/analytics').then((m) => m.initAnalytics()).catch(() => {})
}
if (typeof window !== 'undefined') {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(initDeferred, { timeout: 3000 })
  } else {
    window.addEventListener('load', () => setTimeout(initDeferred, 1200))
  }
}
