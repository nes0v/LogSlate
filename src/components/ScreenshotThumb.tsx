import { useEffect, useState } from 'react'
import { ExternalLink, RefreshCw, X } from 'lucide-react'
import {
  driveViewUrlFromRef,
  getCachedScreenshotUrl,
  parseScreenshotRef,
  resolveScreenshotUrl,
} from '@/lib/drive-images'
import { useDriveState } from '@/lib/drive'
import { useConfirm } from '@/components/ConfirmDialog'
import { errorMessage } from '@/lib/utils'

interface ScreenshotThumbProps {
  value: string
  onRemove?: () => void | Promise<void>
}

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; url: string; width: number; height: number }
  | { status: 'failed'; error: string }

// Renders one screenshot — loading placeholder, image (clickable to open in
// Drive), or a "Couldn't load" fallback with Retry + Drive-link. Optional
// onRemove wires up an X button in the top-right corner.
export function ScreenshotThumb({ value, onRemove }: ScreenshotThumbProps) {
  const confirm = useConfirm()
  // Local fetch state. The lazy initializer checks the module-level URL cache so a
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
  const driveOffline = ref?.kind === 'drive' && driveState.status !== 'signed-in'

  useEffect(() => {
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
  }, [value, fetched?.ref, driveOffline])

  const load: LoadState = driveOffline
    ? { status: 'failed', error: 'Not connected to\nGoogle Drive' }
    : fetched?.ref === value
      ? fetched.error === null
        ? {
            status: 'loaded',
            url: fetched.url,
            width: fetched.width,
            height: fetched.height,
          }
        : { status: 'failed', error: fetched.error }
      : { status: 'loading' }

  return (
    <div className="relative inline-block">
      <ScreenshotBody
        load={load}
        viewUrl={viewUrl}
        onRetry={() => setFetched(null)}
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
}

function ScreenshotBody({ load, viewUrl, onRetry }: ScreenshotBodyProps) {
  if (load.status === 'loaded') {
    // Set CSS `aspect-ratio` from the cached natural dims so the browser
    // reserves layout space at the correct shape before the blob decode
    // completes. `h-32` is a fixed height (not max-h) so the width derives
    // as `height × aspect`, matching the post-decode size to the byte —
    // with no fixed height, aspect-ratio has nothing to multiply against.
    // Without this, the img renders at 0×0 during the ~10–30 ms decode
    // window, which collapses the surrounding inline-flex layout for a
    // frame. Dims fall back to 0 only on corrupt blobs (decode failure
    // inside `buildCacheEntry`); the img then renders at intrinsic size.
    const img = (
      <img
        src={load.url}
        alt=""
        style={
          load.width && load.height
            ? { aspectRatio: `${load.width} / ${load.height}` }
            : undefined
        }
        className="h-32 rounded-(--radius) border border-(--color-border)"
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
        className={`h-32 w-36 rounded-(--radius) border border-dashed border-(--color-loss)/40 flex flex-col items-center justify-center gap-1 text-xs text-(--color-text-dim) text-center p-2`}
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
    <div className="h-32 w-36 rounded-(--radius) border border-dashed border-(--color-border) flex items-center justify-center text-xs text-(--color-text-dim)">
      loading…
    </div>
  )
}
