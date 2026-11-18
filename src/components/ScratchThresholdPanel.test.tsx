import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Account } from '@/db/types'
import { ScratchThresholdPanel } from './ScratchThresholdPanel'

// Saves are driven by hand: each call parks a promise the test resolves, and
// "landing" a save is a re-render with the new account row — the way the live
// query delivers it.
const saves: Array<{ pct: number; resolve: () => void; reject: (e: Error) => void }> = []
vi.mock('@/db/queries', () => ({
  updateAccountScratchPct: (_id: string, pct: number) =>
    new Promise<void>((resolve, reject) => saves.push({ pct, resolve, reject })),
}))

afterEach(() => {
  cleanup()
  saves.length = 0
})

function account(scratch_pct?: number): Account {
  return {
    id: 'acct',
    name: 'Acct',
    starting_balance: 50_000,
    ...(scratch_pct === undefined ? {} : { scratch_pct }),
    created_at: '',
    updated_at: '',
  }
}

const slider = () => screen.getByRole('slider', { name: 'Scratch threshold (percent)' })
const label = () => slider().nextElementSibling?.textContent

function step(value: number) {
  fireEvent.change(slider(), { target: { value: String(value) } })
  fireEvent.keyUp(slider())
}

describe('ScratchThresholdPanel', () => {
  it('saves on release and keeps the new value showing until the save lands', async () => {
    const { rerender } = render(<ScratchThresholdPanel account={account()} />)
    step(0.5)
    expect(saves.map(s => s.pct)).toEqual([0.5])
    expect(label()).toBe('0.5%')
    await act(async () => saves[0].resolve())
    rerender(<ScratchThresholdPanel account={account(0.5)} />)
    expect(label()).toBe('0.5%')
  })

  it('keeps focus on the slider across saves', async () => {
    const { rerender } = render(<ScratchThresholdPanel account={account()} />)
    slider().focus()
    step(0.5)
    await act(async () => saves[0].resolve())
    rerender(<ScratchThresholdPanel account={account(0.5)} />)
    expect(document.activeElement).toBe(slider())
  })

  it('does not write the same value twice (release, then blur)', () => {
    render(<ScratchThresholdPanel account={account()} />)
    step(0.5)
    fireEvent.blur(slider())
    expect(saves.map(s => s.pct)).toEqual([0.5])
  })

  it('saves a quick step back even while the first save is in flight', async () => {
    const { rerender } = render(<ScratchThresholdPanel account={account(1.0)} />)
    step(1.1)
    step(1.0)
    expect(saves.map(s => s.pct)).toEqual([1.1, 1.0])
    // The first save lands: the label must not step back to it.
    await act(async () => saves[0].resolve())
    rerender(<ScratchThresholdPanel account={account(1.1)} />)
    expect(label()).toBe('1.0%')
    await act(async () => saves[1].resolve())
    rerender(<ScratchThresholdPanel account={account(1.0)} />)
    expect(label()).toBe('1.0%')
  })

  it('saves a value again after it changed underneath (import, Drive pull)', async () => {
    const { rerender } = render(<ScratchThresholdPanel account={account()} />)
    step(0.5)
    await act(async () => saves[0].resolve())
    rerender(<ScratchThresholdPanel account={account(0.5)} />)
    // A backup import puts the account back on the default.
    rerender(<ScratchThresholdPanel account={account()} />)
    expect(label()).toBe('0.4%')
    step(0.5)
    expect(saves.map(s => s.pct)).toEqual([0.5, 0.5])
  })

  it('snaps back and shows the error when a save fails', async () => {
    render(<ScratchThresholdPanel account={account()} />)
    step(0.5)
    await act(async () => saves[0].reject(new Error('Disk full')))
    expect(label()).toBe('0.4%')
    expect(screen.getByText('Disk full')).toBeTruthy()
  })

  it('shows an out-of-range stored value clamped', () => {
    render(<ScratchThresholdPanel account={account(5)} />)
    expect(label()).toBe('1.2%')
  })
})
