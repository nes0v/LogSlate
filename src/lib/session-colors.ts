import type { Session } from '@/db/types'

// Canonical per-session swatches. Used by the Stats donut, the Models
// session pills, and anywhere else a session needs an at-a-glance color.
export const SESSION_BG: Record<Session, string> = {
  pre:   '#c4b5fd',
  am:    '#7dd3fc',
  lunch: '#fbbf24',
  pm:    '#2563eb',
  aft:   '#7e22ce',
}

// Foreground picked manually per swatch — the light purple/blue/amber bgs
// need dark text; the deep blue/purple bgs need light text.
export const SESSION_FG: Record<Session, string> = {
  pre:   '#0b0d12',
  am:    '#0b0d12',
  lunch: '#0b0d12',
  pm:    '#ffffff',
  aft:   '#ffffff',
}
