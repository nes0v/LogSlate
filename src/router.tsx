import { createBrowserRouter } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { CalendarRoute } from '@/routes/Calendar'
import { DayRoute } from '@/routes/Day'
import { StatsRoute } from '@/routes/Stats'
import { SettingsRoute } from '@/routes/Settings'
import { TradeNewRoute } from '@/routes/TradeNew'
import { TradeEditRoute } from '@/routes/TradeEdit'
import { NotFoundRoute } from '@/routes/NotFound'

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Layout,
    children: [
      { index: true, Component: CalendarRoute },
      { path: 'day/:date', Component: DayRoute },
      { path: 'stats', Component: StatsRoute },
      { path: 'settings', Component: SettingsRoute },
      { path: 'trade/new', Component: TradeNewRoute },
      { path: 'trade/:id/edit', Component: TradeEditRoute },
      { path: '*', Component: NotFoundRoute },
    ],
  },
])
