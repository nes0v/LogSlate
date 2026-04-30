import { createBrowserRouter } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { CalendarRoute } from '@/routes/Calendar'
import { DayRoute } from '@/routes/Day'
import { StatsRoute } from '@/routes/Stats'
import { ReportsRoute } from '@/routes/Reports'
import { JournalRoute } from '@/routes/Journal'
import { ModelsRoute } from '@/routes/Models'
import { ProgressRoute } from '@/routes/Progress'
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
      { path: 'month/:ym', Component: CalendarRoute },
      { path: 'day/:date', Component: DayRoute },
      { path: 'stats', Component: StatsRoute },
      { path: 'reports', Component: ReportsRoute },
      { path: 'journal', Component: JournalRoute },
      { path: 'models', Component: ModelsRoute },
      { path: 'progress', Component: ProgressRoute },
      { path: 'settings', Component: SettingsRoute },
      { path: 'trade/new', Component: TradeNewRoute },
      { path: 'trade/:id/edit', Component: TradeEditRoute },
      { path: '*', Component: NotFoundRoute },
    ],
  },
])
