import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, getTheme, resolveTheme, setTheme } from './theme-preference'

const KEY = 'logslate:theme'

afterEach(() => {
  localStorage.removeItem(KEY)
  document.documentElement.removeAttribute('data-theme')
  vi.restoreAllMocks()
})

function mockOsPrefersLight(value: boolean) {
  const original = window.matchMedia
  window.matchMedia = ((query: string) => {
    const matches = query === '(prefers-color-scheme: light)' ? value : false
    return {
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    } as unknown as MediaQueryList
  }) as typeof window.matchMedia
  return () => {
    window.matchMedia = original
  }
}

describe('getTheme', () => {
  it('defaults to "system" when nothing is stored', () => {
    expect(getTheme()).toBe('system')
  })

  it('returns the stored value when valid', () => {
    localStorage.setItem(KEY, 'light')
    expect(getTheme()).toBe('light')
    localStorage.setItem(KEY, 'dark')
    expect(getTheme()).toBe('dark')
  })

  it('falls back to "system" on garbage values', () => {
    localStorage.setItem(KEY, 'sepia')
    expect(getTheme()).toBe('system')
  })
})

describe('resolveTheme', () => {
  it('passes through explicit light/dark', () => {
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('uses OS preference when "system"', () => {
    const restore = mockOsPrefersLight(true)
    expect(resolveTheme('system')).toBe('light')
    restore()

    const restore2 = mockOsPrefersLight(false)
    expect(resolveTheme('system')).toBe('dark')
    restore2()
  })
})

describe('applyTheme', () => {
  it('locks the theme by setting `data-theme` for explicit values', () => {
    applyTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('removes `data-theme` for "system" so the OS preference takes over', () => {
    applyTheme('dark')
    applyTheme('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('updates the theme-color meta tag to the resolved bg', () => {
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    meta.setAttribute('content', '')
    document.head.appendChild(meta)
    try {
      applyTheme('light')
      expect(meta.getAttribute('content')).toMatch(/^#/)
      const lightColor = meta.getAttribute('content')
      applyTheme('dark')
      expect(meta.getAttribute('content')).not.toBe(lightColor)
    } finally {
      meta.remove()
    }
  })
})

describe('setTheme', () => {
  it('persists to localStorage', () => {
    setTheme('light')
    expect(localStorage.getItem(KEY)).toBe('light')
  })

  it('applies the theme as a side effect', () => {
    setTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('is a no-op when unchanged', () => {
    // Default is "system" — setting it shouldn't write to localStorage.
    setTheme('system')
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
