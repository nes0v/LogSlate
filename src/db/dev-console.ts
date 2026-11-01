import { db } from '@/db/schema'
import { clearNotifications, pushError, pushInfo } from '@/lib/notifications'

// A console handle for dev builds: `window.__logslate.db` is how one-off
// data scripts reach the database from DevTools.
declare global {
  interface Window {
    __logslate?: {
      db: typeof db
      pushError: typeof pushError
      pushInfo: typeof pushInfo
      clearNotifications: typeof clearNotifications
    }
  }
}

if (import.meta.env.DEV) {
  window.__logslate = {
    db,
    pushError,
    pushInfo,
    clearNotifications,
  }
  // React's dev build records a `performance.measure` for every component
  // render (its DevTools "Performance Tracks"), and the browser never drops
  // them: ~55 per page change, growing for as long as the tab is open. A
  // DevTools recording captures them as they happen, so clearing the buffer
  // costs nothing there. The production build records none.
  setInterval(() => performance.clearMeasures(), 60_000)
}
