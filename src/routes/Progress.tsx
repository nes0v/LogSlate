import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addDays,
  differenceInCalendarDays,
  format,
  getDay,
  isWeekend,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { db } from '@/db/schema'
import type { ProgressCheck, ProgressRule } from '@/db/types'
import {
  closePeriod,
  lastPeriodEnd,
  openPeriod,
  openPeriodStart,
  ruleActiveOn,
  ruleHasOpenPeriod,
} from '@/lib/progress-periods'
import { useActiveAccountId } from '@/lib/active-account'
import { Checkbox } from '@/components/form/Checkbox'
import { DatePicker } from '@/components/form/DatePicker'
import { RuleCheck } from '@/components/form/RuleCheck'
import { useConfirm } from '@/components/ConfirmDialog'
import { BTN_ACCENT } from '@/components/form/buttonClass'
import { useAccountQuery } from '@/lib/use-account-query'
import { dateKeyToDate, nyToday } from '@/lib/tz'
import {
  canEditRulesOn,
  canNavigateTo,
  isFutureDay,
  landingDayFor,
  marketOpenOn,
  nextSessionFor,
} from '@/lib/progress-day'
import { cn } from '@/lib/utils'

function newId(): string {
  return crypto.randomUUID()
}

function checkId(accountId: string, date: string, ruleId: string): string {
  return `${accountId}:${date}:${ruleId}`
}

// "Mon" reads naturally a day or two either side of the day on screen. Much
// further out and a bare weekday name is ambiguous — which Monday? — so fall
// back to a dated label.
function relativeDayLabel(key: string, relativeTo: string): string {
  const gap = Math.abs(
    differenceInCalendarDays(dateKeyToDate(key), dateKeyToDate(relativeTo)),
  )
  return format(dateKeyToDate(key), gap <= 6 ? 'EEE' : 'd MMM')
}

export function ProgressRoute() {
  const accountId = useActiveAccountId()
  const confirm = useConfirm()
  const today = nyToday()
  // Every day-rule the page runs on, decided once and up front so nothing
  // below can read one before it exists. What each means — and why landing on
  // Friday is NOT the same as Friday still being open — is in progress-day.ts,
  // along with the tests that pin them.
  const tradingToday = landingDayFor(today)
  const nextSessionKey = nextSessionFor(today)
  const marketOpen = marketOpenOn(today)
  const [date, setDate] = useState(tradingToday)
  // A future day's checklist previews what that session will ask of you. It
  // is not something to fill in ahead of time, or to score.
  const isFuture = isFutureDay(date, today)

  // No default values on the primary queries — `loaded` gates the
  // rendering of the score band + heat strip + checklist so we don't
  // flash zero adherence + "No active rules" before Dexie resolves.
  const rules = useAccountQuery(accountId, () =>
    db.progress_rules.where('account_id').equals(accountId).sortBy('sort'),
  )
  // Account-wide, deliberately NOT scoped to the selected date: a query keyed
  // on `date` hands back the previous day's rows for one render (see
  // `useAccountQuery`), which painted the previous day's ticks before clearing
  // them. Stepping days now changes no query dep; the date slicing happens in
  // the memos below.
  const allChecks = useAccountQuery(accountId, () =>
    db.progress_checks.where('account_id').equals(accountId).toArray(),
  )
  // Wide-enough calendar window to cover the last 30 *weekdays* with
  // headroom — 30 weekdays = 6 weeks ≈ 42 calendar days, 50 gives slack
  // for the edge cases where `date` lands on a Sunday.
  const heatWindowStart = useMemo(
    () => format(addDays(dateKeyToDate(date), -49), 'yyyy-MM-dd'),
    [date],
  )
  const checksToday = useMemo(
    () => (allChecks ?? []).filter(c => c.date === date),
    [allChecks, date],
  )
  // Checks across the wider window — the heatmap walks back over 30
  // weekdays so this has to reach further than 30 calendar days.
  const recent = useMemo(
    () => (allChecks ?? []).filter(c => c.date >= heatWindowStart && c.date <= date),
    [allChecks, heatWindowStart, date],
  )
  // Every date the user actually traded — at least one trade OR a day-level
  // PNL override (a tilt day logged as one net figure instead of individual
  // trades still counts as a traded day). Used by the streak walk to skip
  // non-trading days — weekdays where the user didn't trade (sick day,
  // holiday, etc.) shouldn't break a streak, since there was no routine to
  // follow. Reads INDEX KEYS rather than trade records: only the date matters,
  // so there's no reason to deserialize every trade in the account.
  const tradedDays = useAccountQuery(accountId, async () => {
    const set = new Set<string>()
    const keys = await db.trades
      .where('[account_id+date]')
      .between([accountId, ''], [accountId, '￿'], true, true)
      .keys()
    // Compound `[account_id+date]` keys come back as [account, date] pairs.
    for (const k of keys) set.add((k as unknown as [string, string])[1])
    const dayRows = await db.days.where('account_id').equals(accountId).toArray()
    for (const d of dayRows) {
      if (typeof d.pnl_override === 'number') set.add(d.date)
    }
    return set
  })
  // Gate every score tile / heat cell until all three queries resolve —
  // otherwise the streak briefly reads 0d before tradedDays loads and
  // the heat cells flicker empty before the checks arrive.
  const loaded =
    rules !== undefined && allChecks !== undefined && tradedDays !== undefined

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

  const adherenceRatio = useMemo(() => {
    if (rulesActiveOnDate.length === 0) return null
    let n = 0
    for (const r of rulesActiveOnDate) if (checkMap.get(r.id)) n++
    return n / rulesActiveOnDate.length
  }, [rulesActiveOnDate, checkMap])
  // Null means "no score to show" — rendered as an em dash. A day that hasn't
  // happened has no adherence yet: scoring it 0% would read as a session
  // already failed, which is exactly backwards when the user is sitting on
  // the next session's page planning it.
  const adherenceToday = isFuture ? null : adherenceRatio

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
    // from the day on screen. Until then the rule contributes nothing to
    // any day's denominator.
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

  // Rule edits apply to the day being VIEWED, not the calendar day. That's
  // what makes planning the next session honest: on a Sunday you step to
  // Monday and the rule you switch on starts Monday, visible in the
  // checklist beside the panel. Editing is gated to today + the next
  // session (`canEditRules`), so `date` here is never an arbitrary date.
  async function setRuleActive(rule: ProgressRule, next: boolean) {
    const periods = next ? openPeriod(rule, date) : closePeriod(rule, date)
    await updateRule(rule.id, { periods })
  }

  async function restoreRule(rule: ProgressRule) {
    // Bring an archived rule back into the checklist for the day on
    // screen. Clears `hidden` and opens a fresh period from that day —
    // past periods stay exactly as they were, so historical adherence is
    // unchanged and the rule simply resumes from there forward.
    await updateRule(rule.id, {
      hidden: false,
      periods: openPeriod(rule, date),
    })
  }

  async function deleteRule(id: string) {
    const snapshot = (rules ?? []).find(r => r.id === id)
    if (!snapshot) return
    if (
      !(await confirm({
        title: 'Delete this rule?',
        description:
          "It'll be removed from the rule list and stop appearing on the checklist from this day on. Past days keep this rule and your check history for it — nothing in the past changes.",
      }))
    )
      return
    // Re-fetch the rule INSIDE the transaction before reading periods —
    // the live-query snapshot can be stale (the user may have toggled
    // active or edited text between the page rendering and clicking
    // X). All reads + writes share one rw transaction so the rule
    // either vanishes cleanly or stays intact; a write landing in the
    // middle can't leave orphan check rows. `rule_id` isn't indexed
    // (schema v3 pruned the index), so we filter-scan with an early-
    // exit `.until()` on first hit.
    await db.transaction('rw', db.progress_rules, db.progress_checks, async () => {
      const fresh = await db.progress_rules.get(id)
      if (!fresh) return
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
      // The rule disappears from the rule manager and from the checklist
      // for the day on screen (period closes), but its prior periods still
      // anchor the rule into past days so historical adherence is unchanged.
      await db.progress_rules.update(id, {
        hidden: true,
        periods: closePeriod(fresh, date),
        updated_at: new Date().toISOString(),
      })
    })
  }

  async function toggleCheck(rule: ProgressRule) {
    // Progress is weekday-only — a weekend-dated check row is unreadable by
    // every consumer (heat strip, streak and the 30-day average all skip
    // Sat/Sun) and unreachable afterwards, so it can only ever be orphan
    // data. No navigation path reaches a weekend any more; this is the
    // backstop for the ones that don't go through navigation at all.
    if (isWeekend(dateKeyToDate(date))) return
    // Nor on a day that hasn't happened. The next session's page is
    // editable so rules can be planned there, which puts a live checklist
    // in front of the user a day early — ticking it would bank adherence
    // for a session they haven't traded.
    if (isFutureDay(date, today)) return
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
    // Futures don't trade Sat/Sun, so progress checks aren't meaningful
    // on those days — skip past weekends in one click.
    let cursor = dateKeyToDate(date)
    do {
      cursor = addDays(cursor, delta)
    } while (isWeekend(cursor))
    const next = format(cursor, 'yyyy-MM-dd')
    // Forward stops at the next session — the furthest day anything can be
    // done on. Past it every control is inert (rules locked, checklist
    // preview-only, adherence blank) and the heat strip degenerates into a
    // block of empty cells, since it always shows the 30 weekdays running
    // back from the selected day. The past stays unbounded: that's where the
    // history is. The arrow is disabled at the edge rather than silently
    // refusing, so the boundary is visible.
    if (!canNavigateTo(next, today)) return
    setDate(next)
  }

  // Navigation: hides the Today button when there's nowhere to go back to.
  const isLandingDay = date === tradingToday
  const nextSessionLabel = format(dateKeyToDate(nextSessionKey), 'EEEE')
  const canEditRules = canEditRulesOn(date, today)
  // "Today's X" is a lie on every other date — a past day being reviewed, or
  // the next session being planned. The date picker in the header already
  // names which day, so the generic label is enough.
  const isCurrentDay = date === today

  return (
    <div className="pt-1 space-y-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="h-8 flex items-center text-lg font-semibold">Progress</h1>
        <div className="flex items-center gap-1 text-sm">
          {!isLandingDay && (
            <button
              type="button"
              onClick={() => setDate(tradingToday)}
              className={cn(BTN_ACCENT, 'mr-1')}
            >
              Today
            </button>
          )}
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
            disableWeekends
            max={nextSessionKey}
            ariaLabel="Selected date"
          />
          <button
            type="button"
            onClick={() => shiftDate(1)}
            disabled={date >= nextSessionKey}
            title={
              date >= nextSessionKey
                ? `${nextSessionLabel} is the furthest ahead you can go`
                : undefined
            }
            className="p-1.5 rounded text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2) disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-(--color-text-dim)"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {!loaded ? null : (
        <>
      {/* Score band */}
      <section className="bg-(--color-panel) rounded-(--radius) p-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ScoreTile
          label={isCurrentDay ? "Today's adherence" : 'Adherence'}
          value={
            adherenceToday === null
              ? '—'
              : `${Math.round(adherenceToday * 100)}%`
          }
          caption={
            rulesActiveOnDate.length === 0
              ? 'Add some rules to get started'
              : isFuture
                ? `${rulesActiveOnDate.length} rule${rulesActiveOnDate.length === 1 ? '' : 's'} planned`
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
            // panel-2 is the default cell bg; the heatmap mixes --color-heat
            // over it for days where rules were checked.
            const tone =
              h.total === 0 || h.pct === 0
                ? 'var(--color-panel-2)'
                : h.pct >= 1
                  ? `color-mix(in oklab, var(--color-heat) 80%, var(--color-panel-2))`
                  : `color-mix(in oklab, var(--color-heat) ${10 + h.pct * 60}%, var(--color-panel-2))`
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
                  h.date === tradingToday
                    ? 'text-(--color-text) font-bold'
                    : h.total > 0 && h.pct > 0
                      ? 'text-(--color-text)'
                      : h.date === date
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
          <div className="text-sm font-medium mb-2">
            {isCurrentDay ? "Today's checklist" : 'Checklist'}
          </div>
          {rulesActiveOnDate.length === 0 ? (
            <div className="text-xs text-(--color-text-dim) text-center py-3">
              {canEditRules
                ? 'No active rules on this day. Add some on the right →'
                : 'No active rules on this day.'}
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
                  disabled={isFuture}
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
          date={date}
          disabled={!canEditRules}
          lockedReason={
            marketOpen ? 'Switch to today to edit' : 'Closed for the weekend'
          }
          // Only the weekend needs the jump: there's no Today button then,
          // because Friday already IS the landing day. On a weekday a locked
          // panel means you're off on some other date, and the header's Today
          // button is the way back.
          onPlanNext={
            !canEditRules && !marketOpen
              ? () => setDate(nextSessionKey)
              : undefined
          }
          planNextLabel={`Plan ${nextSessionLabel} →`}
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
  date,
  disabled,
  lockedReason,
  onPlanNext,
  planNextLabel,
}: {
  rules: ProgressRule[]
  archived: ProgressRule[]
  onAdd: () => void
  onUpdate: (id: string, patch: Partial<ProgressRule>) => void
  onSetActive: (rule: ProgressRule, next: boolean) => void
  onDelete: (id: string) => void
  onRestore: (rule: ProgressRule) => void
  /** The day on screen — a rule row needs it to say whether the rule has
   *  started yet as of that day. */
  date: string
  disabled: boolean
  lockedReason: string
  /** Jump to the next trading day, where editing IS allowed. Without it a
   *  locked weekend panel is a dead end: there's no Today button to fall
   *  back on, because Friday already IS the landing day. */
  onPlanNext?: () => void
  planNextLabel: string
}) {
  const [showArchived, setShowArchived] = useState(false)
  return (
    <div className="bg-(--color-panel) rounded-(--radius) p-3 space-y-2">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium">Rules</div>
        {disabled &&
          (onPlanNext ? (
            <button
              type="button"
              onClick={onPlanNext}
              className="text-xs text-(--color-text-dim) hover:text-(--color-text)"
            >
              {planNextLabel}
            </button>
          ) : (
            <div className="text-xs text-(--color-text-faint)">{lockedReason}</div>
          ))}
      </div>
      {/* Dimmed but still hoverable: every control inside carries its own
          `disabled`, so the panel is inert without `pointer-events-none` —
          which would also swallow the hover that surfaces each row's
          tooltip, exactly when the panel is locked and the tooltip is the
          only thing left explaining the row. */}
      <div className={cn('space-y-1', disabled && 'opacity-50')}>
        {rules.map(r => (
          <RuleRow
            key={r.id}
            rule={r}
            onUpdate={onUpdate}
            onSetActive={onSetActive}
            onDelete={onDelete}
            date={date}
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
            <div className={cn('mt-2 space-y-1', disabled && 'opacity-50')}>
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
                    title="Restore — opens a new period from the day on screen; past adherence unchanged"
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
  date,
  disabled,
}: {
  rule: ProgressRule
  onUpdate: (id: string, patch: Partial<ProgressRule>) => void
  onSetActive: (rule: ProgressRule, next: boolean) => void
  onDelete: (id: string) => void
  date: string
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
  const liveToday = ruleActiveOn(rule, date)
  // The checkbox answers "is this rule retired?", which carries no date. The
  // checklist beside it answers "is it in force on the day I'm looking at?".
  // Those agreed until rules could be scheduled ahead; now they can diverge
  // in BOTH directions, and each looks like a bug on its own:
  //
  //   ticked + absent from the checklist  -> switched on for a later session
  //   unticked + present in the checklist -> retired from a later session,
  //                                          so today still counts it
  //
  // Date-scoping the checkbox would fix the look and break the switch, since
  // turning on an already-open rule is a no-op. So name the boundary instead
  // and let the two panels read as one statement.
  const scheduledOn = isActive && !liveToday
  const scheduledOff = !isActive && liveToday
  const startsOn = openPeriodStart(rule)
  const endsOn = lastPeriodEnd(rule)
  // `scheduledOn` implies an open period, `scheduledOff` implies a closed
  // one, so the matching date is always present in the branch that reads it.
  const edgeLabel =
    scheduledOn && startsOn
      ? relativeDayLabel(startsOn, date)
      : scheduledOff && endsOn
        ? relativeDayLabel(endsOn, date)
        : null
  const viewedLabel = relativeDayLabel(date, date)
  // Split so a locked panel states the rule's status without promising an
  // action the user can't take — the tooltip matters MOST when locked, since
  // that's when the row is read-only and has only itself to explain it.
  const state = scheduledOn
    ? `Starts ${edgeLabel}`
    : scheduledOff
      ? `Runs until ${edgeLabel}`
      : isActive
        ? 'Active'
        : 'Retired'
  const action = scheduledOn
    ? 'untick to cancel'
    : scheduledOff
      ? 'tick to keep it'
      : isActive
        ? `untick to drop it from ${viewedLabel} on`
        : `tick to start it ${viewedLabel}`
  const tooltip = disabled ? state : `${state} — ${action}`
  return (
    <div className="flex items-start gap-2 px-1 py-1 rounded-sm">
      <span
        className="size-4 inline-flex items-center justify-center shrink-0 mt-px"
        title={tooltip}
      >
        <Checkbox
          size="sm"
          checked={isActive}
          onChange={e => onSetActive(rule, e.target.checked)}
          disabled={disabled}
          title={tooltip}
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
          (!isActive || scheduledOn) && 'text-(--color-text-dim)',
        )}
      />
      {edgeLabel && (
        <span
          className="text-xs text-(--color-text-faint) shrink-0 mt-px"
          title={tooltip}
        >
          {scheduledOn ? 'from' : 'until'} {edgeLabel}
        </span>
      )}
      <button
        type="button"
        onClick={() => onDelete(rule.id)}
        disabled={disabled}
        className="rounded text-(--color-text-dim) hover:text-(--color-loss) shrink-0 disabled:cursor-not-allowed disabled:hover:text-(--color-text-dim)"
        title="Delete"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
