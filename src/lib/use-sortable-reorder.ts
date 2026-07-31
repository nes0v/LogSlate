import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'

// Pointer-driven vertical sortable list, shared by the Models and Symbols
// sidebars. Inspired by @dnd-kit/sortable: measure row geometry on pointerdown,
// the dragged row follows the cursor's Y, other rows shift by ±itemHeight as
// the live target index sweeps past them. A short drop keeps an optimistic
// order for the frame before the live query catches up, so rows don't snap
// back through the old order.

type DragState = {
  id: string
  fromIdx: number
  startY: number
  currentY: number
  itemHeight: number
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

function targetSlot(d: DragState, listLen: number): number {
  const slots = Math.round((d.currentY - d.startY) / d.itemHeight)
  return Math.max(0, Math.min(listLen - 1, d.fromIdx + slots))
}

interface Options<T extends { id: string }> {
  /** Live-query list in persisted order (undefined while loading). */
  items: T[] | undefined
  /** Persist a new full-list order (row ids). Rejection clears the optimistic order. */
  onReorder: (orderedIds: string[]) => Promise<void> | void
  /** A pointerdown→up that never crossed the drag threshold — i.e. a click. */
  onSelect: (id: string) => void
}

export interface SortableReorder<T> {
  /** Items in display order (optimistic order applied post-drop). */
  visible: T[]
  /** True once a drag has crossed the click threshold. */
  isActiveDrag: boolean
  /** Id of the row currently under the pointer, or null. */
  draggingId: string | null
  /** Spread onto each row button; supplies the drag handler + live transform. */
  rowProps: (id: string, index: number) => {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void
    style: CSSProperties
  }
}

export function useSortableReorder<T extends { id: string }>({
  items,
  onReorder,
  onSelect,
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
        const rect = e.currentTarget.getBoundingClientRect()
        setDrag({
          id,
          fromIdx: index,
          startY: e.clientY,
          currentY: e.clientY,
          itemHeight: rect.height + SORTABLE_ROW_GAP_PX,
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
