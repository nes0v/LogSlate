import { useSyncExternalStore } from 'react'

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    cb => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', cb)
      return () => mql.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

// Tailwind's `sm` breakpoint is 640px — anything narrower is "mobile-ish".
export function useIsNarrowScreen(): boolean {
  return useMediaQuery('(max-width: 639px)')
}
