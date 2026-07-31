import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { BTN_ACCENT, BTN_OUTLINED } from '@/components/form/buttonClass'
import { errorMessage } from '@/lib/utils'

/**
 * Route-level error page.
 *
 * The app already has a top-level `ErrorBoundary` (wrapping `RouterProvider`),
 * but it never sees a render crash inside a route: the data router catches
 * those first and, with no `ErrorBoundary` on the route, falls back to React
 * Router's own bare-bones "Unexpected Application Error!" screen. A hand-typed
 * bad date — `/day/2026-13-45`, `/overview?from=garbage` — used to land there.
 *
 * This is attached to every child route (see `router.tsx`) rather than to the
 * Layout route, so it renders INSIDE the layout: the header and nav stay live
 * and the user can click straight out instead of being stranded on a dead page.
 */
export function RouteError() {
  const error = useRouteError()
  const status = isRouteErrorResponse(error) ? error.status : null
  const detail = isRouteErrorResponse(error)
    ? error.statusText || String(error.data ?? '')
    : errorMessage(error)

  return (
    <div className="pt-1">
      <div className="bg-(--color-panel) rounded-(--radius) p-6 space-y-3">
        <h1 className="text-lg font-semibold">
          {status === 404 ? 'Page not found.' : "This page couldn't be shown."}
        </h1>
        <p className="text-sm text-(--color-text-dim)">
          {status === 404
            ? 'That address does not match anything in the app.'
            : 'Something in this view failed to render. Your data is untouched — ' +
              'head back or reload, and the message below may say why.'}
        </p>
        {detail && (
          <p className="text-sm text-(--color-text-faint) break-words font-mono">{detail}</p>
        )}
        <div className="flex items-center gap-2 pt-2">
          <Link to="/" className={BTN_ACCENT}>Back to calendar</Link>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={BTN_OUTLINED}
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  )
}
