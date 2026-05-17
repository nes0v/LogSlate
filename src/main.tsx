import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import {
  cleanEmptyHiddenRules,
  cleanFalseProgressChecks,
  cleanOrphanedPendingRefs,
  ensureMainAccount,
} from '@/db/schema'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { router } from '@/router'
import '@/index.css'
import '@/db/seed' // registers dev helpers on window in dev builds; no-op in prod

void ensureMainAccount()
void cleanOrphanedPendingRefs()
// `cleanEmptyHiddenRules` walks `progress_checks` to decide which
// hidden rules have any history. Run `cleanFalseProgressChecks` first
// (it drops dead `checked: false` tombstones from the legacy toggle
// path) so the GC sees a clean view — otherwise a hidden rule whose
// only remaining checks are false tombstones is briefly "in use" and
// won't be collected this boot.
void cleanFalseProgressChecks().then(() => cleanEmptyHiddenRules())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  </StrictMode>,
)
