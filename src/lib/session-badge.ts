import type { Session } from '@/db/types'

export const SESSION_BADGE: Record<Session, string> = {
  pre: 'bg-violet-200 text-violet-950',
  AM: 'bg-sky-300 text-sky-950',
  LT: 'bg-amber-400 text-amber-950',
  PM: 'bg-blue-600 text-blue-50',
  aft: 'bg-purple-800 text-purple-100',
}

export const SESSION_BADGE_CLASS =
  'inline-flex items-center gap-1 px-2 py-[3px] text-xs rounded-sm font-mono leading-none'
