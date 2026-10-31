const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  // Not 'auto': a float sum like 10.1 + 20.2 − 30.3 is −3.6e-15, which
  // 'auto' prints as "-$0.00". 'negative' drops the sign once it rounds to 0.
  signDisplay: 'negative',
})

/** Rounds to `digits` decimals, folding −0 into 0. For a summed or averaged
 *  figure about to be shown or toned: float dust like 10.1 + 20.2 − 30.3 =
 *  −3.6e-15 would otherwise print "-0.00" in loss red. */
export function roundTo(n: number, digits = 2): number {
  // Half away from zero on the decimal value, like Intl's formatting: shifting
  // via the exponent string keeps 1.005 at 1.005 (×100 would give 100.4999…).
  // Far past cents precision (or not finite): nothing to round.
  if (!Number.isFinite(n) || Math.abs(n) >= 1e15) return n
  const str = String(Math.abs(n))
  // Exponent form here means |n| < 1e-6: plain scaling is exact enough.
  const abs = str.includes('e')
    ? Math.round(Math.abs(n) * 10 ** digits) / 10 ** digits
    : Number(`${Math.round(Number(`${str}e${digits}`))}e-${digits}`)
  return Math.sign(n) * abs || 0
}

export function formatUsd(n: number): string {
  return usd.format(n)
}
