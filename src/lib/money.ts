const usdCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
  signDisplay: 'auto',
})

const usdPrecise = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'auto',
})

export function formatUsd(n: number, opts: { precise?: boolean } = {}): string {
  return (opts.precise ? usdPrecise : usdCompact).format(n)
}
