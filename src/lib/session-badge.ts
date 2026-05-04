import type { Session } from '@/db/types'

// Per-session colour.
export const SESSION_BADGE: Record<Session, string> = {
  pre: 'bg-violet-200 text-violet-950 pb-0.5',
  am: 'bg-sky-300 text-sky-950 pb-0.5',
  lunch: 'bg-amber-400 text-amber-950 pb-0.5',
  pm: 'bg-blue-600 text-blue-50 pb-0.5',
  aft: 'bg-purple-800 text-purple-100 pb-0.5',
}

export const SESSION_BADGE_CLASS =
  'inline-flex items-center justify-center gap-1 min-w-10 px-0.5 h-5 text-xs rounded-sm font-mono leading-none'
