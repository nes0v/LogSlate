import { useEffect, useState } from 'react'
import { ExternalLink, Upload, X } from 'lucide-react'
import {
  discardScreenshotRef,
  driveViewUrlFromRef,
  parseScreenshotRef,
  resolveScreenshotUrl,
  storeScreenshot,
} from '@/lib/drive-images'
import { useDriveState } from '@/lib/drive'

interface ScreenshotFieldProps {
  value: string | null
  onChange: (next: string | null) => void
}

export function ScreenshotField({ value, onChange }: ScreenshotFieldProps) {
  const drive = useDriveState()
  const [resolved, setResolved] = useState<{ ref: string | null; url: string | null }>({
    ref: null,
    url: null,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Derived: only show the cached url if it belongs to the currently-selected
  // screenshot ref. While a new fetch is in flight for a different ref, url
  // falls back to null (renders the loading placeholder).
  const url = resolved.ref === value ? resolved.url : null

  useEffect(() => {
    if (!value) return
    let cancelled = false
    void (async () => {
      const u = await resolveScreenshotUrl(value)
      if (!cancelled) setResolved({ ref: value, url: u })
    })()
    return () => {
      cancelled = true
    }
  }, [value])

  async function onPick(file: File | null) {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      // Detach the previous blob/file so we don't accumulate garbage when
      // swapping screenshots repeatedly.
      await discardScreenshotRef(value)
      const ref = await storeScreenshot(file)
      onChange(ref)
    } catch (e) {
      setError((e as Error).message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onRemove() {
    await discardScreenshotRef(value)
    onChange(null)
  }

  const ref = parseScreenshotRef(value)
  const viewUrl = driveViewUrlFromRef(ref)
  const isPending = ref?.kind === 'pending'

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <label className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-(--color-border) bg-(--color-panel) hover:bg-(--color-panel-2) cursor-pointer">
          <Upload className="size-4" />
          <span>{busy ? 'Uploading…' : 'Upload'}</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={busy}
            onChange={e => {
              const f = e.target.files?.[0] ?? null
              e.target.value = ''
              void onPick(f)
            }}
          />
        </label>
        {value && (
          <div className="relative">
            {url ? (
              <img
                src={url}
                alt=""
                className="max-h-32 rounded-md border border-(--color-border)"
              />
            ) : (
              <div className="h-32 w-32 rounded-md border border-dashed border-(--color-border) flex items-center justify-center text-xs text-(--color-text-dim)">
                loading…
              </div>
            )}
            <button
              type="button"
              onClick={onRemove}
              className="absolute -top-2 -right-2 size-6 rounded-full bg-(--color-panel-2) border border-(--color-border) flex items-center justify-center text-(--color-text-dim) hover:text-(--color-text)"
              aria-label="Remove screenshot"
            >
              <X className="size-3" />
            </button>
          </div>
        )}
      </div>
      {value && (
        <div className="text-xs text-(--color-text-dim) flex items-center gap-3">
          {viewUrl ? (
            <a
              href={viewUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-(--color-accent) hover:underline"
            >
              <ExternalLink className="size-3" /> Open in Drive
            </a>
          ) : null}
          {isPending && (
            <span>
              Pending upload — will sync to Drive
              {drive.status !== 'signed-in' ? ' after you connect in Settings' : ' when you’re online'}.
            </span>
          )}
        </div>
      )}
      {error && <div className="text-xs text-(--color-loss)">{error}</div>}
    </div>
  )
}
