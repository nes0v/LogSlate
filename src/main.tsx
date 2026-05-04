import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { cleanOrphanedPendingRefs, ensureMainAccount } from '@/db/schema'
import { initAutoSync } from '@/lib/auto-sync'
import { applyColorScheme, getColorScheme } from '@/lib/color-scheme-preference'
import { router } from '@/router'
import '@/index.css'
import '@/db/seed' // registers dev helpers on window in dev builds; no-op in prod

void ensureMainAccount()
void cleanOrphanedPendingRefs()
initAutoSync()
applyColorScheme(getColorScheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
