// The NY calendar day, kept current for as long as the page stays open.
//
// `nyToday()` read straight in a render body is a snapshot: a page left open
// across NY midnight keeps serving yesterday's date until something unrelated
// forces a re-render. That midnight is not the middle of the night here — it
// lands in the user's morning, well inside a stretch the app may sit open for.
// A Progress page in that state offers yesterday's checklist under today's
// label, which is the one thing it must never do.
//
// It is also an impure read, so the React Compiler will not memoize anything
// derived from it. Holding the day in state fixes both at once.

import { useEffect, useState } from 'react'
import { nyToday } from '@/lib/tz'

export function useNyToday(): string {
  const [day, setDay] = useState(nyToday)
  useEffect(() => {
    // Returning the previous value unchanged matters: this fires 1440 times a
    // day for a value that moves once, and a new string each time would
    // re-render the whole page every minute.
    function check() {
      const next = nyToday()
      setDay(prev => (prev === next ? prev : next))
    }
    const id = setInterval(check, 60_000)
    // A backgrounded PWA has its timers throttled, and a frozen tab gets none
    // at all — coming back to the foreground is the moment the date is most
    // likely to be stale.
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [])
  return day
}
