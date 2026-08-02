import { useEffect, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import { Bold, Heading1, Heading3, Italic, List, Strikethrough, Underline } from 'lucide-react'
import { setDayNote } from '@/db/queries'
import { cn, errorMessage } from '@/lib/utils'

interface DayNoteSectionProps {
  accountId: string
  date: string // YYYY-MM-DD
  /** Stored note value for this (account, date); empty string if none. */
  stored: string
}

/**
 * Day journal entry — a live WYSIWYG editor (TipTap) whose content is stored as
 * **HTML** on the Day row's `note` field (one row per (account, date)). HTML
 * round-trips the document exactly: paragraph breaks, blank lines, and hard
 * (Shift+Enter) breaks all reload byte-for-byte as they were typed, so the
 * saved note always matches what was on screen while editing. Plain-text notes
 * (no markup) load unchanged — TipTap just wraps them in a paragraph.
 *
 * Persisted on blur — keystroke-time writes would mean a Dexie transaction per
 * character. The editor is only re-synced from `stored` when the value changes
 * from another source (cross-device sync) and the editor isn't focused.
 */
export function DayNoteSection({ accountId, date, stored }: DayNoteSectionProps) {
  const [error, setError] = useState<string | null>(null)
  const editor = useEditor(
    {
      extensions: [
        // - trailingNode off: StarterKit otherwise force-appends an empty
        //   paragraph after any non-paragraph last block (e.g. a heading),
        //   showing as an undeletable blank line below a bottom heading.
        // - heading levels [1,3] to match the toolbar; otherwise the `##` /
        //   `####` markdown shortcuts create H2/H4 the buttons can't toggle.
        StarterKit.configure({ trailingNode: false, heading: { levels: [1, 3] } }),
        Placeholder.configure({ placeholder: 'What did you notice today?' }),
      ],
      content: toEditorContent(stored),
      editorProps: {
        // Each paragraph is one visual line, so a plain-text copy must put a
        // single "\n" at each block boundary. ProseMirror's default serializer
        // uses "\n\n", which turns one empty paragraph into three blank lines
        // (text\n\n + \n\n = text, empty, empty, empty, text) when pasted into a
        // plain-text target. One "\n" round-trips the layout exactly.
        clipboardTextSerializer: slice =>
          slice.content.textBetween(0, slice.content.size, '\n'),
        // Copying inside the editor and pasting back stacked blank <br> lines
        // above and below the content on Windows Chrome. It wraps clipboard HTML
        // as `<html>\n<body>\n<!--StartFragment-->…<!--EndFragment-->\n</body>…`,
        // and because the copied nodes carry ProseMirror's `data-pm-slice`
        // marker, paste takes the internal-slice path that keeps those wrapper
        // newlines as literal hard breaks. The StartFragment/EndFragment comments
        // delimit the actual copied content, so slicing to them drops the wrapper
        // (and its stray whitespace) while keeping the marker intact — paste
        // fidelity (block vs inline, blank lines, Shift+Enter breaks) is
        // preserved. When the markers are absent (other platforms) we leave the
        // HTML untouched.
        transformPastedHTML: html => {
          const m = html.match(/<!--\s*StartFragment\s*-->([\s\S]*?)<!--\s*EndFragment\s*-->/i)
          return m ? m[1] : html
        },
      },
      onBlur: ({ editor }) => void persist(getHtml(editor)),
      // TipTap v3 doesn't re-render on transactions by default, which would
      // leave the toolbar's active highlights (isActive) stale as the cursor
      // moves or marks toggle. Opt back into per-transaction re-render so the
      // buttons reflect the current selection.
      shouldRerenderOnTransaction: true,
    },
    // Rebuild the editor per (account, date) so navigating between days starts
    // clean rather than carrying the previous day's document.
    [accountId, date],
  )

  async function persist(next: string) {
    // getHtml returns "" for an empty doc — matches an empty stored note.
    if (next === stored) return
    try {
      await setDayNote(accountId, date, next)
      setError(null)
    } catch (e) {
      // A failed write shouldn't break the page, but it must not be silent
      // either: the note is still on screen, so without this the user walks
      // away believing a day's journal was saved when nothing was written.
      setError(`Couldn't save note: ${errorMessage(e)}`)
    }
  }

  // Pull in an externally-changed value (e.g. a cross-device sync landed) only
  // when the user isn't mid-edit, so we never clobber in-progress typing.
  //
  // `isDestroyed` matters as much as `isFocused`: `useEditor` tears the instance
  // down and rebuilds it when [accountId, date] change, but this effect can
  // still fire against the OLD one in the same commit — switching accounts
  // changes `stored` and the deps together. Reading `getHtml`/`commands` off a
  // destroyed editor throws (its view is already null), which crashed the whole
  // Day route into the error boundary.
  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isFocused) return
    const next = toEditorContent(stored)
    if (getHtml(editor) === next) return
    editor.commands.setContent(next)
  }, [editor, stored])

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Notes</h2>
      <div className="bg-(--color-panel) rounded-(--radius) p-3 space-y-2">
        <Toolbar editor={editor} />
        <EditorContent
          editor={editor}
          className="md-body md-paper min-h-[95px] rounded-(--radius) bg-(--color-paper) px-2.5 pt-1.5 pb-2 text-sm text-(--color-paper-text) focus-within:ring-2 focus-within:ring-(--color-accent-soft)"
        />
        {error && <p className="text-xs text-(--color-loss)">{error}</p>}
      </div>
    </section>
  )
}

/** Serialises the current document to HTML, collapsing an empty doc to "" so
 *  it matches an empty stored note (and clears the row rather than persisting
 *  a stray "<p></p>"). */
function getHtml(editor: Editor): string {
  return editor.isEmpty ? '' : editor.getHTML()
}

// Any HTML this editor emits starts with a block tag (ProseMirror wraps even
// inline content in a paragraph), so a stored value carrying one of these is
// already rich text and loads as-is.
const RICH_TEXT = /<(?:p|h[1-6]|ul|ol|hr|pre|blockquote)[\s/>]/i

/** Prepares a stored note for the editor. Legacy notes from the old plain-text
 *  textarea have no markup; feeding their raw `\n` text as HTML would collapse
 *  every line break into a space. Map each line to a paragraph instead (our
 *  paragraphs are one visual line each), preserving the layout exactly. HTML
 *  notes pass through untouched. The note migrates to HTML on the next blur. */
function toEditorContent(stored: string): string {
  if (stored === '' || RICH_TEXT.test(stored)) return stored
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return stored.split('\n').map(line => `<p>${esc(line)}</p>`).join('')
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null

  const tools: Array<{
    key: string
    label: string
    icon: typeof Bold
    run: () => void
    active: boolean
  }> = [
    {
      key: 'bold',
      label: 'Bold',
      icon: Bold,
      run: () => editor.chain().focus().toggleBold().run(),
      active: editor.isActive('bold'),
    },
    {
      key: 'italic',
      label: 'Italic',
      icon: Italic,
      run: () => editor.chain().focus().toggleItalic().run(),
      active: editor.isActive('italic'),
    },
    {
      key: 'underline',
      label: 'Underline',
      icon: Underline,
      run: () => editor.chain().focus().toggleUnderline().run(),
      active: editor.isActive('underline'),
    },
    {
      key: 'strike',
      label: 'Strikethrough',
      icon: Strikethrough,
      run: () => editor.chain().focus().toggleStrike().run(),
      active: editor.isActive('strike'),
    },
    {
      key: 'h1',
      label: 'Heading 1',
      icon: Heading1,
      run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      active: editor.isActive('heading', { level: 1 }),
    },
    {
      key: 'h3',
      label: 'Heading 3',
      icon: Heading3,
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      active: editor.isActive('heading', { level: 3 }),
    },
    {
      key: 'bullet',
      label: 'Bullet list',
      icon: List,
      run: () => editor.chain().focus().toggleBulletList().run(),
      active: editor.isActive('bulletList'),
    },
  ]

  return (
    <div className="flex items-center gap-0.5">
      {tools.map(t => (
        <button
          key={t.key}
          type="button"
          aria-label={t.label}
          aria-pressed={t.active}
          title={t.label}
          // Keep the editor selection while the button takes the click.
          onMouseDown={ev => ev.preventDefault()}
          onClick={t.run}
          className={cn(
            'grid size-7 place-items-center rounded-(--radius)',
            t.active
              ? 'bg-(--color-panel-2) text-(--color-text)'
              : 'text-(--color-text-dim) hover:bg-(--color-panel-2) hover:text-(--color-text)',
          )}
        >
          <t.icon className="size-4" />
        </button>
      ))}
    </div>
  )
}
