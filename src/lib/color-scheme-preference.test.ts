import { afterEach, describe, expect, it } from 'vitest'
import {
  COLOR_SCHEMES,
  applyColorScheme,
  getColorScheme,
  setColorScheme,
} from './color-scheme-preference'

afterEach(() => {
  // Reset preference + the CSS vars we wrote between tests so they
  // don't bleed into one another.
  localStorage.removeItem('logslate:color_scheme')
  document.documentElement.style.removeProperty('--color-win')
  document.documentElement.style.removeProperty('--color-loss')
})

describe('getColorScheme', () => {
  it('returns "classic" when no preference is stored', () => {
    expect(getColorScheme()).toBe('classic')
  })

  it('returns the stored scheme when valid', () => {
    localStorage.setItem('logslate:color_scheme', 'azure')
    expect(getColorScheme()).toBe('azure')
  })

  it('falls back to "classic" for an invalid stored value', () => {
    localStorage.setItem('logslate:color_scheme', 'rainbow')
    expect(getColorScheme()).toBe('classic')
  })
})

describe('applyColorScheme', () => {
  it('writes the scheme\'s win + loss colors onto `:root`', () => {
    applyColorScheme('azure')
    const styles = document.documentElement.style
    expect(styles.getPropertyValue('--color-win')).toBe(COLOR_SCHEMES.azure.win)
    expect(styles.getPropertyValue('--color-loss')).toBe(COLOR_SCHEMES.azure.loss)
  })

  it('overwrites previously applied colors', () => {
    applyColorScheme('azure')
    applyColorScheme('classic')
    const styles = document.documentElement.style
    expect(styles.getPropertyValue('--color-win')).toBe(COLOR_SCHEMES.classic.win)
    expect(styles.getPropertyValue('--color-loss')).toBe(COLOR_SCHEMES.classic.loss)
  })
})

describe('setColorScheme', () => {
  it('persists to localStorage', () => {
    setColorScheme('azure')
    expect(localStorage.getItem('logslate:color_scheme')).toBe('azure')
  })

  it('applies the colors as a side effect', () => {
    setColorScheme('azure')
    expect(document.documentElement.style.getPropertyValue('--color-win'))
      .toBe(COLOR_SCHEMES.azure.win)
  })

  it('is a no-op when the scheme is unchanged', () => {
    setColorScheme('classic') // same as the default — should not write
    expect(localStorage.getItem('logslate:color_scheme')).toBeNull()
  })
})

describe('COLOR_SCHEMES', () => {
  it('exposes labels for each scheme', () => {
    expect(COLOR_SCHEMES.classic.label).toBeTruthy()
    expect(COLOR_SCHEMES.azure.label).toBeTruthy()
  })
})
