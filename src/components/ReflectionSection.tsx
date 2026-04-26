import { useMemo, useState } from 'react'
import { Controller, type Control } from 'react-hook-form'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { useActiveAccountId } from '@/lib/active-account'
import { EMOTIONS, type Emotion } from '@/db/types'
import type { TradeFormValues } from '@/lib/form-schema'
import { Field, inputClass } from '@/components/form/Field'
import { Select } from '@/components/form/Select'
import { cn } from '@/lib/utils'

interface ReflectionSectionProps {
  control: Control<TradeFormValues>
  /** Watched form values, so the playbook-rule list can react to selection. */
  values: TradeFormValues
}

export function ReflectionSection({ control, values }: ReflectionSectionProps) {
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
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Playbook">
              <Controller
                control={control}
                name="playbook_id"
                render={({ field }) => (
                  <Select
                    value={field.value ?? null}
                    onChange={v => field.onChange(v)}
                    options={(playbooks ?? []).map(p => ({ value: p.id, label: p.name }))}
                    ariaLabel="Playbook"
                  />
                )}
              />
            </Field>
            <Field label="Emotion">
              <Controller
                control={control}
                name="emotion"
                render={({ field }) => (
                  <Select
                    value={field.value ?? null}
                    onChange={v => field.onChange(v as Emotion | null)}
                    options={EMOTIONS.map(e => ({ value: e, label: e }))}
                    ariaLabel="Emotion"
                  />
                )}
              />
            </Field>
          </div>

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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Setup tags">
              <Controller
                control={control}
                name="setup_tags"
                render={({ field }) => (
                  <TagInput value={field.value ?? []} onChange={field.onChange} tone="neutral" />
                )}
              />
            </Field>
            <Field label="Mistake tags">
              <Controller
                control={control}
                name="mistake_tags"
                render={({ field }) => (
                  <TagInput value={field.value ?? []} onChange={field.onChange} tone="loss" />
                )}
              />
            </Field>
          </div>

          <Field label="Notes">
            <Controller
              control={control}
              name="notes"
              render={({ field }) => (
                <textarea
                  {...field}
                  value={field.value ?? ''}
                  className={cn(inputClass, 'min-h-[135px] resize-y')}
                  placeholder="What did I learn? What would I do differently?"
                />
              )}
            />
          </Field>
        </div>
    </section>
  )
}

interface TagInputProps {
  value: string[]
  onChange: (v: string[]) => void
  tone?: 'neutral' | 'loss' | 'win'
}
function TagInput({ value, onChange, tone = 'neutral' }: TagInputProps) {
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
    <div className="min-h-8 flex flex-wrap items-center gap-1 bg-(--color-bg) rounded-(--radius) px-2 py-1 focus-within:ring-2 focus-within:ring-(--color-accent-soft) transition-colors">
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
            className="cursor-pointer text-(--color-text-dim) hover:text-(--color-text)"
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
              <span className={cn('text-sm', set.has(r) && 'text-(--color-text-dim)')}>
                {r}
              </span>
            </label>
          ))}
        </div>
      ))}
    </div>
  )
}
