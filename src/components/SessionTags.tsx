import type { Session, TradeRecord } from '@/db/types'
import { cn } from '@/lib/utils'

const SESSIONS: Session[] = ['pre', 'AM', 'LT', 'PM', 'aft']

export const SESSION_BADGE: Record<Session, string> = {
  pre: 'bg-violet-200 text-violet-950',
  AM: 'bg-sky-300 text-sky-950',
  LT: 'bg-amber-400 text-amber-950',
  PM: 'bg-blue-600 text-blue-50',
  aft: 'bg-purple-800 text-purple-100',
}

export const SESSION_BADGE_CLASS =
  'inline-flex items-center gap-1 px-2 py-[3px] text-xs rounded-sm font-mono leading-none'

interface SessionTagsProps {
  trades: TradeRecord[]
}

export function SessionTags({ trades }: SessionTagsProps) {
  const counts = SESSIONS.map(k => ({
    key: k,
    count: trades.filter(t => t.session === k).length,
  })).filter(x => x.count > 0)

  if (counts.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      {counts.map(x => (
        <span key={x.key} className={cn(SESSION_BADGE_CLASS, SESSION_BADGE[x.key])}>
          {x.key} <span className="font-semibold">{x.count}</span>
        </span>
      ))}
    </div>
  )
}
