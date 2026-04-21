import { useEffect } from 'react'

interface ArrowTargets {
  prev: string | null
  next: string | null
  navigate: (to: string) => void
}

// Wire the left/right arrow keys to the given targets. Ignores keystrokes
// while a text input, textarea, select, or contentEditable element has focus
// (so typing in the trade form doesn't trigger page navigation) and ignores
// any event with a modifier — the browser's own shortcuts take precedence.
export function useArrowNavigation({ prev, next, navigate }: ArrowTargets): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target) {
        if (/^(input|textarea|select)$/i.test(target.tagName)) return
        if (target.isContentEditable) return
      }
      if (e.key === 'ArrowLeft' && prev) navigate(prev)
      else if (e.key === 'ArrowRight' && next) navigate(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next, navigate])
}
