import { useEffect } from 'react'
import { fetchForexFactoryWeek } from '@/lib/forex-factory'
import { syncWeekNews } from '@/lib/news-sync'

// Fires once on app mount (from Layout). Pulls the current week's FF feed —
// hits the 15-min localStorage cache when available — and syncs USD high/
// medium events into IndexedDB so the Day page can render them. Idempotent:
// if the user lands on Calendar afterwards, ForexFactoryNews's own load
// short-circuits on the same cache and re-syncs cheaply.
export function useNewsSync(): void {
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await fetchForexFactoryWeek('thisweek')
        if (cancelled) return
        await syncWeekNews(data)
      } catch {
        // Silent: a feed outage shouldn't gate the app, and the existing
        // ForexFactoryNews component surfaces the error visibly when the
        // user opens Calendar.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
}
