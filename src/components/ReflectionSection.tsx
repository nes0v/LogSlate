import { useMemo, useState } from 'react'
import { Controller, type Control } from 'react-hook-form'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { useActiveAccountId } from '@/lib/active-account'
import {
  EMOTIONS,
  MARKET_CONDITIONS,
  type Emotion,
  type MarketCondition,
} from '@/db/types'
import type { TradeFormValues } from '@/lib/form-schema'
import { Field, inputClass } from '@/components/form/Field'
import { Pills } from '@/components/form/Pills'
import { cn } from '@/lib/utils'

const CONVICTION_OPTS = [
  { value: null, label: '—' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' },
] satisfies Array<{ value: number | null; label: string }>

interface ReflectionSectionProps {
  control: Control<TradeFormValues>
  /** Watched form values, so the playbook-rule list can react to selection. */
  values: TradeFormValues
}

export function ReflectionSection({ control, values }: ReflectionSectionProps) {
  // Open by default — reflection fields are part of a complete trade
  // record, not optional add-ons. The toggle is still available for
  // quick-entry flows that don't need them.
  void values
  const [open, setOpen] = useState(true)

  const accountId = useActiveAccountId()
  const playbooks = useLiveQuery(
    async () => {
      const rows = await db.playbooks.where('account_id').equals(accountId).toArray()
      return rows.filter(p => !p.archived)
    },
    [accountId],
    [],
  )
  const activePlaybook = useMemo(
    () => (playbooks ?? []).find(p => p.id === values.playbook_id) ?? null,
    [playbooks, values.playbook_id],
  )

  return (
    <section className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs)">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-(--color-panel-2)/40"
      >
        <span>Reflection</span>
        <span className="flex items-center gap-2 text-(--color-text-dim) text-xs font-normal">
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </span>
      </button>
      {open && (
        <div className="p-3 space-y-4 border-t border-(--color-border)">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Profit target ($)" hint="Optional">
              <Controller
                control={control}
                name="profit_target"
                render={({ field }) => (
                  <input
                    type="number"
                    step="0.01"
                    className={inputClass}
                    value={field.value ?? ''}
                    onChange={e =>
                      field.onChange(e.target.value === '' ? null : Number(e.target.value))
                    }
                  />
                )}
              />
            </Field>
            <Field label="Conviction (1-5)">
              <Controller
                control={control}
                name="conviction"
                render={({ field }) => (
                  <Pills
                    value={field.value as number | null}
                    onChange={field.onChange}
                    options={CONVICTION_OPTS}
                  />
                )}
              />
            </Field>
            <Field label="Emotion">
              <Controller
                control={control}
                name="emotion"
                render={({ field }) => (
                  <select
                    className={inputClass}
                    value={field.value ?? ''}
                    onChange={e => field.onChange((e.target.value || null) as Emotion | null)}
                  >
                    <option value="">—</option>
                    {EMOTIONS.map(e => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                )}
              />
            </Field>
            <Field label="Market">
              <Controller
                control={control}
                name="market_condition"
                render={({ field }) => (
                  <select
                    className={inputClass}
                    value={field.value ?? ''}
                    onChange={e =>
                      field.onChange((e.target.value || null) as MarketCondition | null)
                    }
                  >
                    <option value="">—</option>
                    {MARKET_CONDITIONS.map(m => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                )}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Setup tags">
              <Controller
                control={control}
                name="setup_tags"
                render={({ field }) => (
                  <TagInput
                    value={field.value ?? []}
                    onChange={field.onChange}
                    placeholder="breakout, trend cont, reversal…"
                    tone="neutral"
                  />
                )}
              />
            </Field>
            <Field label="Mistake tags" hint="What went wrong">
              <Controller
                control={control}
                name="mistake_tags"
                render={({ field }) => (
                  <TagInput
                    value={field.value ?? []}
                    onChange={field.onChange}
                    placeholder="moved stop, FOMO, took early exit…"
                    tone="loss"
                  />
                )}
              />
            </Field>
          </div>

          {(playbooks?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <Field label="Playbook">
                <Controller
                  control={control}
                  name="playbook_id"
                  render={({ field }) => (
                    <select
                      className={inputClass}
                      value={field.value ?? ''}
                      onChange={e => {
                        const v = e.target.value || null
                        field.onChange(v)
                      }}
                    >
                      <option value="">— none —</option>
                      {(playbooks ?? []).map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                />
              </Field>
              {activePlaybook && (
                <Controller
                  control={control}
                  name="playbook_rules_followed"
                  render={({ field }) => (
                    <PlaybookRuleChecklist
                      groups={activePlaybook.groups}
                      followed={field.value ?? []}
                      onChange={field.onChange}
                    />
                  )}
                />
              )}
            </div>
          )}

          <Field label="Notes" hint="Post-trade thoughts (markdown ok)">
            <Controller
              control={control}
              name="notes"
              render={({ field }) => (
                <textarea
                  {...field}
                  value={field.value ?? ''}
                  className={cn(inputClass, 'min-h-32 resize-y font-mono text-xs')}
                  placeholder="What did I learn? What would I do differently?"
                />
              )}
            />
          </Field>
        </div>
      )}
    </section>
  )
}

interface TagInputProps {
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  tone?: 'neutral' | 'loss' | 'win'
}
function TagInput({ value, onChange, placeholder, tone = 'neutral' }: TagInputProps) {
  const [draft, setDraft] = useState('')
  function commit(text: string) {
    const t = text.trim()
    if (!t || value.includes(t)) {
      setDraft('')
      return
    }
    onChange([...value, t])
    setDraft('')
  }
  function remove(t: string) {
    onChange(value.filter(v => v !== t))
  }
  return (
    <div className="flex flex-wrap items-center gap-1 bg-(--color-bg) rounded-(--radius) px-2 py-1.5 min-h-[36px] focus-within:ring-2 focus-within:ring-(--color-accent-soft) transition-colors">
      {value.map(t => (
        <span
          key={t}
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs',
            tone === 'loss' && 'bg-(--color-loss)/15 text-(--color-loss)',
            tone === 'win' && 'bg-(--color-win)/15 text-(--color-win)',
            tone === 'neutral' && 'bg-(--color-panel-2) text-(--color-text)',
          )}
        >
          {t}
          <button
            type="button"
            onClick={() => remove(t)}
            className="text-(--color-text-dim) hover:text-(--color-text)"
            aria-label={`Remove tag ${t}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit(draft)
          } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
            onChange(value.slice(0, -1))
          }
        }}
        onBlur={() => commit(draft)}
        placeholder={value.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[80px] bg-transparent border-0 outline-none text-sm"
      />
    </div>
  )
}

function PlaybookRuleChecklist({
  groups,
  followed,
  onChange,
}: {
  groups: Array<{ id: string; name: string; rules: string[] }>
  followed: string[]
  onChange: (v: string[]) => void
}) {
  const set = useMemo(() => new Set(followed), [followed])
  function toggle(rule: string, on: boolean) {
    if (on) onChange([...new Set([...followed, rule])])
    else onChange(followed.filter(r => r !== rule))
  }
  const total = groups.reduce((n, g) => n + g.rules.length, 0)
  if (total === 0) {
    return (
      <div className="text-xs text-(--color-text-dim) italic px-2">
        This playbook has no rules yet.
      </div>
    )
  }
  return (
    <div className="bg-(--color-panel-2) rounded-(--radius) p-3 space-y-2">
      <div className="text-xs uppercase tracking-wider text-(--color-text-dim) flex items-center justify-between">
        <span>Rules followed</span>
        <span className="font-mono normal-case">
          {set.size} / {total}
        </span>
      </div>
      {groups.map(g => (
        <div key={g.id} className="space-y-0.5">
          <div className="text-xs text-(--color-text-dim)">{g.name}</div>
          {g.rules.map((r, i) => (
            <label
              key={`${g.id}-${i}`}
              className="flex items-start gap-2 px-1 py-0.5 rounded hover:bg-(--color-panel-2)/30 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={set.has(r)}
                onChange={e => toggle(r, e.target.checked)}
                className="mt-0.5"
              />
              <span className={cn('text-xs', set.has(r) && 'text-(--color-text-dim)')}>
                {r}
              </span>
            </label>
          ))}
        </div>
      ))}
    </div>
  )
}
