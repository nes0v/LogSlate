import { useState } from 'react'
import { updateAccountLossLimit } from '@/db/queries'
import type { Account, LossLimit } from '@/db/types'
import { lossLimitOf } from '@/lib/loss-limit'
import { inputClassCompact as inputClass } from '@/components/form/Field'
import { NumberInput } from '@/components/form/NumberInput'
import { Pills } from '@/components/form/Pills'
import { errorMessage } from '@/lib/utils'

// Prop-firm loss-limit rules for the active account. They size the
// scratch-day band off the room above the limit and drive the header's
// BREACHED state — see `src/lib/loss-limit.ts`. `account` comes from the
// Settings page's already-gated account list, so the panel paints with the
// rest of the page instead of a frame later.
export function LossLimitPanel({ account }: { account: Account }) {
  return (
    <section>
      <h2 className="text-sm font-medium mb-2">Loss limit</h2>
      <div className="rounded-(--radius) bg-(--color-panel) p-3 space-y-3">
        <p className="text-sm text-(--color-text-dim)">
          For prop-firm accounts scratch days size off the room left above the
          limit.
          <br />
          Leave max loss empty for a regular account.
        </p>
        {/* Keyed on the account so drafts never carry across a switch. */}
        <LossLimitForm key={account.id} account={account} />
      </div>
    </section>
  )
}

type Mode = 'static' | 'trailing'

const MODES: ReadonlyArray<{ value: Mode; label: string }> = [
  { value: 'static', label: 'Static' },
  { value: 'trailing', label: 'Trailing' },
]

function LossLimitForm({ account }: { account: Account }) {
  const [error, setError] = useState<string | null>(null)
  const limit = lossLimitOf(account)
  // The limit type and stop only mean something once there's a limit.
  const hasLimit = limit.max_loss_usd !== null

  // Sends only what changed: the query merges it into the stored row, so a
  // quick second edit can't write this render's stale values back.
  async function save(change: Partial<LossLimit>): Promise<boolean> {
    try {
      await updateAccountLossLimit(account.id, change)
      setError(null)
      return true
    } catch (err) {
      setError(errorMessage(err))
      return false
    }
  }

  return (
    <div className="bg-(--color-panel-2) rounded-(--radius) p-3 flex flex-wrap gap-3 items-end">
      <label className="text-xs text-(--color-text-dim) space-y-2 flex-1 min-w-[7rem]">
        <div>Max loss (USD)</div>
        <SavedNumber
          saved={limit.max_loss_usd}
          onSave={v => save({ max_loss_usd: v })}
          placeholder="2000"
          ariaLabel="Max loss (USD)"
        />
      </label>
      {hasLimit && (
        <div className="text-xs text-(--color-text-dim) space-y-2">
          <div>Limit</div>
          <Pills
            value={limit.trailing ? 'trailing' : 'static'}
            onChange={m => {
              const trailing = m === 'trailing'
              if (trailing !== limit.trailing) void save({ trailing })
            }}
            options={MODES}
            activeBgClass="bg-(--color-panel-2)"
            ariaLabel="Limit type"
          />
        </div>
      )}
      {hasLimit && limit.trailing && (
        <label className="text-xs text-(--color-text-dim) space-y-2 flex-1 min-w-[7rem]">
          <div>Stops trailing at</div>
          <SavedNumber
            saved={limit.trail_stop_usd}
            onSave={v => save({ trail_stop_usd: v })}
            placeholder="50100"
            ariaLabel="Stops trailing at (balance)"
          />
        </label>
      )}
      {error && <div className="w-full text-xs text-(--color-loss)">{error}</div>}
    </div>
  )
}

interface SavedNumberProps {
  saved: number | null
  onSave: (v: number | null) => Promise<boolean>
  placeholder: string
  ariaLabel: string
}

// Keyed on `saved`, so the draft restarts whenever the stored value changes
// underneath it (a backup import, a Drive pull) — otherwise a later blur
// would write the stale draft back over the new value.
function SavedNumber(props: SavedNumberProps) {
  return <SavedNumberInput key={String(props.saved)} {...props} />
}

// Saves on blur/Enter, not per keystroke, so typing "2000" never writes a
// transient "2" that repaints the calendar and header under the user.
function SavedNumberInput({ saved, onSave, placeholder, ariaLabel }: SavedNumberProps) {
  const [draft, setDraft] = useState<number | null>(saved)
  return (
    <NumberInput
      value={draft}
      onChange={setDraft}
      onBlur={e => {
        // NumberInput reports null for a blank box AND for text that isn't a
        // number ("2,000", "-"); the text tells them apart. Blank clears the
        // value; anything else snaps back to what's saved.
        const blank = e.currentTarget.value.trim() === ''
        if (!blank && draft === null) {
          setDraft(saved)
          return
        }
        const next = blank ? null : draft
        if (next === saved) {
          setDraft(next)
          return
        }
        void onSave(next).then(ok => {
          if (!ok) setDraft(saved)
        })
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={inputClass}
    />
  )
}
