import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import {
  cleanEmptyHiddenRules,
  cleanFalseProgressChecks,
  cleanOrphanedPendingRefs,
  ensureMainAccount,
  normalizeProgressRules,
} from '@/db/schema'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { router } from '@/router'
import '@/index.css'
import '@/db/seed' // registers dev helpers on window in dev builds; no-op in prod

void ensureMainAccount()
void cleanOrphanedPendingRefs()
void cleanFalseProgressChecks()
// Heal old-shape rules from pre-v4 Drive backups BEFORE GC — the
// normalizer may flip an `active: true` ghost row into a real periods
// array, which would then disqualify it from the "hidden + unused" GC.
void normalizeProgressRules().then(() => cleanEmptyHiddenRules())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  </StrictMode>,
)
