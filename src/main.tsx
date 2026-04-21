import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { ensureMainAccount } from '@/db/schema'
import { initAutoSync } from '@/lib/auto-sync'
import { tryRestoreSession } from '@/lib/drive'
import { router } from '@/router'
import '@/index.css'
import '@/db/seed' // registers dev helpers on window in dev builds; no-op in prod

void ensureMainAccount()
void tryRestoreSession()
initAutoSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
