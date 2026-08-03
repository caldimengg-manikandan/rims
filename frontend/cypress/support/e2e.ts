// cypress/support/e2e.ts
// Global support file — loaded before every spec

import './commands'

// Suppress uncaught exceptions that come from third-party scripts
// (e.g. Supabase auth realtime, TensorFlow.js) so they don't fail tests.
Cypress.on('uncaught:exception', (err) => {
  // Ignore known benign runtime errors
  const IGNORED = [
    'ResizeObserver loop limit exceeded',
    'Cannot read properties of null',
    'Non-Error promise rejection',
    'Loading chunk',
    'Failed to fetch',
    // Next.js dev-mode hydration mismatch caused by per-request CSP nonces
    // (nonce differs between SSR and client hydration — not an app bug)
    'Hydration failed because the server rendered HTML',
    'hydration',
    'chunk-error-handler',
    'nonce',
    'Minified React error #418',
    'Minified React error #423',
    'Minified React error #425',
    'Minified React error #375',
    // Next.js internal errors safe to ignore in tests
    'NEXT_NOT_FOUND',
    'NEXT_REDIRECT',
    'NotAllowedRootHTTPFallbackError',
  ]
  const errMsg = err && err.message ? err.message : (typeof err === 'string' ? err : '')
  if (errMsg && IGNORED.some((msg) => errMsg.toLowerCase().includes(msg.toLowerCase()))) return false
  return true
})

// Disable animations and force inline opacity wrapper elements to be visible
Cypress.on('window:before:load', (win) => {
  win.addEventListener('DOMContentLoaded', () => {
    const style = win.document.createElement('style')
    style.innerHTML = `
      *, *::before, *::after {
        transition: none !important;
        animation: none !important;
        transition-duration: 0s !important;
        animation-duration: 0s !important;
      }
      div[style*="opacity: 0"], div[style*="opacity:0"] {
        opacity: 1 !important;
      }
      .stagger-children > *, [class*="stagger-"] > * {
        opacity: 1 !important;
        transform: none !important;
      }
    `
    win.document.head.appendChild(style)
  })
})
