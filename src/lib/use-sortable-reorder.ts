import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'

// Pointer-driven vertical sortable list, shared by the Models and Symbols
// sidebars and the Progress rule list. Inspired by @dnd-kit/sortable: measure
// row geometry on pointerdown, the dragged row follows the cursor's Y, other
// rows shift by ±itemHeight as the live target index sweeps past them. A
// short drop keeps an optimistic order for the frame before the live query
// catches up, so rows don't snap back through the old order.

export type DragState = {
  id: string
  fromIdx: number
  startY: number
  currentY: number
  itemHeight: number
  /** Each row's top and bottom at pointerdown, in display order — set when
   *  rows differ in height (Progress: rules and the shorter lines), where a
   *  single pitch drifts a slot over a long drag. Absent, every row is
   *  `itemHeight` apart. */
  bounds?: { top: number; bottom: number }[]
  /** Sticky promotion to a "real drag" — flips true the first move past
   *  CLICK_THRESHOLD and never back, so swinging the cursor back over the
   *  origin mid-drag doesn't drop the shadow / re-arm click selection. */
  active: boolean
}

// Movement (px) below which pointerdown→up is a click, not a drag.
const CLICK_THRESHOLD = 5

// Visible gap between rows. Must match the container's Tailwind gap class
// (exported below) — added to row height to get the slot pitch.
export const SORTABLE_ROW_GAP_PX = 6
export const SORTABLE_ROW_GAP_CLASS = 'space-y-1.5'

export function targetSlot(d: DragState, listLen: number): number {
  if (!d.bounds) {
    const slots = Math.round((d.currentY - d.startY) / d.itemHeight)
    return Math.max(0, Math.min(listLen - 1, d.fromIdx + slots))
  }
  // A row is passed once the dragged row's leading edge crosses its middle —
  // about halfway, measured against the row being passed.
  const b = d.bounds
  const dy = d.currentY - d.startY
  const middle = (i: number) => (b[i].top + b[i].bottom) / 2
  // One direction only: run both and a row much taller than the ones it
  // passes gets pulled back by the loop facing the other way.
  let idx = d.fromIdx
  if (dy > 0) {
    while (idx + 1 < listLen && b[d.fromIdx].bottom + dy > middle(idx + 1)) idx++
  } else {
    while (idx - 1 >= 0 && b[d.fromIdx].top + dy < middle(idx - 1)) idx--
  }
  return idx
}

interface Options<T extends { id: string }> {
  /** Live-query list in persisted order (undefined while loading). */
  items: T[] | undefined
  /** Persist a new full-list order (row ids). Rejection clears the optimistic order. */
  onReorder: (orderedIds: string[]) => Promise<void> | void
  /** A pointerdown→up that never crossed the drag threshold — i.e. a click. */
  onSelect: (id: string) => void
  /** Gap between rows, for a list not spaced with `SORTABLE_ROW_GAP_CLASS`. */
  rowGapPx?: number
}

export interface SortableReorder<T> {
  /** Items in display order (optimistic order applied post-drop). */
  visible: T[]
  /** True once a drag has crossed the click threshold. */
  isActiveDrag: boolean
  /** Id of the row currently under the pointer, or null. */
  draggingId: string | null
  /** Spread onto each row button; supplies the drag handler + live transform.
   *  A row dragged by a handle takes `style` and marks itself
   *  `data-sortable-row`, and the handle takes `onPointerDown` — the row, not
   *  the handle, is what gets measured. Marked rows are also measured one by
   *  one, so rows of different heights land in the right slot; if the marked
   *  siblings don't match the list, every row is taken as the dragged row's
   *  height. */
  rowProps: (id: string, index: number) => {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void
    style: CSSProperties
  }
}

export function useSortableReorder<T extends { id: string }>({
  items,
  onReorder,
  onSelect,
  rowGapPx = SORTABLE_ROW_GAP_PX,
}: Options<T>): SortableReorder<T> {
  // Locally-applied order for the window between a drag commit and the live
  // query refreshing, so translateY=0 doesn't snap back through the old order.
  const [optimisticIds, setOptimisticIds] = useState<string[] | null>(null)

  const visible = useMemo(() => {
    const base = items ?? []
    if (!optimisticIds) return base
    const byId = new Map(base.map(it => [it.id, it]))
    const seen = new Set(optimisticIds)
    const ordered: T[] = []
    for (const id of optimisticIds) {
      const it = byId.get(id)
      if (it) ordered.push(it)
    }
    // Defensive: append rows added between commit and live-query refresh.
    for (const it of base) if (!seen.has(it.id)) ordered.push(it)
    return ordered
  }, [items, optimisticIds])

  const [drag, setDrag] = useState<DragState | null>(null)
  const isDragging = drag !== null
  const isActiveDrag = drag !== null && drag.active

  // Latest values for the window-level pointerup closure, which is registered
  // once when a drag begins and can't capture state that changes mid-drag.
  const dragRef = useRef(drag)
  const visibleRef = useRef(visible)
  const itemsRef = useRef(items)
  const onReorderRef = useRef(onReorder)
  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    dragRef.current = drag
    visibleRef.current = visible
    itemsRef.current = items
    onReorderRef.current = onReorder
    onSelectRef.current = onSelect
  })

  useEffect(() => {
    if (!isDragging) return
    const onMove = (e: globalThis.PointerEvent) => {
      setDrag(d => {
        if (!d) return null
        const active = d.active || Math.abs(e.clientY - d.startY) >= CLICK_THRESHOLD
        return { ...d, currentY: e.clientY, active }
      })
    }
    const onUp = () => {
      const d = dragRef.current
      setDrag(null)
      if (!d) return
      const vis = visibleRef.current
      const all = itemsRef.current
      if (!all) return
      // Click vs drag: a click selects; a drag commits the reorder but leaves
      // selection where it was. Uses the sticky `active` flag so a wiggly drag
      // ending back near the origin still commits.
      if (!d.active) {
        onSelectRef.current(d.id)
        return
      }
      const newIdx = targetSlot(d, vis.length)
      if (newIdx === d.fromIdx) return
      const reordered = vis.slice()
      const [moved] = reordered.splice(d.fromIdx, 1)
      reordered.splice(newIdx, 0, moved)
      const visibleSet = new Set(vis.map(v => v.id))
      let vi = 0
      const ids = all.map(row => (visibleSet.has(row.id) ? reordered[vi++].id : row.id))
      setOptimisticIds(reordered.map(v => v.id))
      Promise.resolve(onReorderRef.current(ids)).catch(() => setOptimisticIds(null))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [isDragging])

  // Body cursor + select lock follow the active (post-threshold) drag so a
  // plain click doesn't briefly flip the cursor to grabbing.
  useEffect(() => {
    if (!isActiveDrag) return
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isActiveDrag])

  // Clear the optimistic order only once the live query has caught up, so
  // there's one frame with optimistic ordering, then a clean handoff.
  useEffect(() => {
    if (!optimisticIds || !items) return
    const persisted = items.map(it => it.id)
    if (
      persisted.length === optimisticIds.length &&
      persisted.every((id, i) => id === optimisticIds[i])
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOptimisticIds(null)
    }
  }, [items, optimisticIds])

  const dragNewIdx = drag ? targetSlot(drag, visible.length) : -1

  function rowProps(id: string, index: number) {
    const isDragged = drag?.id === id
    let translateY = 0
    if (drag) {
      if (isDragged) translateY = drag.currentY - drag.startY
      else if (drag.fromIdx < dragNewIdx && index > drag.fromIdx && index <= dragNewIdx)
        translateY = -drag.itemHeight
      else if (drag.fromIdx > dragNewIdx && index < drag.fromIdx && index >= dragNewIdx)
        translateY = drag.itemHeight
    }
    return {
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (e.button !== 0) return
        const marked = e.currentTarget.closest('[data-sortable-row]')
        const row = marked ?? e.currentTarget
        const rect = row.getBoundingClientRect()
        // Only rows that mark themselves can be found as siblings; a count
        // that doesn't match the list means something else is in there.
        const siblings = marked?.parentElement?.querySelectorAll(':scope > [data-sortable-row]')
        const bounds =
          siblings && siblings.length === visible.length
            ? Array.from(siblings, el => {
                const r = el.getBoundingClientRect()
                return { top: r.top, bottom: r.bottom }
              })
            : undefined
        setDrag({
          id,
          fromIdx: index,
          startY: e.clientY,
          currentY: e.clientY,
          itemHeight: rect.height + rowGapPx,
          bounds,
          active: false,
        })
      },
      style: {
        transform: `translateY(${translateY}px)`,
        zIndex: isDragged ? 10 : undefined,
        position: 'relative' as const,
        cursor: isActiveDrag ? 'grabbing' : undefined,
        touchAction: 'none' as const,
      },
    }
  }

  return { visible, isActiveDrag, draggingId: drag?.id ?? null, rowProps }
}
