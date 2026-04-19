import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PeriodNavProps {
  title: string
  onPrev: () => void
  onNext: () => void
  onToday: () => void
}

export function PeriodNav({ title, onPrev, onNext, onToday }: PeriodNavProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onPrev}
        aria-label="Previous period"
        className="p-1.5 rounded-md text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
      >
        <ChevronLeft className="size-4" />
      </button>
      <h1 className="text-lg font-semibold min-w-56 text-center">{title}</h1>
      <button
        onClick={onNext}
        aria-label="Next period"
        className="p-1.5 rounded-md text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
      >
        <ChevronRight className="size-4" />
      </button>
      <button
        onClick={onToday}
        className="ml-2 px-2 py-1 text-xs rounded-md border border-(--color-border) text-(--color-text-dim) hover:text-(--color-text)"
      >
        Today
      </button>
    </div>
  )
}
