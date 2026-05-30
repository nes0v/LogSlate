import { describe, expect, it } from 'vitest'
import {
  buildFilename,
  dayScreenshotSuffix,
  driveViewUrlFromRef,
  extensionFromBlobType,
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

describe('dayScreenshotSuffix', () => {
  it('emits lowercase 3-letter weekday + zero-padded 2-digit ordinal', () => {
    // Mon 2026-05-18 → 1st shot
    expect(dayScreenshotSuffix('2026-05-18', 1)).toBe('mon-01')
    // Fri 2026-05-29 → 9th shot stays single-padded
    expect(dayScreenshotSuffix('2026-05-29', 9)).toBe('fri-09')
    // Sun 2026-05-31 → 10th drops the leading zero
    expect(dayScreenshotSuffix('2026-05-31', 10)).toBe('sun-10')
  })

  it('covers every weekday', () => {
    // Week of 2026-04-12 (Sun) through 2026-04-18 (Sat)
    const dates = [
      ['2026-04-12', 'sun'],
      ['2026-04-13', 'mon'],
      ['2026-04-14', 'tue'],
      ['2026-04-15', 'wed'],
      ['2026-04-16', 'thu'],
      ['2026-04-17', 'fri'],
      ['2026-04-18', 'sat'],
    ] as const
    for (const [date, wd] of dates) {
      expect(dayScreenshotSuffix(date, 1)).toBe(`${wd}-01`)
    }
  })

  it('produces a suffix that round-trips cleanly through buildFilename', () => {
    // Smoke test: the canonical filename for the 1st screenshot on
    // 2026-05-18 should be "18-may-2026-mon-01.png".
    const suffix = dayScreenshotSuffix('2026-05-18', 1)
    expect(buildFilename('2026-05-18', suffix, 'png')).toBe('18-may-2026-mon-01.png')
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
