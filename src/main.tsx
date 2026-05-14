import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { cleanFalseProgressChecks, cleanOrphanedPendingRefs, ensureMainAccount } from '@/db/schema'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { router } from '@/router'
import '@/index.css'
import '@/db/seed' // registers dev helpers on window in dev builds; no-op in prod

void ensureMainAccount()
void cleanOrphanedPendingRefs()
void cleanFalseProgressChecks()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  </StrictMode>,
)
