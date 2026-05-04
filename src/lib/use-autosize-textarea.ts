import { useEffect, useLayoutEffect, useRef } from 'react'

/**
 * Auto-grows a textarea's height to fit its content. The CSS `min-height`
 * (e.g. `min-h-[95px]`) wins for short content, so the resting size is
 * preserved; once content exceeds it, the textarea grows so its scrollbar
 * doesn't appear.
 *
 * On mount the textarea paints at its CSS `min-height` and stays there for
 * 100ms, then animates over 500ms to fit any overflowing content. The
 * delay gives the page a stable shape to land on (no layout jump from a
 * tall hydrated textarea pushing surrounding content down). Typing-time
 * resizes are suppressed until the reveal finishes (so a keystroke
 * doesn't fight the running animation), then snap instantly with no
 * animation.
 *
 * Pass the textarea's current value so the hook can re-measure on change,
 * and spread the returned ref onto the `<textarea>`.
 */
export function useAutosizeTextarea(value: string | null | undefined) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const revealed = useRef(false)
  const setupStarted = useRef(false)
  const cleanupRef = useRef<(() => void) | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !revealed.current) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  // Runs on every render — bails out cheaply once setup has run. Lives
  // here (not in a one-shot useEffect[]) so it can detect the textarea
  // attaching late, e.g. when its parent is gated on async data and only
  // renders the form after a follow-up render.
  useLayoutEffect(() => {
    if (setupStarted.current) return
    const el = ref.current
    if (!el) return
    setupStarted.current = true

    let raf1 = 0
    let raf2 = 0

    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName !== 'height') return
      el.style.transition = ''
      el.removeEventListener('transitionend', onEnd)
      revealed.current = true
    }

    const timer = window.setTimeout(() => {
      const from = el.offsetHeight
      const target = el.scrollHeight

      if (target <= from) {
        // No reveal needed; hand control to the typing-time path.
        revealed.current = true
        return
      }

      // Browsers won't transition between `height: auto` (rendered via
      // min-height) and a pixel value, so first commit the current
      // rendered height and the transition together — then on the next
      // frame change to the target, which the browser will see as an
      // animatable change.
      el.style.height = `${from}px`
      el.style.transition = 'height 500ms var(--ease)'
      el.addEventListener('transitionend', onEnd)
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          el.style.height = `${target}px`
        })
      })
    }, 100)

    cleanupRef.current = () => {
      window.clearTimeout(timer)
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      el.removeEventListener('transitionend', onEnd)
    }
  })

  useEffect(
    () => () => {
      cleanupRef.current?.()
      // Reset so the strict-mode remount re-runs the setup. Without this,
      // the layout effect bails (setupStarted=true) on the second mount but
      // the timer scheduled on the first mount has already been cancelled
      // — so the animation never fires in dev.
      setupStarted.current = false
      revealed.current = false
    },
    [],
  )

  return ref
}
