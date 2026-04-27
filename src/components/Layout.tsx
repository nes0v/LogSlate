import { Link, NavLink, Outlet } from 'react-router-dom'
import { AccountSwitcher } from '@/components/AccountSwitcher'
import { NotificationBanner } from '@/components/NotificationBanner'
import { SyncStatusIndicator } from '@/components/SyncStatusIndicator'
import { useCurrentEquity } from '@/lib/use-starting-equity'
import { formatUsd } from '@/lib/money'
import { cn } from '@/lib/utils'

const links = [
  { to: '/stats', label: 'Stats' },
  { to: '/reports', label: 'Reports' },
  { to: '/notebook', label: 'Notebook' },
  { to: '/playbook', label: 'Playbook' },
  { to: '/progress', label: 'Progress' },
  { to: '/settings', label: 'Settings' },
]

export function Layout() {
  const equity = useCurrentEquity()
  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-30 border-b border-(--color-border) bg-(--color-panel)/85 backdrop-blur-md backdrop-saturate-150">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center gap-6">
          <Link
            to="/"
            className="font-semibold tracking-tight text-(--color-text) hover:opacity-90"
          >
            LogSlate
          </Link>
          <nav className="flex items-center gap-4 text-sm overflow-x-auto">
            {links.map(l => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  cn(
                    'transition-colors whitespace-nowrap',
                    isActive
                      ? 'text-(--color-text)'
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
            <div className="flex items-baseline gap-1.5 font-mono text-sm tabular-nums">
              <span className="text-xs uppercase tracking-wider text-(--color-text-dim)">Equity</span>
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
