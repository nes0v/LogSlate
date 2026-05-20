import { useEffect, useState } from 'react'
import { ExternalLink, RefreshCw, X } from 'lucide-react'
import {
  driveViewUrlFromRef,
  getCachedScreenshotUrl,
  parseScreenshotRef,
  resolveScreenshotUrl,
  type ResolvedScreenshot,
} from '@/lib/drive-images'
import { useDriveState } from '@/lib/drive'
import { useConfirm } from '@/components/ConfirmDialog'
import { errorMessage } from '@/lib/utils'

interface ScreenshotThumbProps {
  value: string
  onRemove?: () => void | Promise<void>
  /** "md" (default) for ~128px height, "sm" for ~64px inline thumbnails. */
  size?: 'sm' | 'md'
  /** Pre-resolved URL or error from a parent that hoisted the fetch
   *  (e.g. via `useScreenshotUrls`). When provided, the thumb renders
   *  in its final state immediately and skips its own async fetch —
   *  eliminating the staggered "loading…" flash on lists. */
  prefetched?: ResolvedScreenshot
}

const SIZE_CLASSES = {
  // `h-32` / `h-16` is fixed (not max-h) so the browser can derive width
  // from the inline `aspect-ratio` style set on the rendered `<img>`
  // before its decode completes. Without a fixed height, aspect-ratio
  // has nothing to multiply against and the box still collapses to 0×0.
  md: { img: 'h-32', placeholder: 'h-32 w-36', failed: 'h-32 w-36' },
  sm: { img: 'h-16', placeholder: 'h-16 w-20', failed: 'h-16 w-20' },
} as const

type LoadState =
  | { status: 'loading'; ref: string }
  | { status: 'loaded'; ref: string; url: string; width: number; height: number }
  | { status: 'failed'; ref: string; error: string }

// Renders one screenshot — loading placeholder, image (clickable to open in
// Drive), or a "Couldn't load" fallback with Retry + Drive-link. Optional
// onRemove wires up an X button in the top-right corner.
export function ScreenshotThumb({ value, onRemove, size = 'md', prefetched }: ScreenshotThumbProps) {
  const confirm = useConfirm()
  // Local fetch state — only used when the parent didn't pre-resolve the
  // ref. When `prefetched` is set, the render path reads from props
  // directly so the thumb paints in its final state on first frame.
  // The lazy initializer also checks the module-level URL cache so a
  // warm ref (e.g. seeded by `preloadDay` on the Day route) renders the
  // image straight away without flashing the "loading…" placeholder.
  const [fetched, setFetched] = useState<
    | { ref: string; url: string; width: number; height: number; error: null }
    | { ref: string; url: null; width: 0; height: 0; error: string }
    | null
  >(() => {
    const cached = getCachedScreenshotUrl(value)
    return cached
      ? { ref: value, url: cached.url, width: cached.width, height: cached.height, error: null }
      : null
  })

  // Short-circuit Drive-backed refs when we're not signed in — otherwise
  // every thumb flashes "loading…" for a frame before the fetch throws
  // "Not connected to Google Drive". Pending (local-only) refs still
  // resolve normally since they don't touch Drive.
  const driveState = useDriveState()
  const ref = parseScreenshotRef(value)
  const viewUrl = driveViewUrlFromRef(ref)
  const driveOffline =
    !prefetched && ref?.kind === 'drive' && driveState.status !== 'signed-in'

  useEffect(() => {
    if (prefetched) return
    if (driveOffline) return
    if (fetched?.ref === value) return
    let cancelled = false
    void (async () => {
      try {
        const entry = await resolveScreenshotUrl(value)
        if (!cancelled) {
          setFetched({
            ref: value,
            url: entry.url,
            width: entry.width,
            height: entry.height,
            error: null,
          })
        }
      } catch (e) {
        if (!cancelled) {
          setFetched({
            ref: value,
            url: null,
            width: 0,
            height: 0,
            error: errorMessage(e),
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [value, fetched?.ref, prefetched, driveOffline])

  const effective = prefetched ? prefetchedToState(value, prefetched) : fetched
  const realLoad: LoadState = driveOffline
    ? { status: 'failed', ref: value, error: 'Not connected to\nGoogle Drive' }
    : effective?.ref === value
      ? effective.url
        ? {
            status: 'loaded',
            ref: value,
            url: effective.url,
            width: effective.width,
            height: effective.height,
          }
        : { status: 'failed', ref: value, error: effective.error ?? 'Unknown error' }
      : { status: 'loading', ref: value }

  const load = realLoad

  return (
    <div className="relative inline-block">
      <ScreenshotBody
        load={load}
        viewUrl={viewUrl}
        onRetry={() => setFetched(null)}
        sizes={SIZE_CLASSES[size]}
      />
      {onRemove && load.status !== 'loading' && (
        <button
          type="button"
          onClick={async () => {
            if (await confirm({ title: 'Delete this screenshot?' })) void onRemove()
          }}
          className="absolute -top-2 -right-2 size-6 rounded-full bg-(--color-panel-2) border border-(--color-border) flex items-center justify-center text-(--color-text-dim) hover:text-(--color-text)"
          aria-label="Remove screenshot"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  )
}

interface ScreenshotBodyProps {
  load: LoadState
  viewUrl: string | null
  onRetry: () => void
  sizes: { img: string; placeholder: string; failed: string }
}

function ScreenshotBody({ load, viewUrl, onRetry, sizes }: ScreenshotBodyProps) {
  if (load.status === 'loaded') {
    // Set CSS `aspect-ratio` from the cached natural dims so the browser
    // reserves layout space at the correct shape before the blob
    // decode completes. Combined with the `max-h-32` (or `max-h-16`)
    // class from `sizes.img`, the width derives as `height × aspect`,
    // matching the post-decode size to the byte. Without this, the
    // img renders at 0×0 during the ~10–30 ms decode window, which
    // collapses the surrounding inline-flex layout for a frame. Dims
    // fall back to 0 only on corrupt blobs (decode failure inside
    // `buildCacheEntry`); the img then renders at intrinsic size,
    // same as the pre-refactor behaviour.
    const img = (
      <img
        src={load.url}
        alt=""
        style={
          load.width && load.height
            ? { aspectRatio: `${load.width} / ${load.height}` }
            : undefined
        }
        className={`${sizes.img} rounded-(--radius) border border-(--color-border)`}
      />
    )
    if (viewUrl) {
      return (
        <a
          href={viewUrl}
          target="_blank"
          rel="noreferrer"
          title="Open in Drive"
          className="block"
        >
          {img}
        </a>
      )
    }
    return img
  }
  if (load.status === 'failed') {
    return (
      <div
        title={load.error}
        className={`${sizes.failed} rounded-(--radius) border border-dashed border-(--color-loss)/40 flex flex-col items-center justify-center gap-1 text-xs text-(--color-text-dim) text-center p-2`}
      >
        <span className="text-(--color-loss)">Couldn&rsquo;t load</span>
        <span className="text-xs break-words whitespace-pre-line">{load.error}</span>
        <div className="flex items-center gap-2 mt-1">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 text-(--color-accent) hover:underline"
          >
            <RefreshCw className="size-3" /> Retry
          </button>
          {viewUrl && (
            <a
              href={viewUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-(--color-accent) hover:underline"
            >
              <ExternalLink className="size-3" /> Drive
            </a>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className={`${sizes.placeholder} rounded-(--radius) border border-dashed border-(--color-border) flex items-center justify-center text-xs text-(--color-text-dim)`}>
      loading…
    </div>
  )
}

// Translate a `ResolvedScreenshot` (the parent-supplied prefetch) into the
// local `fetched` shape that the render path consumes.
function prefetchedToState(
  ref: string,
  prefetched: ResolvedScreenshot | undefined,
):
  | { ref: string; url: string; width: number; height: number; error: null }
  | { ref: string; url: null; width: 0; height: 0; error: string }
  | null {
  if (!prefetched) return null
  if ('url' in prefetched) {
    return {
      ref,
      url: prefetched.url,
      width: prefetched.width,
      height: prefetched.height,
      error: null,
    }
  }
  return { ref, url: null, width: 0, height: 0, error: prefetched.error }
}
