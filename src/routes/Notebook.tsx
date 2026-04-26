import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { format } from 'date-fns'
import { Pin, PinOff, Plus, Save, Trash2 } from 'lucide-react'
import { db } from '@/db/schema'
import type { Note, NoteTemplateKind } from '@/db/types'
import { useActiveAccountId } from '@/lib/active-account'
import { NOTE_TEMPLATES_LIST, templateFor } from '@/lib/note-templates'
import { cn } from '@/lib/utils'

function newId(): string {
  return crypto.randomUUID()
}

export function NotebookRoute() {
  const accountId = useActiveAccountId()
  const notes = useLiveQuery(
    () =>
      db.notes
        .where('account_id')
        .equals(accountId)
        .reverse()
        .sortBy('updated_at'),
    [accountId],
    [],
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNewMenu, setShowNewMenu] = useState(false)

  // If selectedId points at a note that no longer exists (or was never set),
  // fall back to the most-recently-updated note. Computed during render so
  // there's no setState-in-effect needed.
  const selected = useMemo(() => {
    const list = notes ?? []
    if (selectedId) {
      const match = list.find(n => n.id === selectedId)
      if (match) return match
    }
    return list[0] ?? null
  }, [notes, selectedId])

  const folders = useMemo(() => {
    const set = new Set<string>()
    for (const n of notes ?? []) set.add(n.folder)
    return Array.from(set).sort()
  }, [notes])

  async function createNote(kind: NoteTemplateKind, folder = '') {
    const tpl = templateFor(kind)
    const ts = new Date().toISOString()
    const today = format(new Date(), 'yyyy-MM-dd')
    const note: Note = {
      id: newId(),
      account_id: accountId,
      folder,
      title: tpl.defaultTitle(today),
      body: tpl.body,
      template_kind: kind,
      pinned: false,
      created_at: ts,
      updated_at: ts,
    }
    await db.notes.put(note)
    setSelectedId(note.id)
    setShowNewMenu(false)
  }

  async function update(patch: Partial<Note>) {
    if (!selected) return
    await db.notes.update(selected.id, {
      ...patch,
      updated_at: new Date().toISOString(),
    })
  }

  async function remove() {
    if (!selected) return
    if (!confirm(`Delete "${selected.title}"?`)) return
    const id = selected.id
    setSelectedId(null)
    await db.notes.delete(id)
  }

  // Group notes by folder, with pinned notes promoted to a virtual top group.
  const groups = useMemo(() => {
    const all = notes ?? []
    const pinned = all.filter(n => n.pinned)
    const byFolder = new Map<string, Note[]>()
    for (const n of all) {
      const f = n.folder || ''
      if (!byFolder.has(f)) byFolder.set(f, [])
      byFolder.get(f)!.push(n)
    }
    const out: Array<{ name: string; notes: Note[]; pinned?: boolean }> = []
    if (pinned.length > 0) out.push({ name: 'Pinned', notes: pinned, pinned: true })
    for (const f of Array.from(byFolder.keys()).sort()) {
      out.push({ name: f || 'Inbox', notes: byFolder.get(f)! })
    }
    return out
  }, [notes])

  return (
    <div className="pt-1 space-y-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="h-8 flex items-center text-lg font-semibold">Notebook</h1>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowNewMenu(s => !s)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-(--radius) bg-(--color-accent) text-(--color-accent-fg) hover:opacity-90"
          >
            <Plus className="size-4" /> New note
          </button>
          {showNewMenu && (
            <div className="absolute right-0 mt-1 w-48 bg-(--color-panel) rounded-(--radius) shadow-(--shadow-md) z-10">
              {NOTE_TEMPLATES_LIST.map(t => (
                <button
                  key={t.kind}
                  type="button"
                  onClick={() => createNote(t.kind, selected?.folder ?? '')}
                  className="block w-full text-left px-3 py-1.5 text-sm hover:bg-(--color-panel-2)"
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 min-h-[60vh]">
        {/* Sidebar */}
        <aside className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-2 max-h-[80vh] overflow-y-auto">
          {(notes ?? []).length === 0 ? (
            <div className="text-xs text-(--color-text-dim) text-center py-6">
              No notes yet — start with a template.
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map(g => (
                <div key={g.name}>
                  <div className="text-xs uppercase tracking-wider text-(--color-text-dim) px-2 py-1 flex items-center gap-1">
                    {g.pinned && <Pin className="size-3" />}
                    {g.name}
                  </div>
                  <div className="space-y-0.5">
                    {g.notes.map(n => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => setSelectedId(n.id)}
                        className={cn(
                          'block w-full text-left px-2 py-1.5 rounded-sm text-sm transition-colors',
                          selected?.id === n.id
                            ? 'bg-(--color-panel-2) text-(--color-text)'
                            : 'text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)/50',
                        )}
                      >
                        <div className="truncate flex items-center gap-1">
                          {n.pinned && <Pin className="size-3 text-(--color-accent)" />}
                          <span>{n.title || 'Untitled'}</span>
                        </div>
                        <div className="text-xs text-(--color-text-dim) truncate">
                          {format(new Date(n.updated_at), 'MMM d')} · {n.template_kind}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* Editor */}
        {selected ? (
          <NoteEditor
            key={selected.id}
            note={selected}
            folders={folders}
            onChange={update}
            onDelete={remove}
          />
        ) : (
          <div className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-12 text-center text-sm text-(--color-text-dim)">
            Select a note on the left, or create a new one.
          </div>
        )}
      </div>
    </div>
  )
}

interface NoteEditorProps {
  note: Note
  folders: string[]
  onChange: (patch: Partial<Note>) => void
  onDelete: () => void
}
function NoteEditor({ note, folders, onChange, onDelete }: NoteEditorProps) {
  // Parent renders with key={note.id} so this component fully remounts when
  // the user picks a different note — local state is fresh per note.
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [folder, setFolder] = useState(note.folder)
  const [dirty, setDirty] = useState(false)

  // Auto-save 600ms after the last keystroke.
  useEffect(() => {
    if (!dirty) return
    const id = setTimeout(() => {
      onChange({ title, body, folder })
      setDirty(false)
    }, 600)
    return () => clearTimeout(id)
  }, [dirty, title, body, folder, onChange])

  return (
    <div className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={title}
          onChange={e => {
            setTitle(e.target.value)
            setDirty(true)
          }}
          placeholder="Title"
          className="flex-1 bg-transparent border-0 outline-none text-lg font-medium"
        />
        <input
          value={folder}
          onChange={e => {
            setFolder(e.target.value)
            setDirty(true)
          }}
          placeholder="folder"
          list="notebook-folders"
          className="w-32 bg-(--color-bg) rounded-(--radius) px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-(--color-accent-soft) transition-colors"
        />
        <datalist id="notebook-folders">
          {folders.filter(f => f).map(f => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={() => onChange({ pinned: !note.pinned })}
          className="p-1.5 rounded text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
          title={note.pinned ? 'Unpin' : 'Pin'}
        >
          {note.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="p-1.5 rounded text-(--color-text-dim) hover:text-(--color-loss) hover:bg-(--color-panel-2)"
          title="Delete"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <textarea
        value={body}
        onChange={e => {
          setBody(e.target.value)
          setDirty(true)
        }}
        placeholder="Write your note in markdown…"
        className="w-full min-h-[60vh] bg-transparent border-0 outline-none font-mono text-sm leading-relaxed resize-none"
      />

      <div className="flex items-center justify-between text-xs text-(--color-text-dim)">
        <div>
          {format(new Date(note.created_at), 'PPP p')} · last edit{' '}
          {format(new Date(note.updated_at), 'PPP p')}
        </div>
        <div className="flex items-center gap-1">
          {dirty ? (
            <>
              <Save className="size-3 animate-pulse" /> saving…
            </>
          ) : (
            <span>Saved</span>
          )}
        </div>
      </div>
    </div>
  )
}
