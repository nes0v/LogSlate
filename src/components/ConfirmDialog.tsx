import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { BTN_BASE, BTN_GHOST } from '@/components/form/buttonClass'
import { cn } from '@/lib/utils'

interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** When true, the confirm button uses the loss/danger tone. Default: true
   *  since every existing call site is a delete action. */
  destructive?: boolean
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null)

/**
 * Wraps the app and provides a `useConfirm()` hook. The hook returns a
 * function that resolves to `true` when the user confirms, `false` on
 * cancel/backdrop/Escape — drop-in replacement for `window.confirm()`
 * with a consistent custom modal.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null)

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>(resolve => {
      setPending({ ...opts, resolve })
    })
  }, [])

  function close(result: boolean) {
    if (!pending) return
    pending.resolve(result)
    setPending(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending ? (
        <ConfirmModal pending={pending} onResult={close} />
      ) : null}
    </ConfirmContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    throw new Error('useConfirm() must be called inside <ConfirmProvider>.')
  }
  return ctx
}

function ConfirmModal({
  pending,
  onResult,
}: {
  pending: PendingConfirm
  onResult: (ok: boolean) => void
}) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null)
  const destructive = pending.destructive ?? true
  const confirmLabel = pending.confirmLabel ?? 'Delete'
  const cancelLabel = pending.cancelLabel ?? 'Cancel'

  useEffect(() => {
    confirmBtnRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onResult(false)
      } else if (e.key === 'Enter') {
        e.stopPropagation()
        onResult(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onResult])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-black/60"
        onClick={() => onResult(false)}
        aria-hidden
      />
      <div className="relative w-full max-w-sm rounded-(--radius) bg-(--color-panel) shadow-(--shadow-lg) p-5 space-y-4">
        <div className="space-y-1.5">
          <h2
            id="confirm-title"
            className="text-base font-medium text-(--color-text)"
          >
            {pending.title}
          </h2>
          {pending.description ? (
            <p className="text-sm text-(--color-text-dim)">
              {pending.description}
            </p>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={() => onResult(false)} className={BTN_GHOST}>
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={() => onResult(true)}
            className={cn(
              BTN_BASE,
              'font-medium hover:opacity-90',
              destructive
                ? 'bg-(--color-loss) text-white'
                : 'bg-(--color-accent) text-(--color-accent-fg)',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
