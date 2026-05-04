import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { addDays, format } from 'date-fns'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { db } from '@/db/schema'
import type { ProgressCheck, ProgressRule } from '@/db/types'
import { useActiveAccountId } from '@/lib/active-account'
import { Checkbox } from '@/components/form/Checkbox'
import { useConfirm } from '@/components/ConfirmDialog'
import { inputClass, inputClassCompact } from '@/components/form/Field'
import { nyToday } from '@/lib/tz'
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

  const rules = useLiveQuery(
    () =>
      db.progress_rules
        .where('account_id')
        .equals(accountId)
        .sortBy('sort'),
    [accountId],
    [],
  )
  const checksToday = useLiveQuery(
    () =>
      db.progress_checks
        .where('[account_id+date]')
        .equals([accountId, date])
        .toArray(),
    [accountId, date],
    [],
  )
  // Last 30 days of checks for the streak / heatmap.
  const recent = useLiveQuery(
    () => {
      const start = format(addDays(new Date(date + 'T00:00:00'), -29), 'yyyy-MM-dd')
      return db.progress_checks
        .where('[account_id+date]')
        .between([accountId, start], [accountId, date], true, true)
        .toArray()
    },
    [accountId, date],
    [],
  )

  const activeRules = useMemo(
    () => (rules ?? []).filter(r => r.active),
    [rules],
  )
  const checkMap = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const c of checksToday ?? []) m.set(c.rule_id, c.checked)
    return m
  }, [checksToday])

  const adherenceToday = useMemo(() => {
    if (activeRules.length === 0) return null
    let n = 0
    for (const r of activeRules) if (checkMap.get(r.id)) n++
    return n / activeRules.length
  }, [activeRules, checkMap])

  // Per-day adherence over the last 30 days for the strip.
  const heat = useMemo(() => {
    const days: string[] = []
    for (let i = 29; i >= 0; i--) {
      days.push(format(addDays(new Date(date + 'T00:00:00'), -i), 'yyyy-MM-dd'))
    }
    const byDay = new Map<string, ProgressCheck[]>()
    for (const c of recent ?? []) {
      if (!byDay.has(c.date)) byDay.set(c.date, [])
      byDay.get(c.date)!.push(c)
    }
    return days.map(d => {
      const list = byDay.get(d) ?? []
      // Only count rules that were active that day. We don't track per-rule
      // activation history yet, so use the *current* active set as a proxy —
      // good enough for an ongoing routine.
      const total = activeRules.length
      const checked = list.filter(c => c.checked).length
      const pct = total > 0 ? checked / total : 0
      return { date: d, pct, checked, total }
    })
  }, [recent, date, activeRules])

  // Current streak — consecutive trailing days at 100%.
  const streak = useMemo(() => {
    let s = 0
    for (let i = heat.length - 1; i >= 0; i--) {
      if (heat[i].total > 0 && heat[i].pct >= 1) s++
      else break
    }
    return s
  }, [heat])

  async function addRule(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    const ts = new Date().toISOString()
    const sort = ((rules ?? []).reduce((m, r) => Math.max(m, r.sort), 0) ?? 0) + 1
    const r: ProgressRule = {
      id: newId(),
      account_id: accountId,
      text: trimmed,
      active: true,
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

  async function deleteRule(id: string) {
    if (
      !(await confirm({
        title: 'Delete this rule?',
        description: 'Past checks will be hidden but kept.',
      }))
    )
      return
    await db.progress_rules.delete(id)
  }

  async function toggleCheck(rule: ProgressRule) {
    const id = checkId(accountId, date, rule.id)
    const current = checkMap.get(rule.id) ?? false
    const ts = new Date().toISOString()
    const next: ProgressCheck = {
      id,
      account_id: accountId,
      date,
      rule_id: rule.id,
      checked: !current,
      created_at: ts,
      updated_at: ts,
    }
    await db.progress_checks.put(next)
  }

  function shiftDate(delta: number) {
    setDate(format(addDays(new Date(date + 'T00:00:00'), delta), 'yyyy-MM-dd'))
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
          <input
            type="date"
            value={date}
            onChange={e => e.target.value && setDate(e.target.value)}
            className={inputClassCompact}
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

      {/* Score band */}
      <section className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
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
              : `${activeRules.filter(r => checkMap.get(r.id)).length} / ${activeRules.length} rules`
          }
        />
        <ScoreTile
          label="Current streak"
          value={`${streak}d`}
          caption="consecutive 100% days"
        />
        <ScoreTile
          label="30-day average"
          value={
            heat.filter(d => d.total > 0).length === 0
              ? '—'
              : `${Math.round(
                  (heat.reduce((s, d) => s + d.pct, 0) /
                    Math.max(1, heat.filter(d => d.total > 0).length)) *
                    100,
                )}%`
          }
          caption="rolling discipline"
        />
      </section>

      {/* 30-day heat strip */}
      <section className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-3">
        <div className="text-xs uppercase tracking-wider text-(--color-text-dim) mb-2">
          Last 30 days
        </div>
        <div className="grid grid-cols-30 gap-1" style={{ gridTemplateColumns: 'repeat(30, minmax(0, 1fr))' }}>
          {heat.map(h => {
            const tone =
              h.total === 0
                ? 'transparent'
                : h.pct >= 1
                  ? `color-mix(in oklab, var(--color-win) 80%, transparent)`
                  : h.pct > 0
                    ? `color-mix(in oklab, var(--color-win) ${10 + h.pct * 60}%, transparent)`
                    : 'var(--color-panel-2)'
            return (
              <button
                key={h.date}
                type="button"
                onClick={() => setDate(h.date)}
                title={`${h.date} · ${h.checked}/${h.total}`}
                className={cn(
                  'aspect-square rounded-sm text-xs font-mono text-(--color-text-dim) hover:opacity-80',
                  h.date === date && 'ring-1 ring-(--color-accent)',
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
        <div className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-3 space-y-2">
          <div className="text-sm font-medium mb-1">Today's checklist</div>
          {activeRules.length === 0 ? (
            <div className="text-xs text-(--color-text-dim) text-center py-6">
              No active rules. Add some on the right →
            </div>
          ) : (
            <div className="space-y-1">
              {activeRules.map(r => {
                const checked = checkMap.get(r.id) ?? false
                return (
                  <label
                    key={r.id}
                    className={cn(
                      'flex items-start gap-2 px-1 py-1 rounded-sm cursor-pointer hover:bg-(--color-panel-3)',
                      checked && 'opacity-60',
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onChange={() => toggleCheck(r)}
                      className="mt-0.5"
                    />
                    <span
                      className={cn(
                        'text-sm',
                        checked && 'line-through text-(--color-text-dim)',
                      )}
                    >
                      {r.text}
                    </span>
                  </label>
                )
              })}
            </div>
          )}
        </div>

        <RuleManager
          rules={rules ?? []}
          onAdd={addRule}
          onUpdate={updateRule}
          onDelete={deleteRule}
        />
      </section>
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
  onAdd,
  onUpdate,
  onDelete,
}: {
  rules: ProgressRule[]
  onAdd: (text: string) => void
  onUpdate: (id: string, patch: Partial<ProgressRule>) => void
  onDelete: (id: string) => void
}) {
  const [draft, setDraft] = useState('')
  return (
    <div className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-3 space-y-2">
      <div className="text-sm font-medium mb-1">Rules</div>
      <form
        onSubmit={e => {
          e.preventDefault()
          onAdd(draft)
          setDraft('')
        }}
        className="flex items-center gap-1"
      >
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Add a rule…"
          className={cn(inputClass, 'flex-1')}
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="p-1.5 rounded text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2) disabled:opacity-40"
          title="Add"
        >
          <Plus className="size-4" />
        </button>
      </form>
      <div className="space-y-1">
        {rules.map(r => (
          <div
            key={r.id}
            className="flex items-center gap-2 px-1 py-1 rounded-sm hover:bg-(--color-panel-3)"
          >
            <Checkbox
              checked={r.active}
              onChange={e => onUpdate(r.id, { active: e.target.checked })}
              title={r.active ? 'Active — uncheck to pause' : 'Inactive'}
            />
            <input
              defaultValue={r.text}
              onBlur={e => {
                const v = e.target.value.trim()
                if (v && v !== r.text) onUpdate(r.id, { text: v })
              }}
              className={cn(
                'flex-1 bg-transparent border-0 outline-none text-sm',
                !r.active && 'text-(--color-text-dim) italic',
              )}
            />
            <button
              type="button"
              onClick={() => onDelete(r.id)}
              className="p-1 rounded text-(--color-text-dim) hover:text-(--color-loss)"
              title="Delete"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        {rules.length === 0 && (
          <div className="text-xs text-(--color-text-dim) text-center py-3">
            Examples: "Reviewed yesterday's trades", "No trading on red news",
            "Walked away after 2R loss".
          </div>
        )}
      </div>
    </div>
  )
}
