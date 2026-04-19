import { useSearchParams } from 'react-router-dom'

export function TradeNewRoute() {
  const [params] = useSearchParams()
  const date = params.get('date')
  return (
    <div>
      <h1 className="text-xl font-semibold mb-2">New trade {date ? `on ${date}` : ''}</h1>
      <p className="text-(--color-text-dim)">Trade entry form. Coming in step 4.</p>
    </div>
  )
}
