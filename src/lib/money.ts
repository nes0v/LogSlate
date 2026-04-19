const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'auto',
})

export function formatUsd(n: number): string {
  return usd.format(n)
}
