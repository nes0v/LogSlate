import type { Session } from '@/db/types'

// Per-session colour + a per-glyph baseline nudge: lowercase labels
// (`pre`, `aft`) sit a hair lower in the line-box than uppercase labels,
// so they get one extra pixel of bottom padding to shift them further up.
export const SESSION_BADGE: Record<Session, string> = {
  pre: 'bg-violet-200 text-violet-950 pb-0.5',
  AM: 'bg-sky-300 text-sky-950 pb-px',
  LT: 'bg-amber-400 text-amber-950 pb-px',
  PM: 'bg-blue-600 text-blue-50 pb-px',
  aft: 'bg-purple-800 text-purple-100 pb-0.5',
}

export const SESSION_BADGE_CLASS =
  'inline-flex items-center justify-center gap-1 w-8 h-5 text-xs rounded-sm font-mono leading-none'
