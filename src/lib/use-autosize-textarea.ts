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
    // `height: auto` lets `scrollHeight` reflect the intrinsic content height
    // (otherwise the previously set inline pixel height clamps it). Run on
    // every commit so the textarea re-fits whenever its content OR its
    // available width changes (a sibling panel collapsing, an error message
    // shifting layout, a responsive reflow) — height depends on both, since
    // narrower width re-wraps the text to more lines.
    //
    // The catch: the momentary `height: auto` collapses a tall textarea to
    // its min-height, shrinking the document. If the page was scrolled past
    // the new, shorter max the browser clamps the scroll offset during the
    // forced `scrollHeight` reflow — and once the real height is restored the
    // clamp sticks, so the viewport jumps toward the top (visible when an
    // unrelated re-render, e.g. expanding a trade row on the Day page, runs
    // this effect on a long page). Snapshot the scroll position and put it
    // back: by the time we restore, the height is set again so the document
    // is tall enough for the original offset to be valid.
    const fit = () => {
      const scroller = document.scrollingElement ?? document.documentElement
      const top = scroller.scrollTop
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
      if (scroller.scrollTop !== top) scroller.scrollTop = top
    }
    fit()
    el.addEventListener('input', fit)
    return () => el.removeEventListener('input', fit)
  })

  return ref
}
