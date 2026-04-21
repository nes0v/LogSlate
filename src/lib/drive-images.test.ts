import { describe, expect, it } from 'vitest'
import {
  buildFilename,
  driveViewUrlFromRef,
  extensionFromBlobType,
  formatScreenshotRef,
  monthKey,
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

describe('monthKey', () => {
  it('returns the YYYY-MM prefix', () => {
    expect(monthKey('2026-04-17')).toBe('2026-04')
  })
})

describe('extensionFromBlobType', () => {
  it('extracts the subtype as the extension', () => {
    expect(extensionFromBlobType('image/png')).toBe('png')
    expect(extensionFromBlobType('image/jpeg')).toBe('jpeg')
  })

  it('strips non-alphanumeric characters', () => {
    expect(extensionFromBlobType('image/svg+xml')).toBe('svgxml')
  })

  it('falls back to "bin" when the type is missing or malformed', () => {
    expect(extensionFromBlobType('')).toBe('bin')
    expect(extensionFromBlobType(null)).toBe('bin')
    expect(extensionFromBlobType(undefined)).toBe('bin')
    expect(extensionFromBlobType('not-a-mime-type')).toBe('bin')
  })
})

describe('buildFilename', () => {
  it('composes day + lowercase month abbreviation + year + suffix + extension', () => {
    expect(buildFilename('2026-04-17', 'trade-1', 'png')).toBe('17-apr-2026-trade-1.png')
    expect(buildFilename('2026-12-01', 'day', 'jpg')).toBe('01-dec-2026-day.jpg')
  })

  it('sanitises arbitrary characters out of the suffix', () => {
    expect(buildFilename('2026-04-17', 'trade/../1', 'png')).toBe('17-apr-2026-trade1.png')
    expect(buildFilename('2026-04-17', 'Day-1!', 'png')).toBe('17-apr-2026-day-1.png')
  })

  it('falls back to "screenshot" when the sanitised suffix is empty', () => {
    expect(buildFilename('2026-04-17', '!!!', 'png')).toBe('17-apr-2026-screenshot.png')
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
