import { useState } from 'react'
import { updateAccountScratchPct } from '@/db/queries'
import type { Account } from '@/db/types'
import { MAX_SCRATCH_PCT as MAX_PCT, MIN_SCRATCH_PCT as MIN_PCT, scratchPctOf } from '@/lib/loss-limit'
import { Slider } from '@/components/form/Slider'
import { errorMessage } from '@/lib/utils'

// The active account's scratch-day threshold: a day whose net PNL is within
// this percent of its base (room above the loss limit, or equity without
// one) is a scratch — see `classifyDay`. 0.2–1.2% in 0.1 steps, default 0.4%.
export function ScratchThresholdPanel({ account }: { account: Account }) {
  return (
    <section>
      <h2 className="text-sm font-medium mb-2">Scratch threshold</h2>
      <div className="rounded-(--radius) bg-(--color-panel) p-3 space-y-3">
        <p className="text-sm text-(--color-text-dim)">
          A day that ends within this percentage of your room above the loss limit (or of the starting balance, with no limit) counts as a scratch, not a win or loss. Never less than $8.
        </p>
        {/* Keyed on the account so a drag never carries across a switch. */}
        <ScratchSlider key={account.id} account={account} />
      </div>
    </section>
  )
}

function ScratchSlider({ account }: { account: Account }) {
  const saved = scratchPctOf(account)
  // Local while dragging so the label follows the thumb; saved on release, so
  // a drag across the track doesn't repaint the calendar at every step. No
  // remount on save (that would take keyboard focus off the slider after
  // every arrow step) — the draft is dropped during render instead.
  const [draft, setDraft] = useState<number | null>(null)
  // The last value sent and not yet seen back in `saved`. Commits compare
  // against it rather than `saved`, which still holds the old value while a
  // save is in flight: tapping → then ← fast must still save the ←.
  const [pending, setPending] = useState<number | null>(null)
  const [prevSaved, setPrevSaved] = useState(saved)
  if (saved !== prevSaved) {
    setPrevSaved(saved)
    // Our last write landed, or the value changed underneath us (a backup
    // import, a Drive pull) with nothing of ours in flight: show it. A value
    // landing while a LATER write of ours is still in flight is one of our
    // own earlier steps — keep the draft so the label doesn't step back.
    if (pending === null || saved === pending) {
      setDraft(null)
      setPending(null)
    }
  }
  const [error, setError] = useState<string | null>(null)
  const value = draft ?? saved

  function commit() {
    if (draft === null || draft === (pending ?? saved)) return
    const next = draft
    setPending(next)
    updateAccountScratchPct(account.id, next).then(
      () => setError(null),
      err => {
        // Snap back only if nothing newer has replaced this value since.
        setPending(p => (p === next ? null : p))
        setDraft(d => (d === next ? null : d))
        setError(errorMessage(err))
      },
    )
  }

  return (
    <div className="bg-(--color-panel-2) rounded-(--radius) px-3 pt-[10px] pb-[9px] space-y-2">
      <Slider
        value={value}
        min={MIN_PCT}
        max={MAX_PCT}
        step={0.1}
        onChange={setDraft}
        onCommit={commit}
        label={`${value.toFixed(1)}%`}
        ariaLabel="Scratch threshold (percent)"
      />
      {error && <div className="text-xs text-(--color-loss)">{error}</div>}
    </div>
  )
}
