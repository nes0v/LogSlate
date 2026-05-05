import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listModels } from '@/db/queries'
import { useActiveAccountId } from '@/lib/active-account'
import { DEFAULT_MODEL_NAME, EMOTIONS, type Emotion } from '@/db/types'
import {
  CONTRACT_OPTS,
  HOLD_OPTS,
  OUTCOME_OPTS,
  SESSION_OPTS,
  SIDE_OPTS,
  SYMBOL_OPTS,
  WEEKDAY_OPTS,
} from '@/lib/filter-options'
import {
  MODEL_NONE,
  type HoldBucket,
  type TradeFilters,
} from '@/lib/filters'
import { Pills } from '@/components/form/Pills'
import { RatingFilter } from '@/components/form/RatingFilter'
import { FilterDropdown } from '@/components/form/FilterDropdown'
import { DatePicker } from '@/components/form/DatePicker'
import { Field } from '@/components/form/Field'

/**
 * Shared Stats/Reports filter bar. Two visual rows — symbol/contract/session/
 * rating up top (the "what trade" axis) and outcome/side/weekday/hold/emotion/
 * model below (the "what kind of result / how you got there" axis). Each row
 * wraps individually on narrow screens.
 */
export function StatsFilterBar({
  filters,
  update,
}: {
  filters: TradeFilters
  update: (next: Partial<TradeFilters>) => void
}) {
  const accountId = useActiveAccountId()
  const models = useLiveQuery(() => listModels(accountId), [accountId], [])

  // Memoised so child FilterDropdowns don't see fresh array identity on every
  // keystroke / unrelated render. `listModels` already returns alphabetical.
  const modelOpts = useMemo(() => {
    const opts = (models ?? []).map(m => ({ value: m.id, label: m.name }))
    // Always offer the "no model" sentinel so the user can find untracked
    // (gambling) trades even on accounts that have no Model rows yet.
    opts.push({ value: MODEL_NONE, label: DEFAULT_MODEL_NAME })
    return opts
  }, [models])

  const emotionOpts = useMemo(() => EMOTIONS.map(e => ({ value: e, label: e })), [])

  return (
    <section className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-3 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From" className="w-[135px]">
          <DatePicker
            value={filters.from}
            onChange={v => update({ from: v })}
            placeholder="Any"
            clearable
            ariaLabel="From date"
          />
        </Field>
        <Field label="To" className="w-[135px]">
          <DatePicker
            value={filters.to}
            onChange={v => update({ to: v })}
            placeholder="Any"
            clearable
            ariaLabel="To date"
          />
        </Field>
        <Field label="Symbol">
          <Pills value={filters.symbol} onChange={v => update({ symbol: v })} options={SYMBOL_OPTS} />
        </Field>
        <Field label="Contract">
          <Pills value={filters.contract} onChange={v => update({ contract: v })} options={CONTRACT_OPTS} />
        </Field>
        <Field label="Session">
          <Pills value={filters.session} onChange={v => update({ session: v })} options={SESSION_OPTS} />
        </Field>
        <Field label="Rating">
          <RatingFilter value={filters.rating} onChange={v => update({ rating: v })} />
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Outcome">
          <Pills value={filters.outcome} onChange={v => update({ outcome: v })} options={OUTCOME_OPTS} />
        </Field>
        <Field label="Side">
          <Pills value={filters.side} onChange={v => update({ side: v })} options={SIDE_OPTS} />
        </Field>
        <Field label="Day">
          <Pills value={filters.weekday} onChange={v => update({ weekday: v })} options={WEEKDAY_OPTS} />
        </Field>
        <Field label="Duration">
          <FilterDropdown<HoldBucket>
            value={filters.hold}
            onChange={v => update({ hold: v })}
            options={HOLD_OPTS.filter(o => o.value !== null) as Array<{ value: HoldBucket; label: string }>}
          />
        </Field>
        <Field label="Emotion">
          <FilterDropdown<Emotion>
            value={filters.emotion}
            onChange={v => update({ emotion: v })}
            options={emotionOpts}
          />
        </Field>
        <Field label="Model">
          <FilterDropdown<string>
            value={filters.model}
            onChange={v => update({ model: v })}
            options={modelOpts}
          />
        </Field>
      </div>
    </section>
  )
}
