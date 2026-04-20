import { Link, NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'

const links = [
  { to: '/stats', label: 'Stats' },
  { to: '/settings', label: 'Settings' },
]

export function Layout() {
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
        </div>
      </header>
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
