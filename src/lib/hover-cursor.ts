// Shared hover-label store used by the chart cursor. Previously this lived as
// React state on the parent route, which meant every mouse move re-rendered
// the whole route + every chart's subtree — noticeably laggy on bar charts
// where the cursor is a `<CartesianGrid>` that has to reconcile on each tick.
//
// By hoisting it into a module-level external store, only the components that
// explicitly subscribe (the cursor generator inside each chart + the tooltip
// content gates) re-render on hover — the parent tree and chart bodies stay
// stable.

import { useSyncExternalStore } from 'react'

type HoverLabel = string | null

let current: HoverLabel = null
const listeners = new Set<() => void>()

export function getHoverLabel(): HoverLabel {
  return current
}

export function setHoverLabel(label: HoverLabel): void {
  if (label === current) return
  current = label
  listeners.forEach(fn => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function useHoverLabel(): HoverLabel {
  return useSyncExternalStore(subscribe, getHoverLabel, getHoverLabel)
}
