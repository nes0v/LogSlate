/** Returns a "nice" step size — 1, 2, or 5 × 10^n — for the given span. */
function niceStep(span: number): number {
  if (span <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(span)))
  const norm = span / mag // 1..10
  let mult: number
  if (norm < 2) mult = 0.2
  else if (norm < 5) mult = 0.5
  else mult = 1
  return mult * mag
}

/**
 * Rounds a [min, max] data range to nice round bounds that Recharts can use
 * directly as a `domain`. For example, [0, 511.6] → [0, 600].
 */
export function niceDomain(min: number, max: number): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1]
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.1, 1)
    return [min - pad, max + pad]
  }
  const step = niceStep(max - min)
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step]
}
