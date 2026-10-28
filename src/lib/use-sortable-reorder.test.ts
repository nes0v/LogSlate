import { describe, expect, it } from 'vitest'
import { targetSlot, type DragState } from './use-sortable-reorder'

// Rows stacked from y=0 with a 4px gap, as Progress spaces them.
function stack(heights: number[]): { top: number; bottom: number }[] {
  let y = 0
  return heights.map(h => {
    const row = { top: y, bottom: y + h }
    y += h + 4
    return row
  })
}

function drag(fromIdx: number, dy: number, extra: Partial<DragState> = {}): DragState {
  return { id: 'x', fromIdx, startY: 0, currentY: dy, itemHeight: 28, active: true, ...extra }
}

describe('targetSlot', () => {
  it('steps one row per pitch when every row is the same height', () => {
    expect(targetSlot(drag(0, 13), 5)).toBe(0)
    expect(targetSlot(drag(0, 15), 5)).toBe(1)
    expect(targetSlot(drag(4, -60), 5)).toBe(2)
    expect(targetSlot(drag(0, 999), 5)).toBe(4)
  })

  it('lands a short line in the right slot across taller rules', () => {
    // Eight 25.5px rules, then a 24px line dragged up past three of them.
    const bounds = stack([25.5, 25.5, 25.5, 25.5, 25.5, 25.5, 25.5, 25.5, 24])
    expect(targetSlot(drag(8, -3 * 29.5, { bounds }), 9)).toBe(5)
    expect(targetSlot(drag(8, -8 * 29.5, { bounds }), 9)).toBe(0)
    // Where a single 28px pitch goes wrong: it rounds this to five rows up.
    expect(targetSlot(drag(8, -130, { bounds }), 9)).toBe(4)
    expect(targetSlot(drag(8, -130), 9)).toBe(3)
  })

  it('passes a row once the leading edge crosses its middle', () => {
    const bounds = stack([25.5, 25.5, 25.5])
    // Next row's middle sits 4 + 12.75 below the dragged row's bottom.
    expect(targetSlot(drag(0, 16, { bounds }), 3)).toBe(0)
    expect(targetSlot(drag(0, 17, { bounds }), 3)).toBe(1)
  })

  it('does not hold back a tall row dragged over short ones', () => {
    // Running both directions' checks pulled this back to where it started.
    const bounds = stack([45, 24, 24, 24])
    expect(targetSlot(drag(0, 20, { bounds }), 4)).toBe(1)
    expect(targetSlot(drag(0, 45, { bounds }), 4)).toBe(2)
  })

  it('clamps at both ends', () => {
    const bounds = stack([25.5, 24, 25.5])
    expect(targetSlot(drag(1, -500, { bounds }), 3)).toBe(0)
    expect(targetSlot(drag(1, 500, { bounds }), 3)).toBe(2)
  })
})
