import { Link, NavLink, Outlet } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { AccountSwitcher } from '@/components/AccountSwitcher'
import { ConfirmProvider } from '@/components/ConfirmDialog'
import { NotificationBanner } from '@/components/NotificationBanner'
import { PendingUploadBanner } from '@/components/PendingUploadBanner'
import { SyncStatusIndicator } from '@/components/SyncStatusIndicator'
import { listAccounts } from '@/db/queries'
import { useNewsSync } from '@/lib/use-news-sync'
import { useCurrentEquity } from '@/lib/use-starting-equity'
import { formatUsd } from '@/lib/money'
import { cn } from '@/lib/utils'

const links = [
  { to: '/overview', label: 'Overview' },
  { to: '/reports', label: 'Reports' },
  { to: '/models', label: 'Models' },
  { to: '/progress', label: 'Progress' },
  { to: '/settings', label: 'Settings' },
]

export function Layout() {
  useNewsSync()
  const equity = useCurrentEquity()
  // Lifted from AccountSwitcher so the entire equity + switcher cluster
  // can render in one go once both are ready, instead of either piece
  // jumping in independently.
  const accounts = useLiveQuery(() => listAccounts(), [])
  const navReady = equity !== undefined && accounts !== undefined
  return (
    <ConfirmProvider>
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-30 border-b border-(--color-border) bg-(--color-panel)/85 backdrop-blur-md backdrop-saturate-150">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center gap-6">
          {/* Brand + nav share an `items-baseline` group: the brand is
              `text-base` and the nav links `text-sm`, so centering them by box
              (the row's `items-center`) leaves their baselines ~1px apart and
              the brand reads as sitting low. Baseline-aligning fixes that; the
              right-side controls stay centered in the outer row. */}
          <div className="flex items-baseline gap-4">
            <Link
              to="/"
              className="font-semibold tracking-tight text-(--color-text) hover:opacity-90"
            >
              LogSlate
            </Link>
            <nav className="flex items-baseline gap-4 text-sm overflow-x-auto">
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
          </div>
          <div className="ml-auto flex items-center gap-4">
            <SyncStatusIndicator />
            {navReady ? (
              <>
                <div className="flex items-baseline gap-1.5 font-mono text-sm tabular-nums">
                  <span className="text-xs uppercase tracking-wider text-(--color-text-dim)">Equity</span>
                  <span className="text-(--color-text)">{formatUsd(equity)}</span>
                </div>
                <div className="flex items-baseline gap-1.5 font-mono text-sm tabular-nums">
                  <span className="text-xs uppercase tracking-wider text-(--color-text-dim)">Risk</span>
                  <span className="text-(--color-text)">{formatUsd(Math.max(40, equity * 0.02))}</span>
                </div>
                <AccountSwitcher accounts={accounts} />
              </>
            ) : null}
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 pt-6 pb-40">
        <NotificationBanner />
        <PendingUploadBanner />
        <Outlet />
      </main>
    </div>
    </ConfirmProvider>
  )
}
