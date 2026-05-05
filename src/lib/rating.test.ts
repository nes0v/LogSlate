import { describe, expect, it } from 'vitest'
import { RATINGS } from '@/db/types'
import { RATING_TO_STARS, STARS_TO_RATING } from './rating'

describe('rating mapping', () => {
  it('round-trips RATING_TO_STARS ↔ STARS_TO_RATING', () => {
    for (const r of RATINGS) {
      const stars = RATING_TO_STARS[r]
      expect(STARS_TO_RATING[stars - 1]).toBe(r)
    }
  })

  it('covers every rating from db/types', () => {
    expect(Object.keys(RATING_TO_STARS).sort()).toEqual([...RATINGS].sort())
  })

  it('STARS_TO_RATING maps indices in canonical order', () => {
    expect(STARS_TO_RATING[0]).toBe('poor')
    expect(STARS_TO_RATING[1]).toBe('good')
    expect(STARS_TO_RATING[2]).toBe('excellent')
  })
})
