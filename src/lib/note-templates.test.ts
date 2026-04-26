import { describe, expect, it } from 'vitest'
import { NOTE_TEMPLATES } from '@/db/types'
import { NOTE_TEMPLATES_LIST, templateFor } from './note-templates'

describe('NOTE_TEMPLATES_LIST', () => {
  it('exposes one entry per `NoteTemplateKind`', () => {
    const kinds = new Set(NOTE_TEMPLATES_LIST.map(t => t.kind))
    for (const k of NOTE_TEMPLATES) expect(kinds.has(k)).toBe(true)
    expect(kinds.size).toBe(NOTE_TEMPLATES.length)
  })

  it('every template has a non-empty label and body', () => {
    for (const t of NOTE_TEMPLATES_LIST) {
      expect(t.label.trim()).not.toBe('')
      expect(t.body).toContain('#') // markdown headings everywhere
    }
  })

  it('defaultTitle accepts a date string', () => {
    for (const t of NOTE_TEMPLATES_LIST) {
      const title = t.defaultTitle('2026-04-26')
      expect(typeof title).toBe('string')
    }
  })
})

describe('templateFor', () => {
  it('returns the matching template by kind', () => {
    expect(templateFor('plan').kind).toBe('plan')
    expect(templateFor('watchlist').kind).toBe('watchlist')
    expect(templateFor('review').kind).toBe('review')
    expect(templateFor('lesson').kind).toBe('lesson')
    expect(templateFor('free').kind).toBe('free')
  })
})
