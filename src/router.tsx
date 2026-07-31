import { createBrowserRouter, type RouteObject } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { CalendarRoute } from '@/routes/Calendar'
import { DayRoute } from '@/routes/Day'
import { OverviewRoute } from '@/routes/Overview'
import { ReportsRoute } from '@/routes/Reports'
import { ModelsRoute } from '@/routes/Models'
import { SymbolsRoute } from '@/routes/Symbols'
import { ProgressRoute } from '@/routes/Progress'
import { SettingsRoute } from '@/routes/Settings'
import { TradeNewRoute } from '@/routes/TradeNew'
import { TradeEditRoute } from '@/routes/TradeEdit'
import { NotFoundRoute } from '@/routes/NotFound'
import { RouteError } from '@/routes/RouteError'

const pages: RouteObject[] = [
  { index: true, Component: CalendarRoute },
  { path: 'month/:ym', Component: CalendarRoute },
  { path: 'day/:date', Component: DayRoute },
  { path: 'overview', Component: OverviewRoute },
  { path: 'reports', Component: ReportsRoute },
  { path: 'models', Component: ModelsRoute },
  { path: 'symbols', Component: SymbolsRoute },
  { path: 'progress', Component: ProgressRoute },
  { path: 'settings', Component: SettingsRoute },
  { path: 'trade/new', Component: TradeNewRoute },
  { path: 'trade/:id/edit', Component: TradeEditRoute },
  { path: '*', Component: NotFoundRoute },
]

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Layout,
    // Attached to each page rather than to the Layout route on purpose: an
    // error boundary replaces the route it sits on, so putting it here would
    // swap out the whole layout and strand the user with no nav. Per-page, the
    // error renders in the Outlet with the header still live. Applied by map so
    // a route added above can't quietly miss it.
    children: pages.map(r => ({ ...r, ErrorBoundary: RouteError })),
  },
])
