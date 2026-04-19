import { useParams } from 'react-router-dom'

export function TradeEditRoute() {
  const { id } = useParams()
  return (
    <div>
      <h1 className="text-xl font-semibold mb-2">Edit trade {id}</h1>
      <p className="text-(--color-text-dim)">Edit form. Coming in step 4.</p>
    </div>
  )
}
