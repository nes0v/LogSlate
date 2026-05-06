/**
 * Resolves a CSS custom property to a concrete color string that the canvas
 * API can parse.
 *
 * `getComputedStyle(...).getPropertyValue('--name')` returns the *raw textual
 * value* of the custom property as declared — for tokens defined with
 * modern functions like `oklch(...)` or any nested `var()`, that text is
 * not always a valid <color> for canvas. lightweight-charts then silently
 * falls back to a default.
 *
 * Trick: apply the variable to a real DOM property (`color`) on a probe
 * element, then read the *computed* color back. The browser fully resolves
 * `var()` + any nested fallbacks and returns an `rgb(...)` / `rgba(...)`
 * string the canvas understands.
 *
 * Results are memoized per token name — chart redraws hit this 10× per
 * effect run and the DOM probe is non-trivial. Cache is busted from
 * `applyColorScheme` whenever `--color-win` / `--color-loss` change.
 *
 * Call this inside effects (not during SSR).
 */
const cache = new Map<string, string>()

export function themeColor(name: string, fallback = '#000'): string {
  if (typeof document === 'undefined' || typeof document.body === 'undefined') {
    return fallback
  }
  const cached = cache.get(name)
  if (cached !== undefined) return cached
  const probe = document.createElement('span')
  probe.style.position = 'absolute'
  probe.style.left = '-9999px'
  probe.style.color = `var(${name})`
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  const value = resolved || fallback
  cache.set(name, value)
  return value
}

/** Clear the memoization cache. Call after mutating any `--color-*`
 *  custom property at runtime so the next `themeColor()` call re-probes. */
export function clearThemeColorCache(): void {
  cache.clear()
}
