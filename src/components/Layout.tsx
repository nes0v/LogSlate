import { Link, NavLink, Outlet } from 'react-router-dom'
import { AccountSwitcher } from '@/components/AccountSwitcher'
import { NotificationBanner } from '@/components/NotificationBanner'
import { SyncStatusIndicator } from '@/components/SyncStatusIndicator'
import { useCurrentEquity } from '@/lib/use-starting-equity'
import { formatUsd } from '@/lib/money'
import { cn } from '@/lib/utils'

const links = [
  { to: '/stats', label: 'Stats' },
  { to: '/settings', label: 'Settings' },
]

export function Layout() {
  const equity = useCurrentEquity()
  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-(--color-border) bg-(--color-panel)">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center gap-6">
          <Link
            to="/"
            className="font-semibold tracking-tight text-(--color-text)"
          >
            LogSlate
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            {links.map(l => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  cn(
                    'px-2 py-1 rounded-md transition-colors',
                    isActive
                      ? 'text-(--color-text) bg-(--color-panel-2)'
                      : 'text-(--color-text-dim) hover:text-(--color-text)',
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <SyncStatusIndicator />
            <div className="flex items-baseline gap-1.5 font-mono text-sm">
              <span className="text-xs text-(--color-text-dim)">Equity</span>
              <span className="text-(--color-text)">{formatUsd(equity)}</span>
            </div>
            <AccountSwitcher />
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 py-6">
        <NotificationBanner />
        <Outlet />
      </main>
    </div>
  )
}
