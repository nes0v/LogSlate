import { useLayoutEffect, useRef } from 'react'

/**
 * Auto-grows a textarea's height to fit its content. The CSS `min-height`
 * (e.g. `min-h-[95px]`) wins for short content, so the resting size is
 * preserved; once content exceeds it, the textarea grows so its scrollbar
 * doesn't appear.
 *
 * Height is set synchronously after React commits the DOM but before the
 * browser paints, so the textarea lands at its final size in one frame —
 * no min-height flash, no reveal animation.
 *
 * The effect runs on every commit so a textarea that mounts in a later
 * render than the hook's first call (e.g. a parent that initially returns
 * null while waiting on async data) still re-fits as soon as it attaches.
 *
 * It also attaches a native `input` listener so uncontrolled textareas
 * (e.g. those wired through react-hook-form's `register()`, where the
 * parent doesn't re-render on each keystroke) still resize per character.
 *
 * Spread the returned ref onto the `<textarea>`.
 */
export function useAutosizeTextarea() {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // `height: auto` lets `scrollHeight` reflect the intrinsic content
    // height (otherwise the previously set inline pixel height clamps it).
    const fit = () => {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
    fit()
    el.addEventListener('input', fit)
    return () => el.removeEventListener('input', fit)
  })

  return ref
}
