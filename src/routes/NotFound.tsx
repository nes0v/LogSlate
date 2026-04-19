import { Link } from 'react-router-dom'

export function NotFoundRoute() {
  return (
    <div>
      <h1 className="text-xl font-semibold mb-2">Not found</h1>
      <Link to="/" className="text-(--color-accent) underline">Back to calendar</Link>
    </div>
  )
}
