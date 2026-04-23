/**
 * Reads a CSS custom property from `:root`. lightweight-charts renders to
 * canvas and needs resolved color strings, not `var(--name)` references —
 * call this inside effects (not during SSR).
 */
export function themeColor(name: string, fallback = '#000'): string {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}
