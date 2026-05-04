import { useEffect, type RefObject } from 'react'

/**
 * Calls `onOutside` when a `mousedown` lands outside the element pointed to
 * by `ref`. Used by every popover/dropdown to close itself on click-away.
 *
 * Pass an `enabled` flag (typically the popover's `open` state) so the
 * listener only attaches while the popover is showing — avoids paying for
 * a global mousedown handler on every page.
 */
export function useOutsideClick(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  onOutside: () => void,
) {
  useEffect(() => {
    if (!enabled) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [enabled, onOutside, ref])
}
