import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import UpdateAvailableBanner from '@/components/UpdateAvailableBanner'
import { initSentry, SentryErrorBoundary } from '@/lib/sentry'
import '@/index.css'

// Init Sentry FIRST so errors during App's initial render are captured.
// No-op when VITE_SENTRY_DSN isn't set (dev without a DSN, preview
// deploys, etc.) — see src/lib/sentry.js.
initSentry()

ReactDOM.createRoot(document.getElementById('root')).render(
  <SentryErrorBoundary
    fallback={({ error }) => (
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 560, margin: '64px auto' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Something went wrong</h1>
        <p style={{ fontSize: 14, color: '#475569', marginBottom: 16 }}>
          The error has been reported. Try refreshing the page. If this keeps happening, email{' '}
          <a href="mailto:support@inktracker.app" style={{ color: '#3a7050' }}>support@inktracker.app</a>.
        </p>
        {import.meta.env.DEV && error?.message && (
          <pre style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'pre-wrap' }}>{error.message}</pre>
        )}
      </div>
    )}
  >
    <App />
    <UpdateAvailableBanner />
  </SentryErrorBoundary>
)
