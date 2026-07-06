import type { TradingSymbol } from '@/db/types'

// Per-account snapshot of the symbol list, backed by localStorage so the
// Stats/Reports filter bar can render the Symbol pills on the very first frame
// after a full page reload — before the Dexie query resolves. Without the seed
// the pills flash "All" alone. Keyed per account so an account switch can't
// surface the previous account's symbols.
const SYMBOL_CACHE_PREFIX = 'logslate:symbol_filter_cache'

const keyFor = (accountId: string) => `${SYMBOL_CACHE_PREFIX}:${accountId}`

export function readSymbolFilterCache(accountId: string): TradingSymbol[] | undefined {
  try {
    const raw = localStorage.getItem(keyFor(accountId))
    return raw ? (JSON.parse(raw) as TradingSymbol[]) : undefined
  } catch {
    return undefined
  }
}

export function writeSymbolFilterCache(accountId: string, rows: TradingSymbol[]): void {
  try {
    localStorage.setItem(keyFor(accountId), JSON.stringify(rows))
  } catch {
    // localStorage unavailable or quota exceeded — the pills just flash once.
  }
}

/** Drop an account's cached symbol list — call when the account is deleted so
 *  the blob doesn't outlive the data it mirrors. */
export function clearSymbolFilterCache(accountId: string): void {
  try {
    localStorage.removeItem(keyFor(accountId))
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
