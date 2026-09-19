import { useEffect } from 'react'
import { refreshNews } from '@/lib/forex-factory'
import { syncWeekNews } from '@/lib/news-sync'

// Fires once on app mount (from Layout). Refreshes the feed if the stored
// copy has gone stale and mirrors the week into IndexedDB so the Day page can
// render it. Idempotent and cheap: refreshNews() no-ops inside its freshness
// window and shares one request with any concurrent caller, so landing on
// Calendar afterwards costs nothing extra.
export function useNewsSync(): void {
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { snapshot, fetched } = await refreshNews()
        if (cancelled) return
        // `fetched` is null inside the freshness window. Mirror the cached
        // week in that case too: localStorage and IndexedDB can fall out of
        // step (evicted, partially cleared), and syncing only on a fresh
        // fetch would leave the Day page blank until the window lapsed.
        const events = fetched ?? snapshot.events
        if (events.length > 0) await syncWeekNews(events)
      } catch {
        // Silent: a feed outage shouldn't gate the app, and the
        // ForexFactoryNews component surfaces the error when the user opens
        // Calendar.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
}
