import { useLayoutEffect, useRef } from 'react'

/**
 * Auto-grows a textarea's height to fit its content. The CSS `min-height`
 * (e.g. `min-h-[95px]`) still wins when the content is short, so the
 * default visual size is preserved; once the content exceeds it, the
 * textarea grows to remove its scrollbar.
 *
 * Usage: pass the textarea's current value so the effect re-runs on every
 * change. Spread the returned ref onto the `<textarea>`.
 */
export function useAutosizeTextarea(value: string | null | undefined) {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Reset to auto first so scrollHeight reflects actual content,
    // not a previously-grown height. Browser snaps to the new size on
    // the next layout pass.
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return ref
}
