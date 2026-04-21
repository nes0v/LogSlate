import { useEffect, useState } from 'react'
import { ExternalLink, RefreshCw, X } from 'lucide-react'
import {
  driveViewUrlFromRef,
  parseScreenshotRef,
  resolveScreenshotUrl,
} from '@/lib/drive-images'

interface ScreenshotThumbProps {
  value: string
  onRemove?: () => void | Promise<void>
  /** "md" (default) for ~128px height, "sm" for ~64px inline thumbnails. */
  size?: 'sm' | 'md'
}

const SIZE_CLASSES = {
  md: { img: 'max-h-32', placeholder: 'h-32 w-32', failed: 'min-h-32 w-44' },
  sm: { img: 'max-h-16', placeholder: 'h-16 w-16', failed: 'min-h-16 w-32' },
} as const

type LoadState =
  | { status: 'loading'; ref: string }
  | { status: 'loaded'; ref: string; url: string }
  | { status: 'failed'; ref: string; error: string }

// Renders one screenshot — loading placeholder, image (clickable to open in
// Drive), or a "Couldn't load" fallback with Retry + Drive-link. Optional
// onRemove wires up an X button in the top-right corner.
export function ScreenshotThumb({ value, onRemove, size = 'md' }: ScreenshotThumbProps) {
  const [fetched, setFetched] = useState<
    { ref: string; url: string; error: null } | { ref: string; url: null; error: string } | null
  >(null)

  useEffect(() => {
    if (fetched?.ref === value) return
    let cancelled = false
    void (async () => {
      try {
        const url = await resolveScreenshotUrl(value)
        if (!cancelled) setFetched({ ref: value, url, error: null })
      } catch (e) {
        if (!cancelled) {
          setFetched({ ref: value, url: null, error: (e as Error).message ?? String(e) })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [value, fetched?.ref])

  const load: LoadState =
    fetched?.ref === value
      ? fetched.url
        ? { status: 'loaded', ref: value, url: fetched.url }
        : { status: 'failed', ref: value, error: fetched.error ?? 'Unknown error' }
      : { status: 'loading', ref: value }

  const ref = parseScreenshotRef(value)
  const viewUrl = driveViewUrlFromRef(ref)

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
          onClick={() => {
            if (confirm('Delete this screenshot?')) void onRemove()
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
    const img = (
      <img
        src={load.url}
        alt=""
        className={`${sizes.img} rounded-md border border-(--color-border)`}
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
        className={`${sizes.failed} rounded-md border border-dashed border-(--color-loss)/40 flex flex-col items-center justify-center gap-1 text-xs text-(--color-text-dim) text-center p-2`}
      >
        <span className="text-(--color-loss)">Couldn&rsquo;t load</span>
        <span className="text-[10px] break-words">{load.error}</span>
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
    <div className={`${sizes.placeholder} rounded-md border border-dashed border-(--color-border) flex items-center justify-center text-xs text-(--color-text-dim)`}>
      loading…
    </div>
  )
}
