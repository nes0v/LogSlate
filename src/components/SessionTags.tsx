import { SESSIONS, type TradeRecord } from '@/db/types'
import { SESSION_BADGE, SESSION_BADGE_CLASS } from '@/lib/session-badge'
import { cn } from '@/lib/utils'

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
