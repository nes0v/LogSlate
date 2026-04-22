import {
  CONTRACT_TYPES,
  RATINGS,
  SESSIONS,
  SYMBOLS,
  type ContractType,
  type Rating,
  type Session,
  type SymbolKey,
  type TradeRecord,
} from '@/db/types'

export interface TradeFilters {
  from: string | null // YYYY-MM-DD, inclusive
  to: string | null // YYYY-MM-DD, inclusive
  symbol: SymbolKey | null
  contract: ContractType | null
  session: Session | null
  rating: Rating | null
}

export const EMPTY_FILTERS: TradeFilters = {
  from: null,
  to: null,
  symbol: null,
  contract: null,
  session: null,
  rating: null,
}

export function applyFilters(trades: TradeRecord[], f: TradeFilters): TradeRecord[] {
  return trades.filter(t => {
    if (f.from && t.trade_date < f.from) return false
    if (f.to && t.trade_date > f.to) return false
    if (f.symbol && t.symbol !== f.symbol) return false
    if (f.contract && t.contract_type !== f.contract) return false
    if (f.session && t.session !== f.session) return false
    if (f.rating && t.rating !== f.rating) return false
    return true
  })
}

export function filtersFromParams(p: URLSearchParams): TradeFilters {
  const get = <K extends string>(key: string, allowed: readonly K[]): K | null => {
    const v = p.get(key)
    return v !== null && (allowed as readonly string[]).includes(v) ? (v as K) : null
  }
  return {
    from: p.get('from'),
    to: p.get('to'),
    symbol: get<SymbolKey>('symbol', SYMBOLS),
    contract: get<ContractType>('contract', CONTRACT_TYPES),
    session: get<Session>('session', SESSIONS),
    rating: get<Rating>('rating', RATINGS),
  }
}

export function paramsFromFilters(f: TradeFilters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  if (f.symbol) p.set('symbol', f.symbol)
  if (f.contract) p.set('contract', f.contract)
  if (f.session) p.set('session', f.session)
  if (f.rating) p.set('rating', f.rating)
  return p
}
