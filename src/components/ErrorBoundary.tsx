import { Component, type ErrorInfo, type ReactNode } from 'react'
import { errorMessage } from '@/lib/utils'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Top-level safety net. Without this a render exception inside any
 * route — e.g. a chart library throwing on bad data — blanks the
 * entire screen with no recovery surface. The fallback gives the user
 * a message and a way back to a known-good page.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // No remote logging in this app; surface to the console so the
    // browser devtools have the stack + component path.
    console.error('Render crash caught by ErrorBoundary:', error, info)
  }

  reset = () => {
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-(--color-bg) text-(--color-text)">
        <div className="max-w-md w-full bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-6 space-y-3">
          <div className="text-lg font-semibold">Something broke.</div>
          <div className="text-sm text-(--color-text-dim) break-words">
            {errorMessage(this.state.error)}
          </div>
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                this.reset()
                window.location.assign('/')
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-(--radius) bg-(--color-accent) text-(--color-accent-fg) hover:opacity-90"
            >
              Back to calendar
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-(--radius) border border-(--color-border) text-(--color-text-dim) hover:text-(--color-text)"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
