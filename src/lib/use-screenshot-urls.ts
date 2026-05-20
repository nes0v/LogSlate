import { useEffect, useState } from 'react'
import {
  resolveScreenshotUrl,
  type ResolvedScreenshot,
} from '@/lib/drive-images'
import { errorMessage } from '@/lib/utils'

interface UseScreenshotUrlsResult {
  /** True once every ref in the input has settled (success or error). An
   *  empty input is always loaded. */
  loaded: boolean
  /** Per-ref outcome. Lookups for a ref that's still in flight return
   *  `undefined`. */
  resolved: Map<string, ResolvedScreenshot>
}

/**
 * Resolves a list of screenshot refs in parallel and reports a single
 * `loaded` flag once they've all settled. Lifts the per-thumb async
 * fetch up to the route so the page can paint with every thumb already
 * in its final state (image or "couldn't load" panel) — the alternative
 * is each `<ScreenshotThumb>` doing its own resolve and producing a
 * staggered loading-then-loaded flicker.
 */
export function useScreenshotUrls(refs: string[]): UseScreenshotUrlsResult {
  const [resolved, setResolved] = useState<Map<string, ResolvedScreenshot>>(
    new Map(),
  )

  // The dependency is the joined ref list, not the array identity; avoids
  // re-running the effect when callers pass a fresh `[]` every render.
  const refsKey = refs.join('|')

  useEffect(() => {
    // No-op for empty input — `loaded` already reads `true` when there are
    // no refs to wait on, so leaving the previous Map in place is harmless.
    if (refs.length === 0) return
    let cancelled = false
    void Promise.all(
      refs.map(async (ref): Promise<[string, ResolvedScreenshot]> => {
        try {
          const entry = await resolveScreenshotUrl(ref)
          return [ref, { url: entry.url, width: entry.width, height: entry.height }]
        } catch (e) {
          return [ref, { error: errorMessage(e) }]
        }
      }),
    ).then(entries => {
      if (cancelled) return
      setResolved(new Map(entries))
    })
    return () => {
      cancelled = true
    }
    // refsKey captures the meaningful state of refs without depending on
    // array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsKey])

  const loaded = refs.length === 0 || refs.every(r => resolved.has(r))
  return { loaded, resolved }
}
