import { describe, expect, it } from 'vitest'
import {
  driveViewUrlFromRef,
  formatScreenshotRef,
  parseScreenshotRef,
} from './drive-images'

describe('parseScreenshotRef', () => {
  it('returns null for empty/null/undefined input', () => {
    expect(parseScreenshotRef(null)).toBeNull()
    expect(parseScreenshotRef(undefined)).toBeNull()
    expect(parseScreenshotRef('')).toBeNull()
  })

  it('parses a Drive ref', () => {
    expect(parseScreenshotRef('drive:abc123')).toEqual({ kind: 'drive', fileId: 'abc123' })
  })

  it('parses a pending ref', () => {
    expect(parseScreenshotRef('pending:xyz')).toEqual({ kind: 'pending', pendingId: 'xyz' })
  })

  it('rejects unknown prefixes (e.g. legacy base64 from before v6)', () => {
    expect(parseScreenshotRef('data:image/png;base64,abc')).toBeNull()
    expect(parseScreenshotRef('some-other-string')).toBeNull()
  })

  it('preserves colons inside the id so Drive ids with colons survive', () => {
    expect(parseScreenshotRef('drive:a:b:c')).toEqual({ kind: 'drive', fileId: 'a:b:c' })
  })
})

describe('formatScreenshotRef', () => {
  it('round-trips parse → format', () => {
    const cases = ['drive:abc123', 'pending:xyz']
    for (const s of cases) {
      expect(formatScreenshotRef(parseScreenshotRef(s))).toBe(s)
    }
  })

  it('returns null for a null ref', () => {
    expect(formatScreenshotRef(null)).toBeNull()
  })
})

describe('driveViewUrlFromRef', () => {
  it('returns a Drive web-view URL for Drive refs', () => {
    const url = driveViewUrlFromRef({ kind: 'drive', fileId: 'abc123' })
    expect(url).toBe('https://drive.google.com/file/d/abc123/view')
  })

  it('URL-encodes the file id', () => {
    const url = driveViewUrlFromRef({ kind: 'drive', fileId: 'a/b?c' })
    expect(url).toBe('https://drive.google.com/file/d/a%2Fb%3Fc/view')
  })

  it('returns null for pending refs (nothing to open)', () => {
    expect(driveViewUrlFromRef({ kind: 'pending', pendingId: 'x' })).toBeNull()
  })

  it('returns null for a null ref', () => {
    expect(driveViewUrlFromRef(null)).toBeNull()
  })
})
