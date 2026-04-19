import { useParams } from 'react-router-dom'

export function DayRoute() {
  const { date } = useParams()
  return (
    <div>
      <h1 className="text-xl font-semibold mb-2">Day {date}</h1>
      <p className="text-(--color-text-dim)">Day detail. Coming in step 5.</p>
    </div>
  )
}
