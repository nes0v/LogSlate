/**
 * Resolves a CSS custom property to a concrete color string that the canvas
 * API can parse.
 *
 * `getComputedStyle(...).getPropertyValue('--name')` returns the *raw textual
 * value* of the custom property as declared — for tokens defined with
 * modern functions like `light-dark(#a, #b)` or `oklch(...)`, that text is
 * not a valid <color> for canvas. lightweight-charts then silently falls
 * back to a default (typically white/transparent), which broke our chart
 * theming as soon as we adopted `light-dark()`.
 *
 * Trick: apply the variable to a real DOM property (`color`) on a probe
 * element, then read the *computed* color back. The browser fully resolves
 * `var()` + `light-dark()` + any nested fallbacks and returns an
 * `rgb(...)` / `rgba(...)` string the canvas understands.
 *
 * Call this inside effects (not during SSR).
 */
export function themeColor(name: string, fallback = '#000'): string {
  if (typeof document === 'undefined' || typeof document.body === 'undefined') {
    return fallback
  }
  const probe = document.createElement('span')
  probe.style.position = 'absolute'
  probe.style.left = '-9999px'
  probe.style.color = `var(${name})`
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return resolved || fallback
}
