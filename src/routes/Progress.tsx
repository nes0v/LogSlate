import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { addDays, format, getDay, isWeekend } from 'date-fns'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { db } from '@/db/schema'
import type { ProgressCheck, ProgressRule } from '@/db/types'
import {
  closePeriod,
  openPeriod,
  ruleActiveOn,
  ruleHasOpenPeriod,
} from '@/lib/progress-periods'
import { useActiveAccountId } from '@/lib/active-account'
import { Checkbox } from '@/components/form/Checkbox'
import { DatePicker } from '@/components/form/DatePicker'
import { RuleCheck } from '@/components/form/RuleCheck'
import { useConfirm } from '@/components/ConfirmDialog'
import { dateKeyToDate, nyToday } from '@/lib/tz'
import { cn } from '@/lib/utils'

function newId(): string {
  return crypto.randomUUID()
}

function checkId(accountId: string, date: string, ruleId: string): string {
  return `${accountId}:${date}:${ruleId}`
}

export function ProgressRoute() {
  const accountId = useActiveAccountId()
  const confirm = useConfirm()
  const today = nyToday()
  const [date, setDate] = useState(today)

  // No default values on the primary queries — `loaded` gates the
  // rendering of the score band + heat strip + checklist so we don't
  // flash zero adherence + "No active rules" before Dexie resolves.
  const rules = useLiveQuery(
    () =>
      db.progress_rules
        .where('account_id')
        .equals(accountId)
        .sortBy('sort'),
    [accountId],
  )
  const checksToday = useLiveQuery(
    () =>
      db.progress_checks
        .where('[account_id+date]')
        .equals([accountId, date])
        .toArray(),
    [accountId, date],
  )
  // Wide-enough calendar window to cover the last 30 *weekdays* with
  // headroom — 30 weekdays = 6 weeks ≈ 42 calendar days, 50 gives slack
  // for the edge cases where `date` lands on a Sunday.
  const heatWindowStart = useMemo(
    () => format(addDays(dateKeyToDate(date), -49), 'yyyy-MM-dd'),
    [date],
  )
  // Checks across the wider window — the heatmap walks back over 30
  // weekdays so the query has to reach further than 30 calendar days.
  const recent = useLiveQuery(
    () =>
      db.progress_checks
        .where('[account_id+date]')
        .between([accountId, heatWindowStart], [accountId, date], true, true)
        .toArray(),
    [accountId, date, heatWindowStart],
  )
  // Set of dates in the heat window that have at least one trade. Used
  // by the streak walk to skip non-trading days — weekdays where the
  // user didn't trade (sick day, holiday, etc.) shouldn't break a
  // streak, since there was no routine to follow.
  const tradedDays = useLiveQuery(
    async () => {
      const trades = await db.trades
        .where('[account_id+date]')
        .between([accountId, heatWindowStart], [accountId, date], true, true)
        .toArray()
      return new Set(trades.map(t => t.date))
    },
    [accountId, date, heatWindowStart],
  )
  // Gate every score tile / heat cell until all four queries resolve —
  // otherwise the streak briefly reads 0d before tradedDays loads and
  // the heat cells flicker empty before recent arrives.
  const loaded =
    rules !== undefined &&
    checksToday !== undefined &&
    recent !== undefined &&
    tradedDays !== undefined

  // Rules active on the currently-viewed date — drives the checklist
  // and today's-adherence tile.
  const rulesActiveOnDate = useMemo(
    () => (rules ?? []).filter(r => ruleActiveOn(r, date)),
    [rules, date],
  )
  const checkMap = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const c of checksToday ?? []) m.set(c.rule_id, c.checked)
    return m
  }, [checksToday])

  const adherenceToday = useMemo(() => {
    if (rulesActiveOnDate.length === 0) return null
    let n = 0
    for (const r of rulesActiveOnDate) if (checkMap.get(r.id)) n++
    return n / rulesActiveOnDate.length
  }, [rulesActiveOnDate, checkMap])

  // Per-day adherence over the last 30 *trading days* (weekdays).
  // Walking back this way keeps the strip a uniform 30 cells while
  // dropping weekends the market never opens for. Each cell's
  // denominator is the rule set that was active on that specific day,
  // so adding or retiring rules today doesn't disturb historical scores.
  const heat = useMemo(() => {
    const days: string[] = []
    let cursor = dateKeyToDate(date)
    while (days.length < 30) {
      if (!isWeekend(cursor)) {
        days.unshift(format(cursor, 'yyyy-MM-dd'))
      }
      cursor = addDays(cursor, -1)
    }
    const byDay = new Map<string, ProgressCheck[]>()
    for (const c of recent ?? []) {
      if (!byDay.has(c.date)) byDay.set(c.date, [])
      byDay.get(c.date)!.push(c)
    }
    const ruleList = rules ?? []
    return days.map(d => {
      const list = byDay.get(d) ?? []
      const activeIds = new Set(
        ruleList.filter(r => ruleActiveOn(r, d)).map(r => r.id),
      )
      const total = activeIds.size
      const checked = list.filter(c => c.checked && activeIds.has(c.rule_id)).length
      const pct = total > 0 ? checked / total : 0
      return { date: d, pct, checked, total }
    })
  }, [recent, date, rules])

  // Current streak — consecutive trailing trading days at 100%.
  // Weekends and weekdays without any trades are skipped (the market
  // was closed or the user wasn't trading, so there's no routine to
  // judge), neither extending nor breaking the streak. A traded day
  // with no active rules or pct < 100% does break it.
  const streak = useMemo(() => {
    let s = 0
    const traded = tradedDays ?? new Set<string>()
    for (let i = heat.length - 1; i >= 0; i--) {
      const cell = heat[i]
      if (isWeekend(dateKeyToDate(cell.date))) continue
      if (!traded.has(cell.date)) continue
      if (cell.total > 0 && cell.pct >= 1) s++
      else break
    }
    return s
  }, [heat, tradedDays])

  async function addRule() {
    const ts = new Date().toISOString()
    const sort = (rules ?? []).reduce((m, r) => Math.max(m, r.sort), 0) + 1
    // New rules start with no active periods — the user fills the text
    // in place and toggles the rule on, which opens its first period
    // from today. Until then the rule contributes nothing to any
    // day's denominator.
    const r: ProgressRule = {
      id: newId(),
      account_id: accountId,
      text: '',
      periods: [],
      sort,
      created_at: ts,
      updated_at: ts,
    }
    await db.progress_rules.put(r)
  }

  async function updateRule(id: string, patch: Partial<ProgressRule>) {
    await db.progress_rules.update(id, {
      ...patch,
      updated_at: new Date().toISOString(),
    })
  }

  async function setRuleActive(rule: ProgressRule, next: boolean) {
    const periods = next ? openPeriod(rule, today) : closePeriod(rule, today)
    await updateRule(rule.id, { periods })
  }

  async function restoreRule(rule: ProgressRule) {
    // Bring an archived rule back into today's checklist. Clears
    // `hidden` and opens a fresh period from today — past periods stay
    // exactly as they were, so historical adherence is unchanged and
    // the rule simply resumes from today forward.
    await updateRule(rule.id, {
      hidden: false,
      periods: openPeriod(rule, today),
    })
  }

  async function deleteRule(id: string) {
    const rule = (rules ?? []).find(r => r.id === id)
    if (!rule) return
    if (
      !(await confirm({
        title: 'Delete this rule?',
        description:
          "It'll be removed from the rule list and stop appearing on today's checklist. Past days keep this rule and your check history for it — nothing in the past changes.",
      }))
    )
      return
    // Cheap check: if the rule has never been checked anywhere, there's
    // no past data to preserve — hard-delete the row instead of leaving
    // a hidden tombstone. `rule_id` isn't indexed (schema v3 pruned the
    // index), so we filter-scan and short-circuit on first hit.
    let hasAnyChecks = false
    await db.progress_checks
      .filter(c => c.rule_id === id)
      .until(() => hasAnyChecks)
      .each(() => {
        hasAnyChecks = true
      })
    if (!hasAnyChecks) {
      await db.progress_rules.delete(id)
      return
    }
    // Soft delete via `hidden` + close any open period at yesterday.
    // The rule disappears from the rule manager and from today's
    // checklist (period closes), but its prior periods still anchor
    // the rule into past days so historical adherence is unchanged.
    await updateRule(id, {
      hidden: true,
      periods: closePeriod(rule, today),
    })
  }

  async function toggleCheck(rule: ProgressRule) {
    const id = checkId(accountId, date, rule.id)
    const current = checkMap.get(rule.id) ?? false
    if (current) {
      // Unchecking: delete the row outright. Read paths treat a missing
      // row identically to `checked: false`, so storing the false row is
      // pure write amplification — the table fills up with rows that
      // contribute nothing semantically and inflate the sync report.
      await db.progress_checks.delete(id)
      return
    }
    const ts = new Date().toISOString()
    const next: ProgressCheck = {
      id,
      account_id: accountId,
      date,
      rule_id: rule.id,
      checked: true,
      created_at: ts,
      updated_at: ts,
    }
    await db.progress_checks.put(next)
  }

  function shiftDate(delta: number) {
    setDate(format(addDays(dateKeyToDate(date), delta), 'yyyy-MM-dd'))
  }

  const isToday = date === today

  return (
    <div className="pt-1 space-y-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="h-8 flex items-center text-lg font-semibold">Progress</h1>
        <div className="flex items-center gap-1 text-sm">
          <button
            type="button"
            onClick={() => shiftDate(-1)}
            className="p-1.5 rounded text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
          >
            <ChevronLeft className="size-4" />
          </button>
          <DatePicker
            value={date}
            onChange={v => v && setDate(v)}
            compact
            ariaLabel="Selected date"
          />
          <button
            type="button"
            onClick={() => shiftDate(1)}
            className="p-1.5 rounded text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
          >
            <ChevronRight className="size-4" />
          </button>
          {!isToday && (
            <button
              type="button"
              onClick={() => setDate(today)}
              className="ml-1 px-2 py-1 text-xs rounded-(--radius) border border-(--color-border) text-(--color-text-dim) hover:text-(--color-text)"
            >
              Today
            </button>
          )}
        </div>
      </div>

      {!loaded ? null : (
        <>
      {/* Score band */}
      <section className="bg-(--color-panel) rounded-(--radius) p-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ScoreTile
          label="Today's adherence"
          value={
            adherenceToday === null
              ? '—'
              : `${Math.round(adherenceToday * 100)}%`
          }
          caption={
            adherenceToday === null
              ? 'Add some rules to get started'
              : `${rulesActiveOnDate.filter(r => checkMap.get(r.id)).length} / ${rulesActiveOnDate.length} rules`
          }
        />
        <ScoreTile
          label="Current streak"
          value={`${streak}d`}
          caption="consecutive 100% days"
        />
        <ScoreTile
          label="30-day average"
          value={(() => {
            // Same exclusion as the streak — average over traded
            // weekdays only. Weekends and untraded weekdays would
            // otherwise drag the score down to 0% on days where no
            // routine was ever expected.
            const traded = tradedDays ?? new Set<string>()
            const scored = heat.filter(
              d =>
                d.total > 0 &&
                !isWeekend(dateKeyToDate(d.date)) &&
                traded.has(d.date),
            )
            if (scored.length === 0) return '—'
            return `${Math.round(
              (scored.reduce((s, d) => s + d.pct, 0) / scored.length) * 100,
            )}%`
          })()}
          caption="traded weekdays only"
        />
      </section>

      {/* 30-day heat strip */}
      <section className="bg-(--color-panel) rounded-(--radius) p-3">
        <div className="text-xs uppercase tracking-wider text-(--color-text-dim) mb-2">
          Last 30 days
        </div>
        <div className="flex w-full gap-1">
          {heat.map((h, idx) => {
            // panel-2 is the default cell bg; the heatmap mixes the win
            // colour over it for days where rules were checked.
            const tone =
              h.total === 0 || h.pct === 0
                ? 'var(--color-panel-2)'
                : h.pct >= 1
                  ? `color-mix(in oklab, var(--color-win) 80%, var(--color-panel-2))`
                  : `color-mix(in oklab, var(--color-win) ${10 + h.pct * 60}%, var(--color-panel-2))`
            // Small left margin before each Monday so weeks read as
            // distinct chunks. Skip on the first cell — no preceding
            // day to separate from.
            const isMonday = getDay(dateKeyToDate(h.date)) === 1
            return (
              <button
                key={h.date}
                type="button"
                onClick={() => setDate(h.date)}
                title={`${h.date} · ${h.checked}/${h.total}`}
                className={cn(
                  'flex-1 min-w-0 aspect-square rounded-sm text-xs font-mono hover:opacity-80',
                  idx > 0 && isMonday && 'ms-3',
                  h.date === date
                    ? 'text-(--color-text) font-medium'
                    : 'text-(--color-text-dim)',
                )}
                style={{ backgroundColor: tone }}
              >
                {h.date.slice(8, 10)}
              </button>
            )
          })}
        </div>
      </section>

      {/* Rule list / today's checklist */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-(--color-panel) rounded-(--radius) p-3 space-y-2">
          <div className="text-sm font-medium mb-2">Today's checklist</div>
          {rulesActiveOnDate.length === 0 ? (
            <div className="text-xs text-(--color-text-dim) text-center py-6">
              No active rules on this day. Add some on the right →
            </div>
          ) : (
            <div className="space-y-1">
              {rulesActiveOnDate.map(r => (
                <RuleCheck
                  key={r.id}
                  checked={checkMap.get(r.id) ?? false}
                  onChange={() => toggleCheck(r)}
                  label={r.text}
                  archived={r.hidden === true}
                />
              ))}
            </div>
          )}
        </div>

        <RuleManager
          rules={(rules ?? []).filter(r => !r.hidden)}
          archived={(rules ?? []).filter(r => r.hidden === true)}
          onAdd={addRule}
          onUpdate={updateRule}
          onSetActive={setRuleActive}
          onDelete={deleteRule}
          onRestore={restoreRule}
          disabled={!isToday}
        />
      </section>
      </>
      )}
    </div>
  )
}

function ScoreTile({
  label,
  value,
  caption,
}: {
  label: string
  value: string
  caption: string
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-(--color-text-dim)">
        {label}
      </div>
      <div className="text-3xl font-mono font-medium tabular-nums mt-1">{value}</div>
      <div className="text-xs text-(--color-text-dim) mt-0.5">{caption}</div>
    </div>
  )
}

function RuleManager({
  rules,
  archived,
  onAdd,
  onUpdate,
  onSetActive,
  onDelete,
  onRestore,
  disabled,
}: {
  rules: ProgressRule[]
  archived: ProgressRule[]
  onAdd: () => void
  onUpdate: (id: string, patch: Partial<ProgressRule>) => void
  onSetActive: (rule: ProgressRule, next: boolean) => void
  onDelete: (id: string) => void
  onRestore: (rule: ProgressRule) => void
  disabled: boolean
}) {
  const [showArchived, setShowArchived] = useState(false)
  return (
    <div className="bg-(--color-panel) rounded-(--radius) p-3 space-y-2">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium">Rules</div>
        {disabled && (
          <div className="text-xs text-(--color-text-faint)">
            Switch to today to edit
          </div>
        )}
      </div>
      <div className={cn('space-y-1', disabled && 'opacity-50 pointer-events-none')}>
        {rules.map(r => (
          <RuleRow
            key={r.id}
            rule={r}
            onUpdate={onUpdate}
            onSetActive={onSetActive}
            onDelete={onDelete}
            disabled={disabled}
          />
        ))}
        {rules.length === 0 && (
          <div className="text-xs text-(--color-text-dim) text-center py-3">
            Examples: "Reviewed yesterday's trades", "No trading on red news",
            "Walked away after 2R loss".
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        className={cn(
          'text-xs inline-flex items-center gap-1 mt-1',
          disabled
            ? 'text-(--color-text-faint) cursor-not-allowed'
            : 'text-(--color-text-dim) hover:text-(--color-text)',
        )}
      >
        <Plus className="size-3" /> Add rule
      </button>
      {archived.length > 0 && (
        <div className="pt-2 mt-2 border-t border-(--color-panel-2)">
          <button
            type="button"
            onClick={() => setShowArchived(v => !v)}
            className="text-xs text-(--color-text-dim) hover:text-(--color-text) inline-flex items-center gap-1"
          >
            {showArchived ? '▾' : '▸'} {archived.length} archived rule{archived.length === 1 ? '' : 's'}
          </button>
          {showArchived && (
            <div className={cn('mt-2 space-y-1', disabled && 'opacity-50 pointer-events-none')}>
              {archived.map(r => (
                <div
                  key={r.id}
                  className="flex items-start gap-2 px-1 py-1 rounded-sm text-sm"
                >
                  <span className="flex-1 text-(--color-text-dim) italic line-through leading-tight">
                    {r.text || '(unnamed)'}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRestore(r)}
                    disabled={disabled}
                    className="text-xs text-(--color-text-dim) hover:text-(--color-text) shrink-0"
                    title="Restore — opens a new period from today; past adherence unchanged"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RuleRow({
  rule,
  onUpdate,
  onSetActive,
  onDelete,
  disabled,
}: {
  rule: ProgressRule
  onUpdate: (id: string, patch: Partial<ProgressRule>) => void
  onSetActive: (rule: ProgressRule, next: boolean) => void
  onDelete: (id: string) => void
  disabled: boolean
}) {
  // Local `text` state shadows `rule.text` so typing feels immediate
  // without re-rendering the whole list per keystroke. We re-sync from
  // `rule.text` when it changes from a different source (cross-device
  // sync via Drive) AND the input is not currently focused — matches
  // the DayNoteSection pattern so the user's in-flight edit isn't
  // clobbered by an incoming sync.
  const [text, setText] = useState(rule.text)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (document.activeElement === inputRef.current) return
    setText(rule.text)
  }, [rule.text])
  const isActive = ruleHasOpenPeriod(rule)
  return (
    <div className="flex items-start gap-2 px-1 py-1 rounded-sm">
      <span className="size-4 inline-flex items-center justify-center shrink-0 mt-px">
        <Checkbox
          size="sm"
          checked={isActive}
          onChange={e => onSetActive(rule, e.target.checked)}
          disabled={disabled}
          title={isActive ? 'Active — uncheck to retire from today forward' : 'Inactive'}
        />
      </span>
      <input
        ref={inputRef}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Rule…"
        disabled={disabled}
        onBlur={() => {
          const v = text.trim()
          if (v !== rule.text) onUpdate(rule.id, { text: v })
        }}
        className={cn(
          'flex-1 bg-transparent border-0 outline-none text-sm leading-tight p-0 placeholder:text-(--color-text-faint)',
          !isActive && 'text-(--color-text-dim)',
        )}
      />
      <button
        type="button"
        onClick={() => onDelete(rule.id)}
        disabled={disabled}
        className="rounded text-(--color-text-dim) hover:text-(--color-loss) shrink-0"
        title="Delete"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
