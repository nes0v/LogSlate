import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listAllTrades, listModels, listSymbols } from '@/db/queries'
import { useActiveAccountId } from '@/lib/active-account'
import { DEFAULT_MODEL_NAME, EMOTIONS, type Emotion } from '@/db/types'
import {
  HOLD_OPTS,
  OUTCOME_OPTS,
  SESSION_OPTS,
  SIDE_OPTS,
  WEEKDAY_OPTS,
} from '@/lib/filter-options'
import { readSymbolFilterCache, writeSymbolFilterCache } from '@/lib/symbol-filter-cache'
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
 * Shared Stats/Reports filter bar. Two visual rows — symbol/session/rating up
 * top (the "what trade" axis) and outcome/side/weekday/hold/emotion/
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
  // Warm the cache from inside the querier so it's written with the account the
  // query actually resolved for (an account switch can otherwise leave `symbols`
  // holding the previous account's list for a frame). The cached list is the
  // initial value on the next mount, killing the "pills appear late" flicker.
  // Seed only depends on the account, so parse localStorage once per account
  // instead of on every keystroke re-render.
  const symbolSeed = useMemo(() => readSymbolFilterCache(accountId) ?? [], [accountId])
  const symbols = useLiveQuery(
    async () => {
      const rows = await listSymbols(accountId)
      writeSymbolFilterCache(accountId, rows)
      return rows
    },
    [accountId],
    symbolSeed,
  )
  const trades = useLiveQuery(() => listAllTrades(accountId), [accountId], [])

  // Per-account symbol options, in the user's sidebar order, "All" first.
  // Drafts are hidden (they can't have trades logged against them).
  const symbolOpts = useMemo(
    () => [
      { value: null, label: 'All' },
      ...symbols.filter(s => !s.draft).map(s => ({ value: s.id, label: s.name })),
    ],
    [symbols],
  )

  // Memoised so child FilterDropdowns don't see fresh array identity on every
  // keystroke / unrelated render. `listModels` already returns alphabetical.
  const modelOpts = useMemo(() => {
    const opts = (models ?? [])
      .filter(m => !m.draft)
      .map(m => ({ value: m.id, label: m.name }))
    // Always offer the "no model" sentinel so the user can find untracked
    // (gambling) trades even on accounts that have no Model rows yet.
    opts.push({ value: MODEL_NONE, label: DEFAULT_MODEL_NAME })
    return opts
  }, [models])

  const emotionOpts = useMemo(() => EMOTIONS.map(e => ({ value: e, label: e })), [])

  // Distinct setup_tags from all trades for the current account, alphabetical.
  const tagOpts = useMemo(() => {
    const set = new Set<string>()
    for (const t of trades ?? []) {
      for (const tag of t.setup_tags ?? []) set.add(tag)
    }
    return Array.from(set).sort().map(tag => ({ value: tag, label: tag }))
  }, [trades])

  return (
    <section className="bg-(--color-panel) rounded-(--radius) p-3 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From" className="w-[135px]">
          <DatePicker
            value={filters.from}
            onChange={v => update({ from: v })}
            placeholder="Any"
            clearable
            disableWeekends
            ariaLabel="From date"
          />
        </Field>
        <Field label="To" className="w-[135px]">
          <DatePicker
            value={filters.to}
            onChange={v => update({ to: v })}
            placeholder="Any"
            clearable
            disableWeekends
            ariaLabel="To date"
          />
        </Field>
        <Field label="Symbol">
          <Pills value={filters.symbol_id} onChange={v => update({ symbol_id: v })} options={symbolOpts} />
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
        <Field label="Model">
          <FilterDropdown<string>
            value={filters.model}
            onChange={v => update({ model: v })}
            options={modelOpts}
          />
        </Field>
        <Field label="Emotion">
          <FilterDropdown<Emotion>
            value={filters.emotion}
            onChange={v => update({ emotion: v })}
            options={emotionOpts}
          />
        </Field>
        <Field label="Tags">
          <FilterDropdown<string>
            value={filters.tag}
            onChange={v => update({ tag: v })}
            options={tagOpts}
          />
        </Field>
      </div>
    </section>
  )
}
